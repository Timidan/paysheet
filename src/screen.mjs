// Sanctions screening bought through Telegraph, from named miners only.
// The routed path (/ask with no miner) answered "no match" for every listed
// name in our 13 Nov test, so it is never used here.
import { keccak256, toHex } from "viem";

export const NODE = "https://devnode.telegraphprotocol.com/engine/v1/ask";
export const INTENT = "SANCTIONS_SCREENING_MATCH_GENERAL";
export const NETWORK = "eip155:84532"; // Base Sepolia
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const PRICE_UUSDC = 10000; // $0.01 per request

// Independent miners screen the name; the first also screens the wallet.
// Miner 5281 (Praman Desk) provides in-memory OFAC SDN lookup across 19,565 entities in RAM.
export const MINERS = {
  "731002": "Counterproof Sanctions Screener",
  "710637": "Sanctions Name Evidence",
  "5281": "Praman Desk Compliance Screener",
};
export const NAME_MINERS = ["731002", "710637", "5281"];
export const WALLET_MINER = "731002";
export const CHECKS_PER_ROW = NAME_MINERS.length + 1; // 3 name checks + 1 wallet check

// One answer -> "clean" | "match" | "unresolved".
// Clean only when the miner we named answered the question we sent with an
// explicit, valid "no match". Everything that is not provably clean holds.
export function judge(miner, sent, status, body) {
  if (status !== 200 || !body || typeof body !== "object") return "unresolved";
  if (String(body.miner_id) !== String(miner)) return "unresolved";
  if (body.input?.name !== sent) return "unresolved";
  const matched = body.result?.matched;
  const score = Number(body.result?.match_score);
  if (matched === true || score > 0) return "match"; // a score with a dropped field still holds
  if (body.field_status?.matched === "ok" && matched === false) return "clean";
  return "unresolved";
}

// All answers for a row -> decision.
export function decide(verdicts) {
  if (verdicts.includes("match")) return "held_match";
  if (verdicts.every((v) => v === "clean")) return "screened";
  return "held_unresolved";
}

export async function makeAsker(privateKey) {
  const { wrapFetchWithPaymentFromConfig } = await import("@x402/fetch");
  const { ExactEvmScheme } = await import("@x402/evm");
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);
  const pay = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK, client: new ExactEvmScheme(account) }],
    spendControls: {
      allowedAssets: [{ network: NETWORK, asset: USDC, maxAmountPerPayment: String(PRICE_UUSDC) }],
    },
  });
  // One paid request to one named miner. Never throws: a failure is an unresolved check.
  return async function ask(miner, subject, kind) {
    const started = Date.now();
    const check = { miner, minerName: MINERS[miner], kind, subject };
    try {
      const res = await pay(`${NODE}/${miner}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "paysheet/0.1" },
        body: JSON.stringify({ intent: INTENT, params: { name: subject } }),
        signal: AbortSignal.timeout(60_000),
      });
      const body = await res.json().catch(() => null);
      const raw = res.headers.get("x-telegraph-receipt");
      const receipt = raw ? JSON.parse(Buffer.from(raw, "base64").toString()) : null;
      return {
        ...check,
        verdict: judge(miner, subject, res.status, body),
        status: res.status,
        answeredBy: body?.miner_id ?? null,
        echoed: body?.input?.name ?? null,
        result: body?.result ?? null,
        fieldStatus: body?.field_status ?? null,
        receipt,
        ms: Date.now() - started,
      };
    } catch (e) {
      return { ...check, verdict: "unresolved", status: 0, error: String(e.message || e), ms: Date.now() - started };
    }
  };
}

// Screen one payee: the name on both miners and the wallet on one, in parallel.
export async function screenRow(ask, row) {
  const checks = await Promise.all([
    ...NAME_MINERS.map((m) => ask(m, row.name, "name")),
    ask(WALLET_MINER, row.wallet, "wallet"),
  ]);
  const decision = decide(checks.map((c) => c.verdict));
  const screenedAt = new Date().toISOString();
  // Binds the screen to exactly this payee, wallet and amount. Appended to the
  // transfer's calldata, so the payment on chain points at this screen.
  const screenHash = keccak256(
    toHex(JSON.stringify({
      name: row.name,
      wallet: row.wallet.toLowerCase(),
      amount: row.amount,
      receipts: checks.map((c) => c.receipt?.receipt_hash ?? null),
      screenedAt,
    })),
  );
  return { checks, decision, screenedAt, screenHash };
}
