// Illustrations for the marketing pages, drawn with CSS and SVG (no image
// downloads). Each feature gets a small living scene; all motion is CSS and
// switches off for people who prefer reduced motion. Decorative only.
import clsx from "clsx";
import type { CSSProperties, ReactNode } from "react";
import { FitBox } from "./interactive";

type V = CSSProperties & Record<`--${string}`, string>;

/** A floating piece of a scene. Small badges (`badge`) fade in and stay put. */
function Float({ className, style, delay = 0, badge, children }: { className?: string; style?: V; delay?: number; badge?: boolean; children: ReactNode }) {
  return (
    <div className={clsx(badge ? "ob-badge" : "ob-piece", "absolute", className)} style={{ animationDelay: badge ? `${delay}ms` : `${delay}ms, ${delay + 900}ms`, ...style }}>
      {children}
    </div>
  );
}

const Glass = ({ className, children }: { className?: string; children: ReactNode }) => <div className={clsx("p-glass rounded-[18px]", className)}>{children}</div>;
const Line = ({ w, className }: { w: string; className?: string }) => <span className={clsx("ob-shimmer block h-2 rounded-full", className)} style={{ width: w }} />;
const Pill = ({ children, tone = "lavender" }: { children: ReactNode; tone?: string }) => (
  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold whitespace-nowrap" style={{ background: `var(--p-${tone})`, color: `var(--p-${tone}-ink)` }}>
    {children}
  </span>
);
const Check = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <FitBox>
      <div aria-hidden className={clsx("relative aspect-[5/4] w-full select-none", className)}>
        {children}
      </div>
    </FitBox>
  );
}

function Browser({ url = "yourbrand.com", children, className }: { url?: string; children: ReactNode; className?: string }) {
  return (
    <Glass className={clsx("overflow-hidden", className)}>
      <div className="flex items-center gap-1.5 border-b border-fg/5 px-3 py-2">
        <span className="size-2 rounded-full bg-[#ff5f57]" />
        <span className="size-2 rounded-full bg-[#febc2e]" />
        <span className="size-2 rounded-full bg-[#28c840]" />
        <span className="mx-auto rounded-full bg-fg/[0.06] px-3 py-0.5 text-[9px] font-medium text-fg/50">{url}</span>
      </div>
      {children}
    </Glass>
  );
}

export function LaunchScene() {
  return (
    <Frame>
      <Float className="top-[4%] left-[2%] w-[64%]" style={{ "--rot": "-2deg", "--dur": "9s" }}>
        <Glass className="p-4">
          <p className="text-[10px] font-medium text-fg/50">Tell us about your business</p>
          <p className="mt-1.5 text-[13px] leading-snug font-medium">
            Handwoven kurtas from Jaipur, plus a little shop counter<span className="mk-caret" />
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="mk-loop" style={{ "--d": "0.4s" } as V}><Pill tone="peach"><Check /> Fashion store</Pill></span>
            <span className="mk-loop" style={{ "--d": "0.8s" } as V}><Pill tone="mint"><Check /> Sells in a shop</Pill></span>
            <span className="mk-loop" style={{ "--d": "1.2s" } as V}><Pill tone="sky"><Check /> GST invoices</Pill></span>
          </div>
        </Glass>
      </Float>
      <Float className="right-[2%] bottom-[6%] w-[60%]" style={{ "--rot": "2deg", "--dur": "8s" }} delay={250}>
        <Glass className="p-4">
          <p className="text-[10px] font-semibold tracking-wider text-fg/45 uppercase">Launching Saanjh…</p>
          <ul className="mt-2 grid gap-1.5 text-[11px]">
            {["Applying your design", "Adding 24 products", "Turning on COD & UPI", "Publishing"].map((s, i) => (
              <li key={s} className="mk-loop flex items-center gap-2" style={{ "--d": `${0.6 + i * 0.5}s`, "--loop": "7s" } as V}>
                <span className="grid size-4 place-items-center rounded-full bg-fg text-bg"><Check /></span>
                {s}
              </li>
            ))}
          </ul>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fg/10"><span className="ob-grow block h-full rounded-full bg-gradient-to-r from-[var(--p-peach-ink)] via-[var(--p-lavender-ink)] to-[var(--p-mint-ink)]" /></div>
        </Glass>
      </Float>
      <Float badge className="top-[46%] left-[8%]" style={{ "--rot": "-4deg" }} delay={600}>
        <Pill tone="butter">≈ 5 minutes to live</Pill>
      </Float>
    </Frame>
  );
}

