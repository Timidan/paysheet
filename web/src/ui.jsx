import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { EXPLORER, day, short, time, usdc } from "@/lib/api";
import Guilloche from "./Guilloche.jsx";

export const Usdc = ({ size = 16 }) => <img src="/logos/usdc.svg" alt="USDC" width={size} height={size} className="inline-block shrink-0" />;
export const Telegraph = ({ size = 16 }) => <img src="/logos/telegraph-dark.png" alt="Telegraph" style={{ height: size, width: "auto" }} className="inline-block shrink-0" />;
export const Base = ({ size = 16 }) => <img src="/logos/base.svg" alt="Base" width={size} height={size} className="inline-block shrink-0 rounded-[3px]" />;

export const Tx = ({ hash, children, className = "" }) => (
  <a className={`underline decoration-line underline-offset-3 transition-colors hover:text-green hover:decoration-green ${className}`} href={`${EXPLORER}/tx/${hash}`} target="_blank" rel="noopener">{children}</a>
);

export const isHeld = (row) => row.state === "done" && row.decision !== "screened" && !row.release;
export function heldReason(row) {
  const hit = row.checks?.find((c) => c.verdict === "match");
  if (!hit) return "A provider gave no clear answer, so this is not paid";
  if (hit.kind === "wallet") return "The wallet is on a sanctions list";
  const listed = hit.result?.matches?.[0];
  return `The name matches a sanctions list${listed ? `: ${listed}` : ""}`;
}

// One word for where a row stands, and the line under it.
export function standing(row) {
  if (row.state !== "done") return { kind: "wait", word: "Screening", why: "Buying screening checks" };
  const p = row.pay;
  if (p?.state === "paid") return { kind: "paid", word: "Paid", why: <Tx hash={p.tx}>{usdc(row.amount)} USDC sent{row.release ? " after release" : ""}</Tx> };
  if (p?.state === "paying") return { kind: "wait", word: "Paying", why: p.tx ? <Tx hash={p.tx}>Transfer sent, confirming</Tx> : "Waiting for the transfer to confirm" };
  if (p?.state === "claimed") return { kind: "wait", word: "In your wallet", why: "Confirm the transfer in your wallet" };
  if (row.decision === "screened" || row.release) {
    if (row.expired) return { kind: "wait", word: "Expired", why: "This screen is over 24 hours old. Screen the sheet again before paying." };
    if (p?.state === "failed") return { kind: "ready", word: "Not sent", why: `Payment failed: ${p.error}` };
    return { kind: "ready", word: row.release ? "Released" : "Screened", why: row.release ? "Released by the payer. Ready to pay." : "No match across screening checks. Ready to pay." };
  }
  return { kind: "held", word: "Held", why: heldReason(row) };
}

const ink = { paid: "text-green", held: "text-held", ready: "text-ink" };
export function Stamp({ kind, word, delay = 0, size = "text-[15px]" }) {
  const still = useReducedMotion();
  if (kind === "wait") return <span className={`a-working font-semibold text-soft ${size}`}>{word}</span>;
  return (
    <motion.span
      key={word}
      className={`a-stamp ${size} ${ink[kind]}`}
      initial={still ? false : { scale: 1.3, rotate: -8 }}
      animate={{ scale: 1, rotate: -3 }}
      transition={{ delay, type: "spring", stiffness: 520, damping: 22 }}
    >
      {word}
    </motion.span>
  );
}

const answer = { clean: "No match", match: "Match", unresolved: "No clear answer" };
export function Checks({ row }) {
  return (
    <ul className="grid gap-2.5 px-4 pb-4 text-[14px] sm:px-5">
      {row.checks.map((c, i) => (
        <li key={i} className="grid grid-cols-[18px_1fr_auto] items-center gap-x-2.5 gap-y-0.5">
          <Telegraph size={15} />
          <span className="text-soft"><span className="text-ink">{c.minerName}</span>, {c.kind === "wallet" ? "wallet" : "name"}</span>
          <span className={c.verdict === "clean" ? "text-ink" : "font-semibold text-held"}>{answer[c.verdict]}</span>
          {c.receipt?.tx_hash
            ? <Tx hash={c.receipt.tx_hash} className="col-start-2 font-mono text-[12px] text-soft">0.01 USDC, receipt {short(c.receipt.receipt_hash, 8, 6)}</Tx>
            : <span className="col-start-2 text-[12.5px] text-soft">{c.error || "Not charged"}</span>}
        </li>
      ))}
    </ul>
  );
}

