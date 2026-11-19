# Paysheet

Pay your contractors in USDC; every payment carries the sanctions screen that was run before it.

Paysheet takes a sheet of payees (name, wallet, amount). Before any money moves it buys four sanctions checks per row from named providers on [Telegraph](https://telegraphprotocol.com/), paying for each one itself over x402. A row is paid only if all four checks answer "no match" in so many words. Anything else is held, with the reason shown.

Live: https://paysheet.timidan.xyz

Testnet only: Base Sepolia and test USDC. Built for Telegraph Hackathon Season II, Mission 02 (Stablecoin).

## What happens to a row

1. **Screen.** The payee's name goes to three providers and the wallet address goes to one. Each request costs 0.01 test USDC, paid by the app's own wallet with a signed x402 payment. No person approves it.
2. **Decide.** All four say "no match": the row can be paid. A match: held. A provider that errors, answers for a different name, or leaves the match field empty: held as unresolved. A missing answer never counts as a pass.
3. **Pay.** Each payment is a plain USDC `transfer` with a 32-byte fingerprint of the screen appended to the call data. The fingerprint is the hash of the name, wallet, amount, the Telegraph receipts and the time of the screen, so the transfer on the explorer points back to the checks that allowed it.
4. **Record.** Every run has a public page with each row's checks, the Telegraph receipt hashes, and the transfer.

If a provider is down or answers with empty fields, the row is held as unresolved. The app's own daily run screens again within the hour, and the home page keeps showing the last sample that every provider answered. This happened on 14 Nov 2026: both providers returned empty answers for one run, six rows were held, and the next run an hour or so later paid the three clean ones.

A held name can be released by the person who made the sheet, with a written reason that stays on the record. A row held because of its wallet address cannot be released. Released rows are paid from the payer's own wallet, never the app's.

## The Telegraph requests

| | |
|---|---|
| Intent | `SANCTIONS_SCREENING_MATCH_GENERAL` |
| Node | `https://devnode.telegraphprotocol.com/engine/v1/ask/{minerId}` |
| Name checks | miner 731002 (Counterproof Sanctions Screener), miner 710637 (Sanctions Name Evidence), and miner 5281 (Praman Desk Compliance Screener) |
| Wallet check | miner 731002 |
| Price | 0.01 test USDC per request, four requests per row |
| Payment | x402 on Base Sepolia, gasless signature, receipt in the `x-telegraph-receipt` header |

Requests go to named providers, not to the routed endpoint. In our paid test on 13 Nov 2026 the routed endpoint sent every request to one general provider that answered "no match" for all ten listed names we tried.

The app also runs on its own once a day: it screens the sample sheet and pays the rows that pass, with nobody present.

## Evidence

- `test/fixtures/live-names.json` holds the recorded answers from a paid run through this code: 10 listed names, 10 invented names, with their receipts. All 10 listed names were held and all 10 invented names passed.
- `npm test` replays those answers through the pay-or-hold rule.
- `PAYSHEET_KEY_FILE=<key file> node scripts/live-check.mjs` repeats the paid run (75 requests, about 0.75 test USDC).

## Run it

You need Node 22 or newer, and a wallet key file that holds test USDC on Base Sepolia ([Circle's faucet](https://faucet.circle.com/)). The same wallet needs a little Base Sepolia ETH if you want the app to send small payments itself.

```bash
npm install
```

```bash
npm run build
```

```bash
PAYSHEET_KEY_FILE=/path/to/key npm start
```

The second command builds the pages in `web/` (React, Tailwind, Motion). Open http://localhost:4410. The key file is one line: a 0x private key. Use a wallet made for this, with faucet funds only.

Try it:

1. The home page shows the latest scheduled run of the sample sheet: three rows pass, three are held (a similar name, a listed wallet, a listed name).
2. Choose "Change the sheet and run it yourself", add a row with a name from a sanctions list, and press "Screen this sheet". That row is held; the others pass and can be paid.
3. Open a held row to see which provider said what, and the receipt hash for each request.

Settings:

| Variable | Meaning |
|---|---|
| `PAYSHEET_KEY_FILE` | Path to the app wallet's key file. Required. |
| `PORT` | Default 4410. |
| `BASE_SEPOLIA_RPC` | Default `https://sepolia.base.org`. |
| `PAYSHEET_NO_DAILY=1` | Turns off the daily run. |

## Spending limits

- 10 rows per sheet, 300 screening requests a day (3 test USDC), 6 runs an hour per visitor.
- The app's wallet pays only sheets of 0.25 test USDC or less, and at most 2 test USDC a day. Larger sheets are paid from the visitor's own wallet; the app never holds anyone's funds.
- A screen is good for 24 hours. After that the row must be screened again before it can be paid.

## Limits

- Names and wallet addresses are screened against the lists the providers hold. Those lists are dated snapshots.
- "No match" is not legal clearance. Paysheet calls a row screened, never cleared.
- No checks by date of birth or country, no fiat, one chain, no approvals by several people.
- Runs are stored in one JSON file. That suits a demo, not production.