export function BuilderScene() {
  return (
    <Frame>
      <Float className="top-[6%] left-[3%] w-[78%]" style={{ "--rot": "-1.5deg", "--dur": "10s" }}>
        <Browser>
          <div className="grid gap-3 p-4">
            <div className="relative rounded-[10px] border-2 border-dashed border-[var(--p-lavender-ink)]/60 p-3">
              <span className="absolute -top-2.5 left-2 rounded-full bg-[var(--p-lavender-ink)] px-2 text-[8px] font-semibold text-white">Heading</span>
              <p className="text-[18px] leading-tight font-semibold tracking-tight">Everyday pieces, made to last<span className="mk-caret" /></p>
            </div>
            <Line w="80%" />
            <div className="grid grid-cols-3 gap-2">
              {["var(--p-peach)", "var(--p-mint)", "var(--p-sky)"].map((c) => <span key={c} className="aspect-[4/3] rounded-[8px]" style={{ background: c }} />)}
            </div>
          </div>
        </Browser>
      </Float>
      <Float className="right-[2%] top-[34%] w-[34%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="grid gap-2 p-3 text-[10px]">
          <p className="font-semibold">Style</p>
          <div className="flex gap-1">{["#111111", "#4f46e5", "#0f766e", "#c2410c"].map((c, i) => <span key={c} className={clsx("size-4 rounded-full", i === 1 && "ring-2 ring-fg/60 ring-offset-1")} style={{ background: c }} />)}</div>
          <div className="flex items-center justify-between text-fg/60"><span>Size</span><span>42px</span></div>
          <div className="h-1 rounded-full bg-fg/10"><span className="block h-full w-2/3 rounded-full bg-fg/70" /></div>
        </Glass>
      </Float>
      <Float badge className="bottom-[3%] left-[14%]" style={{ "--rot": "-3deg" }} delay={500}>
        <div className="flex gap-1.5">
          {["Desktop", "Tablet", "Phone"].map((d, i) => <span key={d} className={clsx("rounded-full px-2.5 py-1 text-[10px] font-semibold", i === 0 ? "bg-fg text-bg" : "p-glass")}>{d}</span>)}
        </div>
      </Float>
    </Frame>
  );
}

