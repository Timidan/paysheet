import { useEffect, useRef, useState } from "react";
import { api, day, time, tokenKey, usdc, useHome } from "@/lib/api";
import { AppShell, Base, Card, SheetRow, btn, isHeld, link } from "./ui.jsx";

function ReleaseForm({ onSubmit, onCancel }) {
  return (
    <form onSubmit={onSubmit} className="grid max-w-[560px] gap-2 px-4 pb-4 sm:px-5">
      <label htmlFor="reason" className="text-[14.5px]">Why is this payee safe to pay? This is saved on the public record.</label>
      <textarea id="reason" name="reason" required minLength={10} maxLength={300} autoFocus className="a-field min-h-[68px] resize-y" placeholder="For example: different person, ID checked on 12 Nov" />
      <div className="flex items-center gap-4"><button className={btn}>Release this row</button><button type="button" className={link} onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

export default function Run({ id }) {
  const home = useHome();
  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [releasing, setReleasing] = useState(null);
  const token = useRef(localStorage.getItem(tokenKey(id))).current;
  const owner = !!token;

  // Keep reading the run while anything on it is still moving.
  useEffect(() => {
    let timer, stop = false;
    const load = async () => {
      try {
        const r = await api(`/runs/${id}`);
        if (stop) return;
        setRun(r);
        if (r.rows.some((x) => x.state !== "done" || x.pay?.state === "paying")) timer = setTimeout(load, 1500);
      } catch (e) { if (!stop) setError(e.message); }
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, busy]);

  const act = async (label, fn) => {
    setError(""); setBusy(label);
    try { await fn(); } catch (e) { setError(e.message); }
    setBusy("");
  };

  async function payFromWallet() {
    if (!window.ethereum) throw new Error("No wallet found in this browser. Install one, or keep the sheet small enough for the test wallet.");
    const [from] = await window.ethereum.request({ method: "eth_requestAccounts" });
    await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x14a34" }] });
    for (const [i, row] of run.rows.entries()) {
      if (!row.payable) continue;
      setBusy(`Paying ${row.name}`);
      const tx = await api(`/runs/${id}/claim`, { token, row: i });
      let hash;
      try {
        hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from, to: tx.to, data: tx.data }] });
      } catch (e) { // nothing was sent, so the row can be freed
        setRun(await api(`/runs/${id}/unclaim`, { token, row: i }));
        throw new Error(e.code === 4001 ? "You cancelled the transfer in your wallet. Nothing was sent for that row." : e.message);
      }
      // From here a transfer exists. Never free the row on an error, or it could be paid twice.
      setRun(await api(`/runs/${id}/paid`, { token, row: i, tx: hash }));
    }
  }

  if (!run) {
    return <AppShell>{error ? <><p role="alert" className="font-medium text-held">{error}</p><p className="mt-4"><a className={link} href="/">Back to the sample run</a></p></> : <p className="text-soft">Loading the run</p>}</AppShell>;
  }

  const done = run.rows.filter((r) => r.state === "done");
  const paid = run.rows.filter((r) => r.pay?.state === "paid");
  const held = done.filter(isHeld);
  const checks = done.reduce((n, r) => n + r.checks.filter((c) => c.receipt).length, 0);
  const ready = run.rows.filter((r) => r.payable);
  const forTest = run.rows.filter((r) => r.testPayable);
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount), 0);
  const small = sum(run.rows) <= (home?.limits?.demoRunTotal ?? 0.25);
  const working = run.rows.some((r) => r.state !== "done" || ["paying", "claimed"].includes(r.pay?.state));
  const n = (k) => `${k} ${k === 1 ? "row" : "rows"}`;
  const scheduled = run.kind === "scheduled";
  const canRelease = (row) => owner && isHeld(row) && !row.checks.some((c) => c.kind === "wallet" && c.verdict !== "clean");

  return (
    <AppShell>
      <h1 className="text-[clamp(30px,4.4vw,46px)] font-bold leading-[1.02] tracking-[-0.04em]">{scheduled ? "Sample pay run" : owner ? "Your pay run" : "Pay run"}</h1>
      <p className="mt-3 max-w-[58ch] text-[17px] text-soft">
        {scheduled ? "Paysheet runs this sheet by itself once a day." : owner ? "Keep this link: it is the record of this run, and only this browser can change it." : "This is the public record of a pay run. Anyone with the link can read it; only the payer can change it."}
      </p>
      <div className="mt-8">
        <Card
          title={`${day(run.createdAt)}, ${time(run.createdAt)}`}
          meta={<><Base size={14} /> Base Sepolia</>}
          foot={<>
            {done.length === 0 ? <span className="text-[14.5px] text-soft">Screening {run.rows.length} {run.rows.length === 1 ? "payee" : "payees"}. This takes about 15 seconds.</span> : <span className="flex flex-wrap gap-x-5 gap-y-1 text-[14.5px]">
              <span><b className="font-semibold">{paid.length} paid</b>{paid.length ? `, ${usdc(sum(paid))} USDC` : ""}</span>
              <span><b className="font-semibold">{held.length} held</b></span>
              <span className="text-soft">{checks} checks bought for ${(checks * 0.01).toFixed(2)}</span>
            </span>}
            {owner && ready.length > 0 && !working && (
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {small && forTest.length > 0 ? <>
                  <button className={link} disabled={!!busy} onClick={() => act("Paying", payFromWallet)}>Pay from your wallet instead</button>
                  <button className={btn} disabled={!!busy} onClick={() => act("Sending", async () => setRun(await api(`/runs/${id}/pay-demo`, { token })))}>{busy || `Pay ${n(forTest.length)}, ${usdc(sum(forTest))} USDC`}</button>
                </> : (
                  <button className={btn} disabled={!!busy} onClick={() => act("Paying", payFromWallet)}>{busy || `Pay ${n(ready.length)}, ${usdc(sum(ready))} USDC, from your wallet`}</button>
                )}
              </span>
            )}
          </>}
        >
          <ul>
            {run.rows.map((row, i) => (
              <SheetRow key={i} row={row} i={0} below={
                releasing === i
                  ? <ReleaseForm onCancel={() => setReleasing(null)} onSubmit={(e) => { e.preventDefault(); const reason = new FormData(e.target).get("reason"); act("Releasing", async () => { setRun(await api(`/runs/${id}/release`, { token, row: i, reason })); setReleasing(null); }); }} />
                  : canRelease(row) && <p className="px-4 pb-3 sm:px-5"><button className={link} onClick={() => setReleasing(i)}>Release with a reason</button></p>
              } />
            ))}
          </ul>
        </Card>
      </div>
      {error && <p role="alert" className="mt-3 font-medium text-held">{error}</p>}
      {owner && small && forTest.length > 0 && !working && <p className="mt-3 text-[14px] text-soft">Rows you release are paid from your own wallet, never from Paysheet's.</p>}
      <p className="mt-8 flex gap-6"><a className={link} href="/">Back to the sample run</a><a className={link} href="/pay">Pay another sheet</a></p>
    </AppShell>
  );
}
