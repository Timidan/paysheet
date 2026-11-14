// Paysheet: screen each payee through Telegraph, then pay or hold.
// One process: JSON API, static files, and a daily run of the sample sheet.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAsker, screenRow, MINERS, USDC, PRICE_UUSDC } from "./screen.mjs";
import { makeDemoPayer, transferData, verifyPayment } from "./chain.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT || 4410);
const KEY_FILE = process.env.PAYSHEET_KEY_FILE;
if (!KEY_FILE) throw new Error("Set PAYSHEET_KEY_FILE to a file holding the app's testnet private key.");
const KEY = readFileSync(KEY_FILE, "utf8").trim();

const LIMITS = {
  rows: 10,
  requestsPerDay: 300, // $3.00 of screens a day
  runsPerHourPerIp: 6,
  demoRunTotal: 0.25, // the demo payer only pays small sheets
  demoPerDay: 2, // test USDC
  screenHours: 24, // a screen older than this must be rerun before paying
  claimMinutes: 10,
};

// ponytail: one JSON file, rewritten on every change. Move to SQLite if runs pile up.
const DATA = join(ROOT, "data");
const FILE = join(DATA, "runs.json");
mkdirSync(DATA, { recursive: true });
const db = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { runs: {}, spend: {} };
const save = () => { writeFileSync(FILE + ".tmp", JSON.stringify(db)); renameSync(FILE + ".tmp", FILE); };
// A restart mid-run would strand rows; settle them on the safe side.
for (const run of Object.values(db.runs))
  for (const row of run.rows) {
    if (row.state !== "done") Object.assign(row, { state: "done", decision: "held_unresolved", checks: [], screenedAt: new Date().toISOString(), screenHash: "0x" + "0".repeat(64) });
    if (row.pay?.state === "paying" && !row.pay.tx) row.pay = { state: "failed", by: row.pay.by, error: "Interrupted before the transfer was sent." };
  }
const today = () => new Date().toISOString().slice(0, 10);
const spend = () => (db.spend[today()] ??= { requests: 0, demo: 0 });

const ask = await makeAsker(KEY);
const payer = makeDemoPayer(KEY);

class Refuse extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const SAMPLE = [
  { name: "Adaeze Okonkwo Farms", wallet: "0x7a3f0c5e1b2d4968a0c7e5b1d3f2a4c6e8b0d1f2", amount: "0.03" },
  { name: "Kestrel Pixel Labs", wallet: "0x1c9e4b7a2d5f8036be1a4c7d0f3b6e9a2c5d8f01", amount: "0.05" },
  { name: "Mohammed Ali", wallet: "0x5e2b8d1f4a7c0936eb2d5a8c1f4e7b0a3d6c9f12", amount: "0.02" },
  // A clean name paid to an address on the OFAC list (Lazarus Group).
  { name: "Northwind Design Collective", wallet: "0x098B716B8Aaf21512996dC57EB0615e2383E2f96", amount: "0.04" },
  { name: "Mahan Air", wallet: "0x3d6a9c2e5b8f1047ad3c6f9b2e5a8d1c4f7b0a23", amount: "0.05" },
  { name: "Blue Heron Translations", wallet: "0x8f1c4e7a0d3b6952cf8e1b4a7d0c3f6b9e2a5d34", amount: "0.02" },
];

function cleanRows(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > LIMITS.rows)
    throw new Refuse(`A sheet has 1 to ${LIMITS.rows} rows.`);
  return input.map((r, i) => {
    const name = String(r?.name ?? "").trim().replace(/\s+/g, " ");
    const wallet = String(r?.wallet ?? "").trim();
    const amount = String(r?.amount ?? "").trim();
    if (name.length < 2 || name.length > 120) throw new Refuse(`Row ${i + 1}: enter the payee's name.`);
    if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new Refuse(`Row ${i + 1}: the wallet must be a 0x address.`);
    if (!/^\d{1,6}(\.\d{1,6})?$/.test(amount) || Number(amount) <= 0)
      throw new Refuse(`Row ${i + 1}: the amount must be a number above 0.`);
    return { name, wallet, amount };
  });
}

function startRun(rows, kind) {
  const need = rows.length * 3;
  if (spend().requests + need > LIMITS.requestsPerDay)
    throw new Refuse("Today's screening budget is used up. Try again tomorrow.", 429);
  spend().requests += need;
  const id = randomBytes(6).toString("hex");
  const run = {
    id, kind, token: randomBytes(16).toString("hex"), createdAt: new Date().toISOString(),
    rows: rows.map((r) => ({ ...r, state: "screening" })),
  };
  db.runs[id] = run;
  save();
  const done = Promise.all(run.rows.map(async (row) => {
    Object.assign(row, await screenRow(ask, row), { state: "done" });
    save();
  }));
  return { run, done };
}