export function StoreScene() {
  return (
    <Frame>
      <Float className="top-[4%] left-[2%] w-[70%]" style={{ "--rot": "-2deg", "--dur": "9s" }}>
        <Browser url="saanjh.in/shop">
          <div className="grid grid-cols-3 gap-2 p-3">
            {[["var(--p-peach)", "₹1,899"], ["var(--p-lavender)", "₹999"], ["var(--p-mint)", "₹2,499"], ["var(--p-sky)", "₹1,299"], ["var(--p-butter)", "₹799"], ["var(--p-rose)", "₹3,999"]].map(([c, p]) => (
              <div key={c} className="grid gap-1">
                <span className="aspect-square rounded-[8px]" style={{ background: c }} />
                <Line w="80%" className="h-1.5" />
                <span className="text-[9px] font-semibold">{p}</span>
              </div>
            ))}
          </div>
        </Browser>
      </Float>
      <Float className="right-[2%] top-[30%] w-[38%]" style={{ "--rot": "3deg", "--dur": "8.5s" }} delay={250}>
        <Glass className="grid gap-2 p-3 text-[10px]">
          <p className="font-semibold">Checkout</p>
          {["Cash on delivery", "UPI", "Card"].map((m, i) => (
            <span key={m} className={clsx("flex items-center justify-between rounded-[8px] border px-2 py-1.5", i === 1 ? "border-fg/60 bg-bg" : "border-fg/10")}>
              {m}
              <span className={clsx("size-2.5 rounded-full border", i === 1 ? "border-fg bg-fg" : "border-fg/30")} />
            </span>
          ))}
          <span className="mt-1 rounded-full bg-fg py-1.5 text-center font-semibold text-bg">Pay ₹2,898</span>
        </Glass>
      </Float>
      <Float badge className="bottom-[8%] left-[6%]" style={{ "--rot": "-2deg" }} delay={500}>
        <span className="mk-loop inline-block" style={{ "--loop": "5s" } as V}>
          <Glass className="flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[11px] font-semibold">
            <span className="grid size-6 place-items-center rounded-full bg-[var(--p-mint)] text-[var(--p-mint-ink)]">₹</span>
            New order · #1042 · Paid
          </Glass>
        </span>
      </Float>
      <Float badge className="bottom-[22%] left-[40%]" style={{ "--rot": "4deg" }} delay={800}>
        <Pill tone="sky">GST invoice ready</Pill>
      </Float>
    </Frame>
  );
}

export function PosScene() {
  return (
    <Frame>
      <Float className="top-[8%] left-[4%] w-[46%]" style={{ "--rot": "-4deg", "--dur": "9s" }}>
        <div className="rounded-[12px] bg-white p-3 font-mono text-[9px] leading-tight text-black shadow-[0_30px_50px_-30px_rgb(0_0_0/.55)]">
          <p className="text-center font-sans text-[10px] font-bold">SAANJH STUDIO</p>
          <p className="text-center text-[8px] text-black/60">Tax invoice INV/2026-27/0118</p>
          <div className="mt-2 grid gap-0.5">
            <p className="flex justify-between"><span>Kurta (M) × 1</span><span>1,899</span></p>
            <p className="flex justify-between"><span>Dupatta × 2</span><span>1,398</span></p>
            <p className="flex justify-between text-black/60"><span>CGST 2.5%</span><span>78.50</span></p>
            <p className="flex justify-between text-black/60"><span>SGST 2.5%</span><span>78.50</span></p>
          </div>
          <p className="mt-1.5 flex justify-between border-t border-dashed border-black/40 pt-1.5 text-[11px] font-bold"><span>TOTAL</span><span>₹3,297</span></p>
          <p className="mt-1 text-black/60">Cash ₹3,500 · Change ₹203</p>
        </div>
      </Float>
      <Float className="right-[4%] top-[14%] w-[42%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <div className="rounded-[10px] bg-white p-3 shadow-[0_24px_40px_-24px_rgb(0_0_0/.5)]">
          <p className="text-[10px] font-bold text-black">Linen Kurta</p>
          <p className="text-[13px] font-extrabold text-black">₹1,899</p>
          <div className="relative mt-2 flex h-12 items-end gap-[2px] overflow-hidden">
            {[2, 1, 1, 3, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 3, 1, 2, 1, 1, 2, 1].map((w, i) => <span key={i} className="h-full bg-black" style={{ width: w }} />)}
            <span className="mk-beam absolute inset-x-0 top-1 h-[2px] bg-[#ef4444] shadow-[0_0_10px_#ef4444]" style={{ "--beam": "38px" } as V} />
          </div>
          <p className="mt-1 text-center font-mono text-[8px] tracking-[0.2em] text-black">2 034170 000018</p>
        </div>
      </Float>
      <Float badge className="bottom-[8%] left-[30%]" style={{ "--rot": "-2deg" }} delay={600}>
        <span className="mk-loop inline-block" style={{ "--loop": "4.5s" } as V}><Pill tone="mint"><Check /> Beep! Added to the bill</Pill></span>
      </Float>
      <Float badge className="right-[8%] bottom-[18%]" style={{ "--rot": "4deg" }} delay={900}>
        <Glass className="grid gap-1 rounded-[14px] px-3 py-2 text-[10px]">
          <span className="font-semibold">Today</span>
          <span className="text-fg/60">Cash ₹18,420 · UPI ₹26,110</span>
        </Glass>
      </Float>
    </Frame>
  );
}

