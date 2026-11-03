"use client";

// AI mode's opening screen: a quiet, animated emblem of the business's numbers
// (bars rising, a trend line drawing itself), the greeting, a few live key
// figures counting up, one line for what needs the person (opening the inbox),
// and the questions people ask most — each a tap away from an answer.
import clsx from "clsx";
import { ArrowUpRight, BadgeIndianRupee, CalendarClock, ChartNoAxesCombined, ChevronDown, CircleAlert, HandCoins, Package, TrendingUp, Users, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

export type Pulse = { label: string; value: number; format: "money" | "number" | "hours" | "percent"; sub?: string };
export type Faq = { q: string; icon: LucideIcon };

export const FAQS: Faq[] = [
  { q: "How did sales do this month compared with last month?", icon: TrendingUp },
  { q: "Who owes me money, and how much is overdue?", icon: HandCoins },
  { q: "What is my cash position and expected cash flow?", icon: BadgeIndianRupee },
  { q: "Which customers and products bring in the most revenue?", icon: Users },
  { q: "Which items are running low on stock?", icon: Package },
  { q: "What should I focus on today?", icon: CalendarClock },
];

const money = (p: number) => {
  const r = p / 100;
  const a = Math.abs(r);
  if (a >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  return `₹${Math.round(r).toLocaleString("en-IN")}`;
};
const fmt = (p: Pulse, v: number) => (p.format === "money" ? money(v) : p.format === "hours" ? `${v.toLocaleString("en-IN", { maximumFractionDigits: 1 })}h` : p.format === "percent" ? `${Math.round(v)}%` : Math.round(v).toLocaleString("en-IN"));

/** Counts up to a figure when it first shows (straight to it with reduced motion). */
function useCount(target: number) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = reduce ? 1 : Math.min(1, (t - start) / 900);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

function Figure({ p, i }: { p: Pulse; i: number }) {
  const v = useCount(p.value);
  return (
    <div className="aih-fig" style={{ "--i": i } as CSSProperties}>
      <span className="aih-fig-l">{p.label}</span>
      <b>{fmt(p, v)}</b>
      {p.sub && <span className="aih-fig-s">{p.sub}</span>}
    </div>
  );
}

/** The emblem: four bars rise, a trend line draws across them, its last point glows. */
export function BiMark() {
  return (
    <svg className="aih-mark" viewBox="0 0 64 64" aria-hidden>
      <rect className="aih-mark-bg" x="0.5" y="0.5" width="63" height="63" rx="18" />
      {[
        [14, 34],
        [24, 26],
        [34, 30],
        [44, 18],
      ].map(([x, h], i) => (
        <rect key={i} className="aih-bar" x={x} y={50 - h!} width="6" height={h} rx="2" style={{ "--i": i } as CSSProperties} />
      ))}
      <polyline className="aih-line" points="12,40 22,31 32,35 42,22 52,14" />
      <circle className="aih-dot-ring" cx="52" cy="14" r="5" />
      <circle className="aih-dot" cx="52" cy="14" r="2.6" />
    </svg>
  );
}

export function AiHome(p: { name: string; pulse: Pulse[]; headline: string; attention?: { text: string; children: ReactNode } | null; onAsk: (q: string) => void; faqs?: Faq[] }) {
  const [open, setOpen] = useState(false);
  const faqs = p.faqs ?? FAQS;
  return (
    <div className="aih">
      <div className="aih-hero">
        <BiMark />
        <div className="aih-hero-tx">
          <h1>{p.name}</h1>
          <p>{p.headline}</p>
        </div>
      </div>

      {p.pulse.length > 0 && (
        <div className="aih-figs" style={{ "--n": p.pulse.length } as CSSProperties}>
          {p.pulse.map((x, i) => (
            <Figure key={x.label} p={x} i={i} />
          ))}
        </div>
      )}

      {p.attention && (
        <div className={clsx("aih-attn", open && "is-open")}>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}>
            <CircleAlert className="size-4" aria-hidden />
            <span className="flex-1 text-left">{p.attention.text}</span>
            <ChevronDown className="aih-chev size-4" aria-hidden />
          </button>
          {open && <div className="aih-attn-body">{p.attention.children}</div>}
        </div>
      )}

      <section className="aih-faq" aria-label="Frequently asked">
        <h2>
          <ChartNoAxesCombined className="size-3.5" aria-hidden /> Frequently asked
        </h2>
        <ul>
          {faqs.map((f, i) => {
            const Icon = f.icon;
            return (
              <li key={f.q} style={{ "--i": i } as CSSProperties}>
                <button type="button" onClick={() => p.onAsk(f.q)}>
                  <Icon className="size-4" aria-hidden />
                  <span className="flex-1 text-left">{f.q}</span>
                  <ArrowUpRight className="aih-go size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
