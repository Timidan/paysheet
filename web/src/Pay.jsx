import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api, tokenKey, useHome } from "@/lib/api";
import { AppShell, Base, Card, Telegraph, Usdc, btn, link } from "./ui.jsx";

let nextKey = 0;
const blank = () => ({ key: nextKey++, name: "", wallet: "", amount: "" });

export default function Pay() {
  const home = useHome();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (home && !home.error && !rows) setRows((home.sample?.rows || home.sampleRows).map(({ name, wallet, amount }) => ({ key: nextKey++, name, wallet, amount })));
  }, [home, rows]);

  const max = home?.limits?.rows ?? 10;
  const set = (key, field, value) => setRows(rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  const total = (rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const small = total <= (home?.limits?.demoRunTotal ?? 0.25);

  async function submit(e) {
    e.preventDefault();
    setError(""); setBusy(true);
    try {
      const { id, token } = await api("/runs", { rows: rows.map(({ name, wallet, amount }) => ({ name, wallet, amount })) });
      localStorage.setItem(tokenKey(id), token);
      location.href = `/run/${id}`;
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <AppShell>
      <h1 className="text-[clamp(30px,4.4vw,46px)] font-bold leading-[1.02] tracking-[-0.04em]">Who are you paying?</h1>
      <p className="mt-3 max-w-[52ch] text-[17px] text-soft">Each payee is screened before anything is sent. Put in a name from a sanctions list to see a row held.</p>
      {!rows ? (
        <p className="mt-8 text-soft">{home?.error ? "The sheet could not be loaded. Reload the page." : "Loading the sheet"}</p>
      ) : (
        <form onSubmit={submit} noValidate className="mt-8">
          <Card title="Your sheet" meta={<><Base size={14} /> Base Sepolia</>}>
            <div className="hidden grid-cols-[1.3fr_1.9fr_120px_40px] gap-3 border-b border-line px-5 py-2 text-[13px] text-soft sm:grid">
              <span>Payee</span><span>Wallet</span><span>Amount</span><span />
            </div>
            <ul>
              <AnimatePresence initial={false}>
                {rows.map((r, i) => (
                  <motion.li key={r.key} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-b border-line">
                    <div className="grid grid-cols-[1fr_40px] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[1.3fr_1.9fr_120px_40px] sm:px-5">
                      <input className="a-field" aria-label={`Payee ${i + 1} name`} value={r.name} onChange={(e) => set(r.key, "name", e.target.value)} placeholder="Payee name" autoComplete="off" autoFocus={i === rows.length - 1 && !r.name} />
                      <input className="a-field col-start-1 font-mono !text-[13px] sm:col-start-auto" aria-label={`Payee ${i + 1} wallet`} value={r.wallet} onChange={(e) => set(r.key, "wallet", e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} />
                      <label className="relative col-start-1 sm:col-start-auto">
                        <input className="a-field !pr-9 text-right font-mono !text-[14px]" aria-label={`Payee ${i + 1} amount in USDC`} value={r.amount} onChange={(e) => set(r.key, "amount", e.target.value)} inputMode="decimal" placeholder="0.00" />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"><Usdc size={16} /></span>
                      </label>
                      <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} disabled={rows.length < 2} aria-label={`Remove ${r.name || "row"}`} className="a-btn col-start-2 row-start-1 grid h-10 w-10 cursor-pointer place-items-center rounded-md text-[20px] leading-none text-soft transition-colors hover:bg-held-wash hover:text-held disabled:cursor-not-allowed disabled:opacity-30 sm:col-start-auto sm:row-start-auto">×</button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-5">
              <button type="button" className={link} onClick={() => setRows([...rows, blank()])} disabled={rows.length >= max}>Add a payee</button>
              <span className="flex items-center gap-2 text-[14px] text-soft"><Telegraph size={15} /> {rows.length * 3} checks, ${(rows.length * 0.03).toFixed(2)}, paid by Paysheet on testnet</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/80 px-4 py-3 sm:px-5">
              <span className="text-[14.5px] text-soft">
                {small ? "Sheets this small are paid from Paysheet's test wallet, so you need no wallet." : "This sheet is paid from your own wallet on Base Sepolia."}
              </span>
              <button className={btn} disabled={busy}>{busy ? "Starting" : "Screen this sheet"}</button>
            </div>
          </Card>
          {error && <p role="alert" className="mt-3 font-medium text-held">{error}</p>}
        </form>
      )}
    </AppShell>
  );
}