export function FinanceScene() {
  return (
    <Frame>
      <Float className="top-[4%] left-[3%] w-[60%]" style={{ "--rot": "-2deg", "--dur": "10s" }}>
        <div className="overflow-hidden rounded-[14px] bg-white text-black shadow-[0_30px_60px_-30px_rgb(0_0_0/.45)]">
          <div className="flex items-center justify-between bg-[#0f766e] px-4 py-3 text-white">
            <span className="text-[11px] font-bold">North Studio</span>
            <span className="text-right text-[12px] font-bold">Tax Invoice<span className="block text-[8px] font-medium opacity-80">INV/2026-27/0042</span></span>
          </div>
          <div className="grid gap-1.5 p-4 text-[9px]">
            <p className="flex justify-between"><span>Brand identity design</span><span>₹45,000</span></p>
            <p className="flex justify-between"><span>Website maintenance</span><span>₹12,000</span></p>
            <p className="flex justify-between text-black/55"><span>IGST 18%</span><span>₹10,260</span></p>
            <p className="mt-1 flex justify-between border-t border-black/15 pt-1.5 text-[12px] font-bold"><span>Total</span><span>₹67,260</span></p>
          </div>
          <div className="relative px-4 pb-4">
            <span className="mk-loop inline-block rounded-[6px] border-2 border-[#15803d] px-2.5 py-0.5 text-[12px] font-extrabold tracking-[0.15em] text-[#15803d]" style={{ "--loop": "6s", "--d": "1.2s", rotate: "-8deg" } as V}>PAID</span>
          </div>
        </div>
      </Float>
      <Float className="right-[3%] top-[44%] w-[38%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="p-3">
          <p className="text-[10px] font-semibold">Invoiced vs collected</p>
          <div className="mt-2 flex h-20 items-end gap-1.5">
            {[[40, 28], [55, 50], [48, 40], [70, 52], [62, 58], [86, 64]].map(([a, b], i) => (
              <div key={i} className="flex h-full flex-1 items-end gap-[2px]">
                <span className="mk-bar w-full rounded-t-[3px]" style={{ height: `${a}%`, background: "var(--viz-1)", animationDelay: `${i * 90}ms` }} />
                <span className="mk-bar w-full rounded-t-[3px]" style={{ height: `${b}%`, background: "var(--viz-2)", animationDelay: `${i * 90 + 40}ms` }} />
              </div>
            ))}
          </div>
        </Glass>
      </Float>
      <Float badge className="top-[4%] right-[4%]" style={{ "--rot": "3deg" }} delay={600}>
        <Glass className="flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-1.5 text-[11px] font-semibold">
          <span className="grid size-6 place-items-center rounded-full bg-[var(--p-lavender)] text-[var(--p-lavender-ink)]"><Check /></span>
          Quote accepted by Ananya
        </Glass>
      </Float>
      <Float badge className="bottom-[12%] left-[6%]" style={{ "--rot": "2deg" }} delay={900}>
        <Pill tone="butter">₹47,260 owed to you</Pill>
      </Float>
    </Frame>
  );
}

