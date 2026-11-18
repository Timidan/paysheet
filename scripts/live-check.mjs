// Paid check of the real code path: 25 names through both name miners and 4 wallets through the wallet miner
// (54 requests, $0.54 test USDC from the key's Telegraph escrow balance).
// Saves the answers as the fixture that `npm test` replays.
// Run: PAYSHEET_KEY_FILE=~/.some-test-key node scripts/live-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeAsker, NAME_MINERS, WALLET_MINER, decide } from "../src/screen.mjs";

const NAMES = [
  ["Rosneft", true], ["Rossneft Oil Company", true], ["Sberbank", true], ["VTB Bank PJSC", true],
  ["Gazprombank", true], ["Mahan Air", true], ["Wagner Group", true], ["Lazarus Group", true],
  ["Hizballah", true], ["Islamic Revolutionary Guard Corps", true],
  ["Adaeze Okonkwo Farms", false], ["Northwind Design Collective", false], ["Kestrel Pixel Labs", false],
  ["Blue Heron Translations", false], ["Tunde Bakare Studio", false], ["Priya Raman Illustration", false],
  ["Quillfeather Copywriting", false], ["Ostrava Motion Graphics", false], ["Lumen Harbor Analytics", false],
  ["Zainab Yusuf Photography", false],
  ["Mohammed Ali", null], ["Juan Carlos Rodriguez", null], ["Li Wei", null], ["Ivan Petrov", null], ["Maria Garcia", null],
];
const WALLETS = [
  ["0x098B716B8Aaf21512996dC57EB0615e2383E2f96", true], ["0x7F367cC41522cE07553e823bf3be79A889DEbe1B", true], // OFAC SDN, Lazarus Group
  ["0x7a3f0c5e1b2d4968a0c7e5b1d3f2a4c6e8b0d1f2", false], ["0x8f1c4e7a0d3b6952cf8e1b4a7d0c3f6b9e2a5d34", false],
];
const ask = await makeAsker(readFileSync(process.env.PAYSHEET_KEY_FILE, "utf8").trim());
const out = [];
for (let i = 0; i < NAMES.length; i += 5) {
  const batch = await Promise.all(NAMES.slice(i, i + 5).map(async ([name, expect]) => {
    const checks = await Promise.all(NAME_MINERS.map((m) => ask(m, name, "name")));
    return { name, expect, decision: decide(checks.map((c) => c.verdict)), checks };
  }));
  for (const r of batch) console.log(String(r.expect).padEnd(5), r.decision.padEnd(16), r.checks.map((c) => `${c.miner}:${c.verdict}`).join(" "), "|", r.name);
  out.push(...batch);
}
for (const [wallet, expect] of WALLETS) {
  const checks = [await ask(WALLET_MINER, wallet, "wallet")];
  const r = { name: wallet, kind: "wallet", expect, decision: decide(checks.map((c) => c.verdict)), checks };
  console.log(String(expect).padEnd(5), r.decision.padEnd(16), `${WALLET_MINER}:${checks[0].verdict}`, "|", wallet);
  out.push(r);
}
writeFileSync(new URL("../test/fixtures/live-names.json", import.meta.url), JSON.stringify(out, null, 2));
const held = out.filter((r) => r.expect === true && r.decision !== "screened").length;
const passed = out.filter((r) => r.expect === false && r.decision === "screened").length;
console.log(`listed held ${held}/12, clean passed ${passed}/12`);