const expired = (row) => Date.now() - Date.parse(row.screenedAt) > LIMITS.screenHours * 3600e3;
const claimLive = (row) => row.pay?.state === "claimed" && Date.now() - Date.parse(row.pay.at) < LIMITS.claimMinutes * 60e3;
const payable = (row) =>
  row.state === "done" && (row.decision === "screened" || !!row.release) && !expired(row) &&
  !(row.pay && (row.pay.state === "paid" || row.pay.state === "paying")) && !claimLive(row);
// The app's own wallet never pays a row a person released: that money is the payer's call.
const testPayable = (row) => payable(row) && !row.release;

let sends = Promise.resolve(); // one key, so every test-wallet transfer goes through one queue
function demoPay(run) {
  const rows = run.rows.filter(testPayable);
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  if (!rows.length) throw new Refuse("No rows are ready for the test wallet. Released rows are paid from your own wallet.");
  if (run.rows.reduce((s, r) => s + Number(r.amount), 0) > LIMITS.demoRunTotal)
    throw new Refuse(`The test wallet only pays sheets up to ${LIMITS.demoRunTotal} test USDC. Pay this one from your wallet.`);
  if (spend().demo + total > LIMITS.demoPerDay) throw new Refuse("Today's test-wallet payments are used up. Pay from your wallet.", 429);
  spend().demo += total;
  for (const row of rows) row.pay = { state: "paying", by: "test wallet", at: new Date().toISOString() };
  save();
  return (sends = sends.then(async () => {
    for (const row of rows) {
      try {
        row.pay = { state: "paid", by: "test wallet", at: new Date().toISOString(), ...(await payer.pay(row)) };
      } catch (e) {
        const msg = String(e.shortMessage || e.message || e);
        row.pay = { state: "failed", by: "test wallet", error: /gas|insufficient funds/i.test(msg) ? "Paysheet's test wallet is out of gas, so nothing was sent. Pay from your wallet, or try again later." : msg.slice(0, 200) };
        spend().demo -= Number(row.amount);
      }
      save();
    }
  }));
}

// The app's own autonomous run: once a day it screens the sample sheet and pays what passes.
// A run where a provider gave no clear answer says nothing about the payees: screen again within the hour.
const unclear = (run) => run.rows.some((r) => r.decision === "held_unresolved");
async function dailyRun() {
  const last = Object.values(db.runs).filter((r) => r.kind === "scheduled").sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  try {
    const age = last ? Date.now() - Date.parse(last.createdAt) : Infinity;
    if (last && age < (unclear(last) ? 50 * 60e3 : 24 * 3600e3)) {
      if (last.rows.some(testPayable)) await demoPay(last); // retry rows a failed transfer left unpaid
      return;
    }
    const { run, done } = startRun(SAMPLE, "scheduled");
    await done;
    if (run.rows.some(testPayable)) await demoPay(run);
  } catch (e) {
    console.error("daily run:", e.message);
  }
}

const view = ({ token, ...run }) => ({
  ...run,
  rows: run.rows.map((r) => ({ ...r, payable: payable(r), testPayable: testPayable(r), expired: r.screenedAt ? expired(r) : false })),
});

const hits = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
  if (list.length >= LIMITS.runsPerHourPerIp) throw new Refuse("Too many sheets from this address in the last hour.", 429);
  hits.set(ip, [...list, now]);
}

function owned(id, token) {
  const run = db.runs[id];
  if (!run) throw new Refuse("No such run.", 404);
  if (run.token !== token) throw new Refuse("Only the person who made this sheet can change it.", 403);
  return run;
}
function rowOf(run, i) {
  const row = run.rows[i];
  if (!row || row.state !== "done") throw new Refuse("That row is not screened yet.");
  return row;
}