export function BookingsScene() {
  const slots = ["9:00", "9:30", "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "2:00", "2:30", "3:00", "3:30"];
  return (
    <Frame>
      <Float className="top-[6%] left-[4%] w-[66%]" style={{ "--rot": "-2deg", "--dur": "9s" }}>
        <Glass className="p-4">
          <div className="flex items-center justify-between text-[11px]"><span className="font-semibold">Haircut · 45 min</span><span className="text-fg/50">Sat, 24 Oct</span></div>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {slots.map((s, i) => (
              <span key={s} className={clsx("rounded-[8px] py-1.5 text-center text-[10px] font-medium", i === 5 ? "mk-ping bg-fg text-bg tint-lavender" : i === 2 || i === 8 ? "bg-fg/[0.05] text-fg/30 line-through" : "border border-fg/10")}>{s}</span>
            ))}
          </div>
        </Glass>
      </Float>
      <Float className="right-[3%] bottom-[10%] w-[44%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="grid gap-1.5 p-3 text-[10px]">
          <span className="flex items-center gap-2 font-semibold"><span className="grid size-5 place-items-center rounded-full bg-[var(--p-mint)] text-[var(--p-mint-ink)]"><Check /></span> Booked!</span>
          <span className="text-fg/60">Sat 11:30 am with Priya</span>
          <span className="rounded-full bg-fg/[0.06] px-2 py-1 text-center">Add to calendar</span>
        </Glass>
      </Float>
      <Float badge className="bottom-[6%] left-[8%]" style={{ "--rot": "-3deg" }} delay={700}>
        <span className="mk-loop inline-block" style={{ "--loop": "5s" } as V}><Pill tone="rose">Reminder sent · tomorrow 11:30</Pill></span>
      </Float>
    </Frame>
  );
}

export function GrowthScene() {
  return (
    <Frame>
      <Float className="top-[6%] left-[3%] w-[44%]" style={{ "--rot": "-3deg", "--dur": "9s" }}>
        <Glass className="p-3 text-[10px]">
          <p className="text-fg/50">Version A</p>
          <span className="mt-2 block rounded-full bg-fg/80 py-1.5 text-center font-semibold text-bg">Buy now</span>
          <p className="mt-2 font-semibold">2.1% clicked</p>
        </Glass>
      </Float>
      <Float className="top-[10%] right-[3%] w-[44%]" style={{ "--rot": "3deg", "--dur": "8.5s" }} delay={250}>
        <Glass className="p-3 text-[10px] ring-2 ring-[var(--p-mint-ink)]/50">
          <p className="flex items-center justify-between text-fg/50">Version B <Pill tone="mint">Winner</Pill></p>
          <span className="mt-2 block rounded-full bg-[var(--p-mint-ink)] py-1.5 text-center font-semibold text-white">Get yours today</span>
          <p className="mt-2 font-semibold">3.4% clicked</p>
        </Glass>
      </Float>
      <Float className="bottom-[6%] left-[10%] w-[80%]" style={{ "--rot": "-1deg", "--dur": "10s" }} delay={500}>
        <Glass className="p-3">
          <p className="text-[10px] font-semibold">Visitors this month</p>
          <svg viewBox="0 0 300 70" className="mt-1 h-16 w-full">
            <path d="M0 60 C 40 55, 60 40, 90 44 S 150 30, 180 26 S 240 12, 300 8" fill="none" stroke="var(--viz-1)" strokeWidth="2.5" strokeLinecap="round" className="mk-dash" style={{ strokeDasharray: "400", animation: "lx-draw 2.4s cubic-bezier(.16,1,.3,1) both", strokeDashoffset: 400 }} />
          </svg>
        </Glass>
      </Float>
    </Frame>
  );
}

export function DomainsScene() {
  return (
    <Frame>
      <Float className="top-[6%] left-[4%] w-[62%]" style={{ "--rot": "-2deg", "--dur": "9s" }}>
        <Glass className="p-4 text-[10px]">
          <p className="font-semibold">Connect saanjh.in</p>
          <div className="mt-2 grid gap-1.5 font-mono text-[9px]">
            <span className="rounded-[8px] bg-fg/[0.05] px-2 py-1.5">TXT _creationcloud → cc-verify=…</span>
            <span className="rounded-[8px] bg-fg/[0.05] px-2 py-1.5">CNAME www → sites.creation.cloud</span>
          </div>
          <span className="mk-loop mt-2 inline-block" style={{ "--loop": "6s", "--d": "1s" } as V}><Pill tone="mint"><Check /> Connected</Pill></span>
        </Glass>
      </Float>
      <Float className="right-[3%] top-[30%] w-[40%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="grid gap-2 p-3 text-[10px]">
          <p className="font-semibold">Deployments</p>
          {[["Live", "now", "mint"], ["Previous", "2h ago", "sky"], ["Earlier", "Mon", "lavender"]].map(([k, t, tone], i) => (
            <span key={k} className="flex items-center justify-between">
              <span className="flex items-center gap-1.5"><span className={clsx("size-2 rounded-full", i === 0 && "mk-ping")} style={{ background: `var(--p-${tone}-ink)` }} />{k}</span>
              <span className="text-fg/45">{i ? "Roll back" : t}</span>
            </span>
          ))}
        </Glass>
      </Float>
      <Float badge className="bottom-[8%] left-[12%]" style={{ "--rot": "-3deg" }} delay={600}>
        <Pill tone="sky">Every link checked before going live</Pill>
      </Float>
    </Frame>
  );
}

export function IdeScene() {
  return (
    <Frame>
      <Float className="top-[5%] left-[3%] w-[74%]" style={{ "--rot": "-1.5deg", "--dur": "10s" }}>
        <div className="overflow-hidden rounded-[14px] bg-[#16161a] font-mono text-[9.5px] leading-[1.7] text-[#d4d4d8] shadow-[0_30px_60px_-30px_rgb(0_0_0/.6)]">
          <div className="flex gap-3 border-b border-white/10 px-3 py-1.5 text-[9px] text-white/50"><span className="text-white">site.json</span><span>styles.css</span></div>
          <div className="px-3 py-2">
            <p><span className="text-[#c4b5fd]">{'"heading"'}</span>: <span className="text-[#86efac]">{'"Everyday pieces"'}</span>,</p>
            <p className="bg-[#7f1d1d]/40">- <span className="text-[#c4b5fd]">{'"button"'}</span>: <span className="text-[#fca5a5]">{'"Buy now"'}</span></p>
            <p className="bg-[#14532d]/50">+ <span className="text-[#c4b5fd]">{'"button"'}</span>: <span className="text-[#86efac]">{'"Get yours today"'}</span></p>
            <p><span className="text-[#c4b5fd]">{'"accent"'}</span>: <span className="text-[#86efac]">{'"#0f766e"'}</span><span className="mk-caret" /></p>
          </div>
        </div>
      </Float>
      <Float className="right-[3%] top-[44%] w-[40%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="grid gap-2 p-3 text-[10px]">
          <p className="font-semibold">AI suggests a change</p>
          <div className="flex gap-1.5"><span className="flex-1 rounded-full bg-fg py-1 text-center font-semibold text-bg">Accept</span><span className="flex-1 rounded-full border border-fg/15 py-1 text-center">Reject</span></div>
        </Glass>
      </Float>
      <Float className="bottom-[6%] left-[8%] w-[48%]" style={{ "--rot": "-2deg" }} delay={600}>
        <div className="rounded-[12px] bg-[#16161a] px-3 py-2 font-mono text-[9px] text-[#86efac] shadow-[0_20px_40px_-24px_rgb(0_0_0/.6)]">$ validate<br /><span className="text-white/70">✓ 6 pages, 0 problems</span></div>
      </Float>
    </Frame>
  );
}

export function AutomationsScene() {
  // Positions in % of the frame; connectors use the same coordinates.
  const nodes = [
    { x: 3, y: 40, label: "Order paid", tone: "mint" },
    { x: 37, y: 40, label: "Wait 2 days", tone: "butter" },
    { x: 71, y: 14, label: "Email a thank-you", tone: "lavender" },
    { x: 71, y: 66, label: "Ping #sales on Slack", tone: "peach" },
  ];
  return (
    <Frame>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        {["M29 47 C33 47 33 47 37 47", "M63 47 C67 47 67 21 71 21", "M63 47 C67 47 67 73 71 73"].map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--p-lavender-ink)" strokeOpacity=".55" strokeWidth="1.6" vectorEffect="non-scaling-stroke" className="mk-dash" />
        ))}
      </svg>
      {nodes.map((n, i) => (
        <div key={n.label} className="absolute w-[26%]" style={{ left: `${n.x}%`, top: `${n.y}%` }}>
          <div className="ob-piece" style={{ animationDelay: `${i * 200}ms, ${i * 200 + 900}ms`, "--lift": "-5px", "--dur": `${7 + i}s` } as V}>
            <Glass className="flex h-[3.4em] items-center gap-2 px-2.5 text-[10.5px] leading-tight font-semibold">
              <span className="size-6 shrink-0 rounded-[8px]" style={{ background: `var(--p-${n.tone})` }} />
              {n.label}
            </Glass>
          </div>
        </div>
      ))}
      <Float badge className="bottom-[4%] left-[4%]" style={{ "--rot": "-3deg" }} delay={900}>
        <Pill tone="sky">Failed steps retry by themselves</Pill>
      </Float>
    </Frame>
  );
}