// A row of the sheet. `below` is extra content for the payer (the release form).
export function SheetRow({ row, i, below, stampDelay = 0 }) {
  const s = standing(row);
  const held = isHeld(row);
  const [open, setOpen] = useState(false);
  const canOpen = row.state === "done" && row.checks?.length > 0;
  return (
    <li className={`border-b border-line last:border-b-0 ${held ? "bg-held-wash/60" : ""}`}>
      <button
        onClick={() => canOpen && setOpen(!open)}
        aria-expanded={canOpen ? open : undefined}
        className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 pb-2.5 pt-3 text-left transition-colors sm:grid-cols-[1.5fr_1fr_92px_124px] sm:px-5 ${canOpen ? "cursor-pointer hover:bg-wash/70" : "cursor-default"}`}
      >
        <span className="font-medium [overflow-wrap:anywhere]">{row.name}</span>
        <span className="order-3 font-mono text-[12.5px] text-soft sm:order-none" title={row.wallet}>{short(row.wallet, 6, 4)}</span>
        <span className="order-4 flex items-center justify-end gap-1.5 font-mono text-[14px] sm:order-none">{usdc(row.amount)} <Usdc size={15} /></span>
        <span className="justify-self-end sm:justify-self-start"><Stamp kind={s.kind} word={s.word} delay={stampDelay + i * 0.14} /></span>
      </button>
      <p className={`-mt-1.5 px-4 pb-3 text-[13.5px] sm:px-5 ${held ? "text-held" : "text-soft"}`}>{s.why}</p>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.3, 1] }} className="overflow-hidden">
            <Checks row={row} />
            {row.release && <p className="mx-4 mb-4 rounded-md bg-held-wash px-3 py-2 text-[14px] sm:mx-5"><b className="font-semibold">Released by the payer</b> on {day(row.release.at)}: {row.release.reason}</p>}
            {row.pay?.state === "paid" && (
              <p className="px-4 pb-4 text-[13.5px] text-soft sm:px-5">
                Paid from <span className="font-mono text-[12.5px]">{short(row.pay.from)}</span>. The transfer ends with this screen's fingerprint, <span className="font-mono text-[12.5px]">{short(row.screenHash, 10, 6)}</span>.
              </p>
            )}
            <p className="px-4 pb-4 text-[12.5px] text-soft sm:px-5">Screened {time(row.screenedAt)}, {day(row.screenedAt)}</p>
          </motion.div>
        )}
      </AnimatePresence>
      {below}
    </li>
  );
}

export function Card({ title, meta, children, foot, as: Tag = "section", ...rest }) {
  return (
    <Tag className="rounded-[10px] border border-ink/80 bg-sheet shadow-[0_18px_40px_-22px_rgba(16,35,28,0.45)]" {...rest}>
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-ink/80 px-4 py-3 sm:px-5">
        <span className="font-semibold">{title}</span>
        <span className="flex items-center gap-1.5 text-[13.5px] text-soft">{meta}</span>
      </header>
      {children}
      {foot && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/80 px-4 py-3 sm:px-5">{foot}</footer>}
    </Tag>
  );
}

export const btn = "a-btn inline-flex items-center justify-center gap-2 rounded-md bg-ink px-4 py-2.5 text-[15px] font-semibold text-paper hover:bg-green disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-ink";
export const btnQuiet = "a-btn inline-flex items-center justify-center gap-2 rounded-md border border-ink/80 bg-sheet px-4 py-2.5 text-[15px] font-semibold hover:bg-wash disabled:cursor-not-allowed disabled:opacity-45";
export const link = "cursor-pointer text-[14.5px] underline decoration-line underline-offset-3 transition-colors hover:text-green hover:decoration-green disabled:cursor-not-allowed disabled:opacity-45";

export function Nav() {
  return (
    <header className="relative mx-auto flex max-w-[1120px] items-center justify-between px-4 py-5 sm:px-6">
      <a href="/" className="text-[21px] font-bold tracking-[-0.03em]">Paysheet</a>
      <nav className="flex items-center gap-5 text-[15px]">
        <a href="/#how" className="hidden text-soft transition-colors hover:text-ink sm:inline">How it works</a>
        <a href="/#limits" className="hidden text-soft transition-colors hover:text-ink sm:inline">Limits</a>
        <a href="/pay" className={`${btn} !px-3.5 !py-2`}>Pay a sheet</a>
      </nav>
    </header>
  );
}

export function Foot() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-4 px-4 py-7 text-[14.5px] text-soft sm:px-6">
        <span>Runs on Base Sepolia with test USDC. Screens are bought through Telegraph.</span>
        <span className="flex items-center gap-4"><Base size={18} /><Usdc size={18} /><Telegraph size={18} /></span>
      </div>
    </footer>
  );
}

// The app pages: the banknote pattern as a band at the top, the work below it.
export function AppShell({ children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <div className="relative flex-1 overflow-hidden">
        <Guilloche className="absolute inset-x-0 top-0 h-[420px] w-full opacity-45 [mask-image:linear-gradient(#000_40%,transparent)] sm:opacity-80" />
        <Nav />
        <main className="relative mx-auto max-w-[920px] px-4 pb-24 pt-6 sm:px-6 sm:pt-10">{children}</main>
      </div>
      <Foot />
    </div>
  );
}
