import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useTransform } from "motion/react";
import { day, short, usdc, useHome } from "@/lib/api";
import Guilloche from "./Guilloche.jsx";
import { Base, Card, Foot, Nav, SheetRow, Stamp, Telegraph, Tx, Usdc, btn, btnQuiet, heldReason, isHeld } from "./ui.jsx";

function Sheet({ sample }) {
  const paid = sample.rows.filter((r) => r.pay?.state === "paid");
  const total = paid.reduce((s, r) => s + Number(r.amount), 0);
  return (
    <Card
      aria-label="Sample pay run"
      title={`Pay run, ${day(sample.createdAt)}`}
      meta={<><Base size={14} /> Base Sepolia</>}
      foot={<>
        <span className="text-[14.5px]"><b className="font-semibold">{paid.length} paid</b>, {usdc(total)} USDC. <b className="font-semibold">{sample.rows.length - paid.length} held</b>. <a href={`/run/${sample.id}`} className="underline decoration-line underline-offset-3 hover:text-green">Record</a></span>
        <a href="/pay" className={btn}>Change the sheet and run it yourself</a>
      </>}
    >
      <ul>{sample.rows.map((row, i) => <SheetRow key={i} row={row} i={i} stampDelay={0.35} />)}</ul>
    </Card>
  );
}

// A banknote rosette drawn once as SVG. Scrolling turns it, like a lathe cutting the pattern.
const ROSETTE = Array.from({ length: 22 }, (_, k) => {
  const p = (k / 22) * Math.PI * 2;
  let d = "";
  for (let i = 0; i <= 360; i++) {
    const a = (i / 360) * Math.PI * 2;
    const r = 300 * (1 + 0.17 * Math.sin(14 * a + p) + 0.07 * Math.sin(35 * a - p * 1.7));
    d += `${i ? "L" : "M"}${(400 + r * Math.cos(a)).toFixed(1)} ${(400 + r * Math.sin(a)).toFixed(1)}`;
  }
  return d + "Z";
});
function Rosette({ rotate, color }) {
  return (
    <motion.svg aria-hidden="true" viewBox="0 0 800 800" style={{ rotate }} className="pointer-events-none absolute left-1/2 top-1/2 h-[150%] max-h-[900px] w-auto -translate-x-1/2 -translate-y-1/2">
      {ROSETTE.map((d, i) => <motion.path key={i} d={d} fill="none" style={{ stroke: color }} strokeWidth="0.7" strokeOpacity="0.28" />)}
    </motion.svg>
  );
}

const answer = { clean: "No match", match: "Match", unresolved: "No clear answer" };
// One payee on a pay slip. `done` is how many checks have come back.
// When `done > totalChecks`, all checks are completed and the decision stamp is rendered.
function Slip({ row, done }) {
  const held = isHeld(row);
  const totalChecks = row.checks?.length ?? 4;
  const decided = done > totalChecks;
  return (
    <div className={`relative mx-auto w-full max-w-[540px] rounded-[10px] border-2 bg-sheet px-5 py-5 shadow-[0_22px_50px_-26px_rgba(16,35,28,0.5)] transition-colors duration-300 sm:px-7 sm:py-6 ${decided ? (held ? "border-held" : "border-green") : "border-line"}`}>
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-[19px] font-semibold">{row.name}</span>
        <span className="flex items-center gap-1.5 font-mono text-[15px]">{usdc(row.amount)} <Usdc /></span>
      </div>
      <div className="mt-0.5 font-mono text-[12.5px] text-soft">{short(row.wallet, 10, 8)}</div>
      <ol className="mt-5 grid gap-3">
        {row.checks.map((c, i) => {
          const back = done > i;
          return (
            <li key={i} className={`grid grid-cols-[20px_1fr_auto] items-center gap-x-3 border-t border-line pt-3 text-[15px] transition-opacity duration-300 ${back ? "" : "opacity-45"}`}>
              <Telegraph size={17} />
              <span>{c.minerName}<span className="block text-[13px] text-soft">{c.kind === "wallet" ? "Wallet" : "Name"} check, 0.01 USDC</span></span>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={back ? "a" : "w"} initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }} transition={{ duration: 0.18 }} className={!back ? "text-soft" : c.verdict === "clean" ? "font-medium" : "font-semibold text-held"}>
                  {back ? answer[c.verdict] : "Waiting"}
                </motion.span>
              </AnimatePresence>
            </li>
          );
        })}
      </ol>
      <div className="mt-5 flex min-h-[46px] items-center justify-between gap-4 border-t border-ink/80 pt-4">
        <span className="text-[14.5px]">
          {!decided ? <span className="text-soft">{totalChecks ? `Nothing moves until all ${totalChecks} are back` : "Nothing moves until checks are back"}</span> : held ? heldReason(row) : row.pay?.tx ? <Tx hash={row.pay.tx}>Transfer {short(row.pay.tx, 8, 6)}</Tx> : "Ready to pay"}
        </span>
        {decided && <Stamp kind={held ? "held" : "paid"} word={held ? "Held" : "Paid"} size="text-[22px]" />}
      </div>
    </div>
  );
}