export function ChatbotScene() {
  const msgs: [string, boolean][] = [
    ["Do you ship to Pune?", true],
    ["Yes! Most orders reach Pune in 3–5 days, and delivery is free over ₹999. [1]", false],
    ["Can I pay cash?", true],
    ["Cash on delivery is available at checkout. [2]", false],
  ];
  return (
    <Frame>
      <Float className="top-[4%] left-[10%] w-[78%]" style={{ "--rot": "-1deg", "--dur": "10s" }}>
        <Glass className="grid gap-2 p-4">
          {msgs.map(([m, me], i) => (
            <span key={i} className={clsx("mk-loop max-w-[82%] rounded-[14px] px-3 py-2 text-[10.5px] leading-snug", me ? "justify-self-end bg-fg text-bg" : "justify-self-start bg-fg/[0.06]")} style={{ "--d": `${i * 0.7}s`, "--loop": "8s" } as V}>
              {m}
            </span>
          ))}
          <span className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-fg/55"><span className="rounded-full bg-fg/[0.06] px-2 py-0.5">[1] Shipping policy</span><span className="rounded-full bg-fg/[0.06] px-2 py-0.5">[2] Payments</span></span>
        </Glass>
      </Float>
      <Float badge className="bottom-[6%] right-[6%]" style={{ "--rot": "3deg" }} delay={600}>
        <Pill tone="lavender">Talk to a human →</Pill>
      </Float>
    </Frame>
  );
}