const routes = {
  "GET /api/home": () => {
    // The newest finished sample whose providers all answered; one from an outage is not shown as the sample.
    const finished = Object.values(db.runs).filter((r) => r.kind === "scheduled" && r.rows.every((x) => x.state === "done"))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const latest = finished.find((r) => !unclear(r)) ?? finished[0];
    return { sample: latest ? view(latest) : null, sampleRows: SAMPLE, limits: LIMITS, miners: MINERS, usdc: USDC, priceUsd: PRICE_UUSDC / 1e6, payer: payer.address };
  },
  "GET /api/runs/:id": ({ id }) => {
    if (!db.runs[id]) throw new Refuse("No such run.", 404);
    return view(db.runs[id]);
  },
  "POST /api/runs": (_, body, ip) => {
    const rows = cleanRows(body.rows);
    rateLimit(ip);
    const { run } = startRun(rows, "user");
    return { id: run.id, token: run.token };
  },
  "POST /api/runs/:id/release": ({ id }, body) => {
    const row = rowOf(owned(id, body.token), body.row);
    const reason = String(body.reason ?? "").trim();
    if (row.decision === "screened") throw new Refuse("That row is not held.");
    if (row.checks.some((c) => c.kind === "wallet" && c.verdict !== "clean"))
      throw new Refuse("A row held on its wallet cannot be released. Use a different wallet and screen again.");
    if (reason.length < 10 || reason.length > 300) throw new Refuse("Say why this payee is safe to pay, in 10 to 300 characters.");
    row.release = { reason, at: new Date().toISOString() };
    save();
    return view(db.runs[id]);
  },
  "POST /api/runs/:id/pay-demo": ({ id }, body) => {
    const run = owned(id, body.token);
    demoPay(run); // limits are checked before this returns; the transfers finish in the background
    return view(run);
  },
  // Before a wallet payment: reserve the row and hand back the exact transaction to sign.
  "POST /api/runs/:id/claim": ({ id }, body) => {
    const row = rowOf(owned(id, body.token), body.row);
    if (claimLive(row)) throw new Refuse("This row's payment is already waiting in a wallet.");
    if (!payable(row)) throw new Refuse(expired(row) ? "This screen is over 24 hours old. Screen the sheet again." : "This row cannot be paid.");
    row.pay = { state: "claimed", by: "wallet", at: new Date().toISOString() };
    save();
    return { to: USDC, data: transferData(row), chainId: 84532 };
  },
  "POST /api/runs/:id/paid": async ({ id }, body) => {
    const row = rowOf(owned(id, body.token), body.row);
    if (row.pay?.state !== "claimed") throw new Refuse("This row was not waiting for a payment.");
    if (!/^0x[0-9a-fA-F]{64}$/.test(String(body.tx))) throw new Refuse("That is not a transaction hash.");
    const claimedAt = row.pay.at;
    row.pay = { state: "paying", by: "wallet", at: new Date().toISOString(), tx: body.tx }; // kept before checking, so a slow chain cannot lead to a second send
    save();
    try {
      row.pay = { state: "paid", by: "wallet", at: new Date().toISOString(), ...(await verifyPayment(body.tx, row)) };
    } catch (e) {
      row.pay = { state: "claimed", by: "wallet", at: claimedAt };
      save();
      throw new Refuse(String(e.shortMessage || e.message).slice(0, 200));
    }
    save();
    return view(db.runs[id]);
  },
  "POST /api/runs/:id/unclaim": ({ id }, body) => {
    const row = rowOf(owned(id, body.token), body.row);
    if (row.pay?.state === "claimed") delete row.pay;
    save();
    return view(db.runs[id]);
  },
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const SITE = join(ROOT, "web", "dist"); // built by `npm run build`
function serveStatic(path, res) {
  const file = normalize(join(SITE, extname(path) ? path : "index.html")); // page routes all get the app
  if (!file.startsWith(SITE) || !existsSync(file)) return send(res, 404, { error: "Not found." });
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream", "Cache-Control": path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache" });
  res.end(readFileSync(file));
}
const send = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
};

createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (!path.startsWith("/api/")) return serveStatic(path, res);
  try {
    for (const [key, handler] of Object.entries(routes)) {
      const [method, pattern] = key.split(" ");
      const m = path.match(new RegExp("^" + pattern.replace(":id", "([0-9a-f]{12})") + "$"));
      if (req.method !== method || !m) continue;
      let body = {};
      if (method === "POST") {
        let raw = "";
        for await (const chunk of req) { raw += chunk; if (raw.length > 20_000) throw new Refuse("Too large.", 413); }
        body = raw ? JSON.parse(raw) : {};
      }
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
      return send(res, 200, await handler({ id: m[1] }, body, ip));
    }
    send(res, 404, { error: "Not found." });
  } catch (e) {
    if (!(e instanceof Refuse)) console.error(e);
    send(res, e.status || (e instanceof SyntaxError ? 400 : 500), { error: e instanceof Refuse ? e.message : e instanceof SyntaxError ? "Bad JSON." : "Something went wrong on our side." });
  }
}).listen(PORT, () => console.log(`Paysheet on http://localhost:${PORT}, wallet ${payer.address}`));

if (process.env.PAYSHEET_NO_DAILY !== "1") {
  dailyRun();
  setInterval(dailyRun, 3600e3);
}
