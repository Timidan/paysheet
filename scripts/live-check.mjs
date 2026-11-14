// Paid check of the real code path: 25 names through both name miners (50 requests, $0.50 test USDC).
// Saves the answers as the fixture that `npm test` replays.
// Run: PAYSHEET_KEY_FILE=~/.some-test-key node scripts/live-check.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { makeAsker, NAME_MINERS, decide } from "../src/screen.mjs";

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
writeFileSync(new URL("../test/fixtures/live-names.json", import.meta.url), JSON.stringify(out, null, 2));
const held = out.filter((r) => r.expect === true && r.decision !== "screened").length;
const passed = out.filter((r) => r.expect === false && r.decision === "screened").length;
console.log(`listed held ${held}/10, invented passed ${passed}/10`);
