// Sanctions screening bought through Telegraph, from named miners only.
// The routed path (/ask with no miner) answered "no match" for every listed
// name in our 13 Nov test, so it is never used here.
import { randomUUID } from "node:crypto";
import { keccak256, toHex } from "viem";

export const NODE = "https://devnode.telegraphprotocol.com/engine/v1/ask";
export const INTENT = "SANCTIONS_SCREENING_MATCH_GENERAL";
export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"; // Base Sepolia, for the payouts
export const PRICE_UUSDC = 10000; // $0.01 per request
// Requests are charged to a prepaid escrow balance on Telegraph's contract, on Ethereum Sepolia.
export const ESCROW_NETWORK = "eip155:11155111";
export const DIAMOND = "0x72a70e949362670bf8bcead24efc5b8f950aa08b";
// A miner's own "no match" does not clear a name this similar to a listed one.
export const HOLD_SCORE = 0.7;

// Two independent miners screen the name; the first also screens the wallet.
export const MINERS = {
  "64175": "OathCast Sanctions Screen",
  "710637": "Sanctions Name Evidence",
};
export const NAME_MINERS = ["64175", "710637"];
export const WALLET_MINER = "64175";

// One answer -> "clean" | "match" | "unresolved".
// Clean only when the miner we named answered the question we sent with an
// explicit, valid "no match" and Telegraph returned a receipt for the request.
// Everything that is not provably clean holds.
const RECEIPT_HASH = /^0x[0-9a-f]{64}$/i;
export function judge(miner, sent, status, body, receipt) {
  if (status !== 200 || !body || typeof body !== "object") return "unresolved";
  if (String(body.miner_id) !== String(miner)) return "unresolved";
  if (body.input?.name !== sent) return "unresolved";
  const matched = body.result?.matched;
  const score = Number(body.result?.match_score);
  if (matched === true || score >= HOLD_SCORE) return "match";
  if (body.field_status?.matched === "ok" && matched === false)
    return RECEIPT_HASH.test(receipt?.receipt_hash) ? "clean" : "unresolved"; // no Telegraph receipt, no pass
  if (score > 0) return "match"; // a score with a dropped field still holds
  return "unresolved";
}

// All answers for a row -> decision.
export function decide(verdicts) {
  if (verdicts.includes("match")) return "held_match";
  if (verdicts.every((v) => v === "clean")) return "screened";
  return "held_unresolved";
}

// The only text this app signs. The node's challenge must carry exactly this
// template, so the network, the contract, the price and the resource are ours.
const template = (miner) =>
  `Telegraph Escrow Payment\n\nWallet: {from}\nPay To: ${DIAMOND}\nNetwork: ${ESCROW_NETWORK}\nAmount: ${PRICE_UUSDC} uUSDC\n` +
  `Resource: /v1/ask/${miner}\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}`;

export async function makeAsker(privateKey) {
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(privateKey);
  const from = account.address.toLowerCase();
  // Ask for the challenge, check it, sign it, send the request again with the signature.
  async function pay(miner, init) {
    const url = `${NODE}/${miner}`;
    const first = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    if (first.status !== 402) return first;
    const header = first.headers.get("payment-required");
    const offer = header && JSON.parse(Buffer.from(header, "base64").toString()).accepts?.find((a) => a.scheme === "escrow");
    if (offer?.extra?.message !== template(miner)) throw new Error("Telegraph's escrow challenge is not the one this app signs.");
    const now = Math.floor(Date.now() / 1000);
    const authorization = { from, to: DIAMOND, value: String(PRICE_UUSDC), validAfter: String(now - 10), validBefore: String(now + 100), nonce: randomUUID() };
    const message = template(miner).replace("{from}", from).replace("{nonce}", authorization.nonce)
      .replace("{validAfter}", authorization.validAfter).replace("{validBefore}", authorization.validBefore);
    const payment = { x402Version: 2, scheme: "escrow", network: ESCROW_NETWORK, payload: { signature: await account.signMessage({ message }), authorization } };
    return fetch(url, { ...init, signal: AbortSignal.timeout(60_000), headers: { ...init.headers, "X-PAYMENT": Buffer.from(JSON.stringify(payment)).toString("base64") } });
  }
  // One paid request to one named miner. Never throws: a failure is an unresolved check.
  return async function ask(miner, subject, kind) {
    const started = Date.now();
    const check = { miner, minerName: MINERS[miner], kind, subject };
    try {
      const res = await pay(miner, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json", "User-Agent": "paysheet/0.1" },
        body: JSON.stringify({ intent: INTENT, params: { name: subject } }),
      });
      const body = await res.json().catch(() => null);
      const raw = res.headers.get("x-payment-response");
      const receipt = raw ? JSON.parse(Buffer.from(raw, "base64").toString()) : null;
      return {
        ...check,
        verdict: judge(miner, subject, res.status, body, receipt),
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