function Walkthrough({ sample }) {
  const ref = useRef(null);
  const still = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const clean = sample.rows.find((r) => r.pay?.state === "paid") || sample.rows[0];
  const listed = sample.rows.find((r) => isHeld(r) && r.checks.filter((c) => c.verdict === "match").length > 1) || sample.rows.find(isHeld) || clean;

  // Dynamically derive check sequence and steps from the sample rows so it cleanly adapts to persisted or fresh samples
  const sampleChecks = clean?.checks || listed?.checks || [];
  const checkSteps = sampleChecks.map((c, i) => {
    if (c.kind === "wallet") return "Wallet check";
    const ordinals = ["First", "Second", "Third", "Fourth", "Fifth"];
    return `${ordinals[i] || `Check ${i + 1}`} name check`;
  });
  const STEPS = ["Listed on the sheet", ...checkSteps, "Decided"];
  const totalChecks = sampleChecks.length || 4;
  const stepsPerPayee = STEPS.length;
  const totalBeats = stepsPerPayee * 2;

  // Beats per payee: slip only ever shows a whole state, so it is never half drawn.
  const [beat, setBeat] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setBeat(Math.min(totalBeats - 1, Math.max(0, Math.floor(v * totalBeats)))));
  const turn = useTransform(scrollYProgress, [0, 1], [0, 150]);
  const inkColor = useTransform(scrollYProgress, [0.46, 0.54], ["#0d5a3c", "#b0301a"]);
  const second = beat >= stepsPerPayee;
  const step = second ? beat - stepsPerPayee : beat;

  const checkWord = ["zero", "one", "two", "three", "four", "five"][totalChecks] || String(totalChecks);
  const checkWordCap = checkWord.charAt(0).toUpperCase() + checkWord.slice(1);

  const head = (
    <div className="max-w-[30ch]">
      <h2 className="text-[clamp(28px,3.6vw,44px)] font-semibold leading-[1.05] tracking-[-0.03em]">{checkWordCap} checks, then the money moves or it does not.</h2>
      <p className="mt-4 text-[17px] text-soft">Paysheet buys each check itself, from providers it names, for one cent. A row is paid only when all {checkWord} say no match.</p>
    </div>
  );
  if (still) {
    return (
      <section id="how" className="border-t border-line bg-wash/50">
        <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-24 sm:px-6">
          {head}
          <div className="grid gap-8 md:grid-cols-2"><Slip row={clean} done={(clean.checks?.length || 4) + 1} /><Slip row={listed} done={(listed.checks?.length || 4) + 1} /></div>
        </div>
      </section>
    );
  }
  return (
    <section id="how" ref={ref} className="relative h-[460vh] border-t border-line bg-wash/50">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-[1120px] items-center gap-6 px-4 sm:px-6 md:grid-cols-[1fr_1.15fr] md:gap-8">
          <div>
            <div className="max-md:hidden">{head}</div>
            <h2 className="text-[26px] font-semibold leading-[1.08] tracking-[-0.03em] md:hidden">{checkWordCap} checks, then the money moves or it does not.</h2>
            <ol className="mt-5 hidden gap-1.5 text-[15px] md:grid" aria-hidden="true">
              {STEPS.map((s, i) => (
                <li key={s} className={`flex items-center gap-3 transition-colors duration-200 ${i === step ? "font-semibold text-ink" : i < step ? "text-soft" : "text-soft/60"}`}>
                  <span className={`h-[2px] transition-all duration-300 ${i === step ? "w-8 bg-green" : "w-4 bg-line"}`} />{s}
                </li>
              ))}
            </ol>
            <p className="mt-3 text-[14.5px] text-soft" aria-live="polite">
              <span className="md:hidden">{STEPS[step]}. </span>Payee {second ? 2 : 1} of 2: {second ? "a name on a sanctions list" : "a clean name"}
            </p>
          </div>
          <div className="relative grid min-h-[380px] items-center">
            <Rosette rotate={turn} color={inkColor} />
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={second ? "listed" : "clean"} initial={{ y: 36, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -36, opacity: 0 }} transition={{ duration: 0.25, ease: [0.2, 0.8, 0.3, 1] }} className="relative">
                <Slip row={second ? listed : clean} done={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function Proof({ sample }) {
  const row = sample.rows.find((r) => r.pay?.state === "paid");
  const [hover, setHover] = useState(3);
  const [copied, setCopied] = useState(false);
  if (!row) return null;
  const count = row.checks?.length ?? 4;
  const countWord = ["zero", "one", "two", "three", "four", "five"][count] || String(count);
  const amount = BigInt(Math.round(Number(row.amount) * 1e6)).toString(16).padStart(64, "0");
  const parts = [
    { text: "0xa9059cbb", says: "Transfer", note: "The standard USDC transfer call." },
    { text: row.wallet.slice(2).toLowerCase().padStart(64, "0"), says: "To", note: `Pays ${row.name}.` },
    { text: amount, says: "Amount", note: `${usdc(row.amount)} USDC.` },
    { text: row.screenHash.slice(2), says: "Screen fingerprint", note: `A hash of the payee, the amount and the ${countWord} Telegraph receipts. USDC ignores this extra data and the chain keeps it.` },
  ];
  const copy = () => navigator.clipboard?.writeText(row.screenHash).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1400); });
  return (
    <section className="border-y border-line">
      <div className="mx-auto grid max-w-[1120px] gap-8 px-4 py-20 sm:px-6 md:grid-cols-[1fr_1.3fr] md:items-start">
        <div>
          <h2 className="text-[clamp(26px,3.2vw,38px)] font-semibold leading-[1.08] tracking-[-0.03em]">The payment carries its own screen.</h2>
          <p className="mt-4 max-w-[38ch] text-[17px] text-soft">Anyone holding the transfer can check that {row.name} was screened before {usdc(row.amount)} USDC left, and by whom.</p>
          <a className={`${btnQuiet} mt-6`} href={`https://sepolia.basescan.org/tx/${row.pay.tx}`} target="_blank" rel="noopener"><Base size={15} /> Open this transfer</a>
        </div>
        <div className="rounded-[10px] border border-ink/80 bg-sheet p-4 sm:p-5">
          <p className="break-all font-mono text-[13px] leading-[1.75]">
            {parts.map((p, i) => (
              <span key={i} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} className={`cursor-default rounded-[3px] px-0.5 transition-colors ${hover === i ? (i === 3 ? "bg-green text-paper" : "bg-ink text-paper") : i === 3 ? "bg-[#d5eadc]" : "text-soft"}`}>{p.text}</span>
            ))}
          </p>
          <div className="mt-4 flex min-h-[68px] flex-wrap items-start justify-between gap-x-4 gap-y-3 border-t border-line pt-3">
            <p className="max-w-[44ch] text-[14.5px]"><b className="font-semibold">{parts[hover].says}.</b> {parts[hover].note}</p>
            <button onClick={copy} className="a-btn shrink-0 cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13.5px] font-medium hover:border-ink/60">{copied ? "Copied" : "Copy fingerprint"}</button>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  const home = useHome();
  const sample = home?.sample;
  return (
    <div className="min-h-screen">
      <div className="relative overflow-hidden">
        <Guilloche className="absolute inset-0 h-full w-full opacity-45 sm:opacity-100" />
        <Nav />
        <main className="relative mx-auto grid max-w-[1120px] items-start gap-10 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[0.82fr_1fr] lg:gap-12 lg:pt-14">
          <div>
            <h1 className="text-[clamp(38px,5.2vw,64px)] font-bold leading-[0.98] tracking-[-0.045em]">Pay contractors in USDC. Sanctions screened first.</h1>
            <p className="mt-5 max-w-[40ch] text-[18px] text-soft">Every payee is checked before any money moves. Clean rows are paid. The rest are held, with the reason.</p>
            <p className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14.5px] text-soft">
              <span className="flex items-center gap-1.5"><Usdc size={17} /> USDC</span>
              <span className="flex items-center gap-1.5"><Base size={16} /> Base</span>
              <span className="flex items-center gap-1.5"><Telegraph size={17} /> Screens from Telegraph</span>
            </p>
          </div>
          {sample
            ? <Sheet sample={sample} />
            : <div className="rounded-[10px] border border-ink/80 bg-sheet px-5 py-10 text-soft">
                {home?.error ? "The sample run could not be loaded. Reload the page." : home ? <>Today's sample run is being screened. <a className="underline" href="/pay">Run your own sheet</a> meanwhile.</> : "Loading the sample run"}
              </div>}
        </main>
      </div>
      {sample && <Walkthrough sample={sample} />}
      {sample && <Proof sample={sample} />}
      <section id="limits" className="mx-auto max-w-[1120px] px-4 py-20 sm:px-6">
        <h2 className="text-[clamp(24px,3vw,34px)] font-semibold tracking-[-0.03em]">Limits</h2>
        <ul className="mt-5 grid max-w-[70ch] list-disc gap-2.5 pl-5 text-[16.5px] text-soft marker:text-green">
          <li>This runs on Base Sepolia with test USDC. Nothing here moves real money.</li>
          <li>A no match is a screen against published sanctions lists on that date. It is not legal clearance.</li>
          <li>Common names can match a listed person. The payer can release a held name with a written reason, which stays on the record.</li>
          <li>Paysheet names the providers it buys from{home?.miners ? ` (${Object.values(home.miners).join(" and ")})` : ""} and never lets the network pick one.</li>
        </ul>
      </section>
      <Foot />
    </div>
  );
}