export function DataScene() {
  const rows = [["Sea view room", "Deluxe", "₹6,500", "mint"], ["Garden suite", "Suite", "₹9,800", "peach"], ["Courtyard room", "Standard", "₹4,200", "sky"]];
  return (
    <Frame>
      <Float className="top-[6%] left-[3%] w-[70%]" style={{ "--rot": "-2deg", "--dur": "9s" }}>
        <Glass className="overflow-hidden text-[10px]">
          <div className="grid grid-cols-[1.4fr_1fr_0.8fr] border-b border-fg/10 bg-fg/[0.03] px-3 py-2 font-semibold text-fg/60"><span>Room</span><span>Type</span><span>Rate</span></div>
          {rows.map(([a, b, c, t]) => (
            <div key={a} className="grid grid-cols-[1.4fr_1fr_0.8fr] items-center border-b border-fg/5 px-3 py-2 last:border-0">
              <span className="font-medium">{a}</span>
              <span><Pill tone={t}>{b}</Pill></span>
              <span className="tabular-nums">{c}</span>
            </div>
          ))}
        </Glass>
      </Float>
      <Float className="right-[3%] bottom-[8%] w-[48%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <div className="rounded-[12px] bg-[#16161a] p-3 font-mono text-[9px] leading-relaxed text-[#d4d4d8] shadow-[0_24px_50px_-26px_rgb(0_0_0/.6)]">
          <span className="text-[#86efac]">GET</span> /tables/rooms<br />
          {"{"} <span className="text-[#c4b5fd]">{'"name"'}</span>: <span className="text-[#fde68a]">{'"Sea view room"'}</span>,<br />
          &nbsp;&nbsp;<span className="text-[#c4b5fd]">{'"rate"'}</span>: <span className="text-[#fde68a]">6500</span> {"}"}
        </div>
      </Float>
      <Float badge className="bottom-[10%] left-[8%]" style={{ "--rot": "-3deg" }} delay={600}>
        <Pill tone="butter">CSV in · CSV out</Pill>
      </Float>
    </Frame>
  );
}

export function CollabScene() {
  const people: [string, string][] = [["AR", "peach"], ["MK", "lavender"], ["SJ", "mint"]];
  return (
    <Frame>
      <Float className="top-[8%] left-[4%] w-[70%]" style={{ "--rot": "-1.5deg", "--dur": "10s" }}>
        <Browser url="Review · Saanjh redesign">
          <div className="relative grid gap-2 p-4">
            <p className="text-[16px] font-semibold tracking-tight">Spring collection</p>
            <Line w="75%" />
            <div className="grid grid-cols-2 gap-2"><span className="aspect-[4/3] rounded-[8px] bg-[var(--p-rose)]" /><span className="aspect-[4/3] rounded-[8px] bg-[var(--p-sky)]" /></div>
            <span className="absolute top-3 right-3 grid size-6 place-items-center rounded-full bg-[var(--p-peach-ink)] text-[9px] font-bold text-white mk-ping tint-peach">2</span>
          </div>
        </Browser>
      </Float>
      <Float className="right-[3%] top-[36%] w-[40%]" style={{ "--rot": "3deg", "--dur": "8s" }} delay={300}>
        <Glass className="grid gap-1.5 p-3 text-[10px]">
          <p className="font-semibold">@Mira love this — can the photo be warmer?</p>
          <span className="text-fg/50">Ananya (client) · just now</span>
          <span className="mt-1 rounded-full bg-[var(--p-mint)] py-1 text-center font-semibold text-[var(--p-mint-ink)]">Approve</span>
        </Glass>
      </Float>
      <Float badge className="bottom-[8%] left-[10%]" style={{ "--rot": "-3deg" }} delay={600}>
        <div className="flex -space-x-2">
          {people.map(([i, t]) => <span key={i} className="grid size-8 place-items-center rounded-full border-2 border-bg text-[10px] font-bold" style={{ background: `var(--p-${t})`, color: `var(--p-${t}-ink)` }}>{i}</span>)}
          <span className="grid size-8 place-items-center rounded-full border-2 border-bg bg-fg/[0.08] text-[10px] font-semibold">+2</span>
        </div>
      </Float>
    </Frame>
  );
}

export const SCENES: Record<string, () => React.JSX.Element> = {
  launch: LaunchScene,
  "website-builder": BuilderScene,
  "online-store": StoreScene,
  "point-of-sale": PosScene,
  invoicing: FinanceScene,
  bookings: BookingsScene,
  growth: GrowthScene,
  domains: DomainsScene,
  "ai-ide": IdeScene,
  automations: AutomationsScene,
  chatbot: ChatbotScene,
  data: DataScene,
  collaboration: CollabScene,
};
