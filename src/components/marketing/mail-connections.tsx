"use client";

// Mail feature page: how one email reaches the rest of Cloudesk (Notes,
// Calendar, Tasks, Chat — and links back), and how recurring emails run a
// week. Animated mock-ups of the real screens, built in HTML so they stay
// crisp; they play when scrolled into view, pause on hover, and sit still
// for people who prefer less motion.
import clsx from "clsx";
import { CalendarPlus, Check, CornerDownLeft, ListChecks, Mail, MessagesSquare, NotebookPen, Repeat, Share2, Video } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Tone = "butter" | "sky" | "mint" | "lavender";
type Dest = { key: string; label: string; tone: Tone; icon: typeof Mail; what: string; detail: string; connected: string; preview: ReactNode };

const DESTS: Dest[] = [
  {
    key: "note", label: "Notes", tone: "butter", icon: NotebookPen, what: "Saved to Notes",
    detail: "What was written — not the quoted history or the signature — lists kept as lists, attachments linked, and a card back to the email. New note, or added to one you have; or an AI summary with its to-dos.",
    connected: "Launch plan for Diwali · Note",
    preview: (
      <div className="grid gap-1.5 text-[12px]">
        <p className="text-[13px] font-semibold">Launch plan for Diwali</p>
        <span className="inline-flex w-fit items-center gap-1.5 rounded-[8px] px-2 py-1 ring-1 ring-fg/10"><span className="text-[10px]">◆</span>Email · Asha Verma · 30 Oct</span>
        <p className="flex items-center gap-1.5"><span className="size-1 rounded-full bg-fg/50" />Final designs by Friday</p>
        <p className="flex items-center gap-1.5"><span className="size-1 rounded-full bg-fg/50" />Ads go live on the 5th</p>
        <p className="flex gap-1"><span className="rounded-full bg-fg/[0.06] px-1.5">#launch</span><span className="rounded-full bg-fg/[0.06] px-1.5">Remind me Monday</span></p>
      </div>
    ),
  },
  {
    key: "event", label: "Calendar", tone: "sky", icon: CalendarPlus, what: "In your calendar",
    detail: "The time and video link are read from the email itself. Invite the people on it from your mailbox — or block time for yourself to deal with it.",
    connected: "Sign-off · Thu 4:00 pm · Calendar",
    preview: (
      <div className="flex items-start gap-3 text-[12px]">
        <span className="grid w-11 shrink-0 overflow-hidden rounded-[9px] text-center ring-1 ring-fg/10"><span className="bg-[var(--p-sky-ink)] py-0.5 text-[9px] font-bold tracking-wide text-white">THU</span><span className="py-0.5 text-[17px] font-semibold">5</span></span>
        <div className="grid gap-1">
          <p className="text-[13px] font-semibold">Launch sign-off</p>
          <p className="text-fg/60">4:00 – 4:30 pm · read from “Thursday at 4pm”</p>
          <p className="flex flex-wrap gap-1"><span className="inline-flex items-center gap-1 rounded-full bg-fg/[0.06] px-1.5"><Video className="size-3" />Google Meet</span><span className="rounded-full bg-fg/[0.06] px-1.5">Asha, Ravi · invite sent</span></p>
        </div>
      </div>
    ),
  },
  {
    key: "task", label: "Tasks", tone: "mint", icon: ListChecks, what: "A task in your project",
    detail: "Pick the project, who does it, the due date and priority. The task carries the email — who sent it, when, what it said — and a link back.",
    connected: "#12 Send final designs · Task",
    preview: (
      <div className="grid gap-1.5 text-[12px]">
        <p className="flex items-center gap-2 text-[13px] font-semibold"><span className="grid size-4 place-items-center rounded-[5px] ring-1 ring-fg/25" />#12 Send final designs</p>
        <p className="text-fg/60">Diwali launch · Due Fri · High</p>
        <p className="rounded-[8px] border-l-2 border-fg/20 bg-fg/[0.03] px-2 py-1 text-fg/60">“Final designs by Friday…” — Asha Verma</p>
      </div>
    ),
  },
  {
    key: "chat", label: "Chat", tone: "lavender", icon: MessagesSquare, what: "Shared with your team",
    detail: "Post it as a card in any channel, group or direct message, with a line of your own — so the right person picks it up. The email remembers where it went.",
    connected: "Shared in #launch · Chat",
    preview: (
      <div className="grid gap-1.5 text-[12px]">
        <p className="flex items-center gap-2"><span className="grid size-5 place-items-center rounded-full bg-[#c4704f] text-[9px] font-bold text-white">MI</span><b className="font-semibold">Meera</b><span className="text-fg/50">in #launch</span></p>
        <p>Can someone take this today?</p>
        <div className="flex overflow-hidden rounded-[9px] ring-1 ring-fg/10"><span className="w-1 bg-gradient-to-b from-violet-500 to-sky-500" /><span className="px-2 py-1"><span className="block text-[9.5px] font-semibold tracking-wide text-fg/50 uppercase">Email</span><span className="font-semibold">Launch plan for Diwali</span></span></div>
      </div>
    ),
  },
];

const CYCLE_MS = 4200;

function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setIn(!!e?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView] as const;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── One email, everywhere ─────────────────────────────────────────────────

export function MailConnections() {
  const [root, inView] = useInView<HTMLDivElement>();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [seen, setSeen] = useState<number[]>([]);
  const [still] = useState(reduced);

  const pick = useCallback((i: number) => {
    setActive(i);
    setSeen((s) => (s.includes(i) ? s : [...s, i]));
  }, []);
  useEffect(() => {
    if (!inView || paused || still) return;
    // First the one that's open (Notes), then on round.
    const t = setTimeout(() => pick(seen.length ? (active + 1) % DESTS.length : active), seen.length ? CYCLE_MS : 700);
    return () => clearTimeout(t);
  }, [inView, paused, still, active, seen.length, pick]);

  // The lines: measured from the real cards, so they fit any width and follow the open card.
  const wrap = useRef<HTMLDivElement>(null);
  const email = useRef<HTMLDivElement>(null);
  const dests = useRef<(HTMLButtonElement | null)[]>([]);
  const [paths, setPaths] = useState<{ d: string; w: number; h: number }[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      const w = wrap.current;
      const e = email.current;
      if (!w || !e) return;
      const box = w.getBoundingClientRect();
      const er = e.getBoundingClientRect();
      const x1 = er.right - box.left;
      const y1 = er.top - box.top + Math.min(er.height / 2, 120);
      setPaths(
        dests.current.map((el) => {
          if (!el) return { d: "", w: box.width, h: box.height };
          const r = el.getBoundingClientRect();
          const x2 = r.left - box.left;
          const y2 = r.top - box.top + 30;
          const dx = Math.max(30, (x2 - x1) * 0.55);
          return { d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, w: box.width, h: box.height };
        }),
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    dests.current.forEach((d) => d && ro.observe(d));
    return () => ro.disconnect();
  }, []);

  const cur = DESTS[active]!;
  const highlight = (k: string) => (cur.key === k ? `mk-mail-hl tint-${cur.tone}` : "");

  return (
    <div ref={root} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <div ref={wrap} className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(80px,140px)_minmax(0,1fr)] lg:gap-0">
        {/* The lines (wide screens) */}
        <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full overflow-visible lg:block">
          {paths.map((p, i) => {
            const on = i === active;
            const ink = `var(--p-${DESTS[i]!.tone}-ink)`;
            return p.d ? (
              <g key={i}>
                <path d={p.d} fill="none" stroke="currentColor" className="text-fg/12" strokeWidth={1.5} strokeDasharray="3 6" />
                {on && <path key={`on-${active}`} d={p.d} fill="none" stroke={ink} strokeWidth={2.25} strokeLinecap="round" pathLength={1} className="mk-mail-draw" />}
                {on && !still && (
                  <>
                    <circle r={4.5} fill={ink}>
                      <animateMotion dur="1.6s" repeatCount="indefinite" path={p.d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" />
                    </circle>
                    {/* …and back: the note, event, task or chat links to the email */}
                    <circle r={3} fill={ink} opacity={0.45}>
                      <animateMotion dur="2.4s" begin="0.8s" repeatCount="indefinite" path={p.d} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
                    </circle>
                  </>
                )}
              </g>
            ) : null;
          })}
        </svg>

        {/* The email */}
        <div className="relative z-[1] grid content-start gap-4">
          <div ref={email} className="rounded-[22px] border border-fg/[0.08] bg-[var(--surface-solid)] p-5 shadow-[0_24px_60px_-36px_rgba(30,27,75,0.45)]">
            <div className="flex items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full bg-[#5b6b9a] text-[13px] font-semibold text-white">AV</span>
              <div className="min-w-0 flex-1"><p className="text-[14px] font-semibold">Asha Verma</p><p className="text-[12px] text-fg/50">asha@client.in · to you, Ravi</p></div>
              <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-fg/10 transition-colors", inView && !still && "mk-mail-pulse")}><Share2 className="size-3.5" />Send to</span>
            </div>
            <p className={clsx("mt-4 rounded-[6px] text-[17px] font-semibold tracking-[-0.01em] transition-colors", highlight("chat"))}>Launch plan for Diwali</p>
            <div className="mt-2 grid gap-1.5 text-[14px] leading-relaxed text-fg/75">
              <p>Hi Meera, here&apos;s what we agreed:</p>
              <p className={clsx("rounded-[6px] px-1 -mx-1 transition-colors", highlight("note"))}>• <span className={clsx("rounded-[6px] transition-colors", highlight("task"))}>Final designs by Friday</span><br />• Ads go live on the 5th</p>
              <p>Can we meet <span className={clsx("rounded-[6px] px-0.5 font-medium transition-colors", highlight("event"))}>Thursday at 4pm</span> to sign off? <span className={clsx("rounded-[6px] px-0.5 text-[var(--p-sky-ink)] transition-colors", highlight("event"))}>meet.google.com/abc-defg</span></p>
              <p className="text-fg/45">Thanks, Asha</p>
            </div>
          </div>
          {/* The email's own "Connected" list fills as it goes */}
          <div className="rounded-[18px] border border-fg/[0.08] bg-[var(--surface-solid)]/80 p-4">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-fg/50 uppercase">Connected <span className="rounded-full bg-fg/[0.06] px-1.5 text-fg tabular-nums">{seen.length}</span></p>
            <ul className="mt-2 grid gap-1.5">
              {seen.length === 0 && <li className="text-[12.5px] text-fg/45">Everything this email becomes shows up here — and links back.</li>}
              {seen.map((i) => {
                const d = DESTS[i]!;
                const DI = d.icon;
                return (
                  <li key={d.key} className={clsx("mk-mail-pop flex items-center gap-2.5 text-[13px]", `tint-${d.tone}`)}>
                    <span className="tint-chip grid size-6 shrink-0 place-items-center rounded-[8px]"><DI className="size-3.5" /></span>
                    <span className="truncate">{d.connected}</span>
                    <CornerDownLeft className="ml-auto size-3.5 shrink-0 text-fg/35" aria-label="links back" />
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        <div aria-hidden className="hidden lg:block" />

        {/* Where it goes */}
        <div className="relative z-[1] grid content-start gap-3" role="tablist" aria-label="Where an email can go">
          {DESTS.map((d, i) => {
            const on = i === active;
            const DI = d.icon;
            return (
              <button
                key={d.key}
                ref={(el) => {
                  dests.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => pick(i)}
                className={clsx("group rounded-[20px] border p-4 text-left transition-[box-shadow,border-color,background-color,transform] duration-300", `tint-${d.tone}`, on ? "border-transparent bg-[var(--surface-solid)] lg:-translate-x-1" : "border-fg/[0.08] bg-[var(--surface-solid)]/70 hover:bg-[var(--surface-solid)]")}
                style={on ? { boxShadow: "0 18px 44px -24px rgba(30,27,75,0.45), 0 0 0 2px color-mix(in oklab, var(--t-ink) 35%, transparent)" } : undefined}
              >
                <span className="flex items-center gap-3">
                  <span className={clsx("tint-chip grid size-9 shrink-0 place-items-center rounded-[11px] transition-transform duration-300", on && "scale-110")}><DI className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{d.label}</span><span className="block text-[12.5px] text-fg/55">{d.what}</span></span>
                  {seen.includes(i) && <span className="tint-chip grid size-5 place-items-center rounded-full"><Check className="size-3" /></span>}
                </span>
                {/* The open card shows what the email became */}
                <span className={clsx("grid transition-[grid-template-rows,opacity] duration-500", on ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                  <span className="min-h-0 overflow-hidden">
                    <span className="mt-3 block rounded-[14px] p-3" style={{ background: "color-mix(in oklab, var(--t) 55%, transparent)" }}>{d.preview}</span>
                    <span className="mt-2.5 block text-[13px] leading-relaxed text-fg/65">{d.detail}</span>
                    <span className="tint-ink mt-2 inline-flex items-center gap-1 text-[12px] font-semibold"><CornerDownLeft className="size-3.5" />Links back to the email</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* How it works, in three */}
      <ol className="mt-10 grid gap-3 sm:grid-cols-3">
        {[
          ["Open any email", "Or press n to save it to Notes straight away."],
          ["Send to — or + Note, + Calendar, + Task, + Chat", "Each opens with the right details already filled in from the email."],
          ["Connected, both ways", "The email lists all it became; each of those opens the email again."],
        ].map(([t, b], i) => (
          <li key={t} className="flex gap-3 rounded-[18px] border border-fg/[0.08] bg-[var(--surface-solid)]/70 p-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-fg text-[12px] font-semibold text-bg">{i + 1}</span>
            <span><span className="block text-[14px] font-semibold">{t}</span><span className="block text-[13px] text-fg/55">{b}</span></span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Recurring emails: a week of it ─────────────────────────────────────────

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOLIDAY = 2;
const SENDS = WEEK.map((_, i) => i < 5 && i !== HOLIDAY);
/** When each day's email drops in: one after another, the holiday in its place. */
const DELAY = WEEK.map((_, i) => `${SENDS.slice(0, i).filter(Boolean).length * 650 + 300}ms`);

export function RecurringWeek() {
  const [root, inView] = useInView<HTMLDivElement>();
  const [round, setRound] = useState(0);
  const [still] = useState(reduced);
  // Replays every few seconds while on screen.
  useEffect(() => {
    if (!inView || still) return;
    const t = setInterval(() => setRound((r) => r + 1), 9000);
    return () => clearInterval(t);
  }, [inView, still]);
  const play = inView || still;
  return (
    <div ref={root} className="grid items-center gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div>
        <p className="inline-flex items-center gap-2 rounded-full bg-[var(--p-sky)] px-3 py-1 text-[12px] font-semibold text-[var(--p-sky-ink)]"><Repeat className="size-3.5" />Recurring emails</p>
        <h3 className="mt-4 text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.1] font-[380] tracking-[-0.03em]">Write it once. It goes out on its own.</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-fg/60">A daily stand-up invite, a weekly report, a monthly reminder to pay. Pick the days and the times — and if it&apos;s about a meeting, the meetings go into your calendar and each email carries the day&apos;s invite.</p>
        <ul className="mt-5 flex flex-wrap gap-2 text-[12.5px]">
          {["Every day, weekday or chosen days", "Up to 6 times a day", "Skip holidays", "Ends on a date or after N emails", "Stop when someone replies", "Keep one conversation", "{{date}}, {{n}} filled in", "Send one now · skip the next"].map((c) => (
            <li key={c} className="rounded-full border border-fg/[0.1] bg-[var(--surface-solid)]/70 px-3 py-1">{c}</li>
          ))}
        </ul>
      </div>
      <div className="rounded-[24px] border border-fg/[0.08] bg-[var(--surface-solid)] p-4 shadow-[0_24px_60px_-36px_rgba(30,27,75,0.45)] sm:p-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-fg/[0.07] pb-3">
          <span className="grid size-8 place-items-center rounded-[10px] bg-[var(--p-sky)] text-[var(--p-sky-ink)]"><Repeat className="size-4" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[14px] font-semibold">Daily stand-up</span><span className="block text-[12px] text-fg/55">Every weekday at 9:00 am · meeting 9:30 · 1 day skipped</span></span>
          <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">Running</span>
        </div>
        <div key={round} className="mt-4 grid grid-cols-7 gap-1.5 sm:gap-2">
          {WEEK.map((d, i) => {
            const weekend = i >= 5;
            const holiday = i === HOLIDAY;
            const sends = SENDS[i];
            const delay = DELAY[i];
            return (
              <div key={d} className={clsx("grid min-h-[150px] content-start justify-items-center gap-2 rounded-[14px] p-1.5 sm:p-2", weekend ? "bg-fg/[0.025]" : "bg-[var(--p-sky)]/35")}>
                <span className={clsx("text-[11px] font-semibold tracking-wide uppercase", weekend ? "text-fg/30" : "text-fg/60")}>{d}</span>
                {sends && play && (
                  <>
                    <span className="mk-mail-drop grid size-8 place-items-center rounded-[10px] bg-[var(--surface-solid)] text-[var(--p-sky-ink)] shadow-sm ring-1 ring-fg/10" style={{ animationDelay: delay }}><Mail className="size-4" /></span>
                    <span className="mk-mail-fade text-[10.5px] font-medium text-fg/55 tabular-nums" style={{ animationDelay: delay }}>9:00</span>
                    <span className="mk-mail-fade w-full rounded-[7px] bg-[var(--p-lavender)] px-1 py-1 text-center text-[9.5px] leading-tight font-semibold text-[var(--p-lavender-ink)]" style={{ animationDelay: `calc(${delay} + 350ms)` }}>Stand-up<br />9:30</span>
                  </>
                )}
                {holiday && play && (
                  <span className="mk-mail-fade grid justify-items-center gap-1 text-center text-[10px] text-fg/45" style={{ animationDelay: DELAY[HOLIDAY] }}>
                    <span className="grid size-8 place-items-center rounded-[10px] border border-dashed border-fg/25 line-through"><Mail className="size-4 opacity-40" /></span>
                    Holiday<br />skipped
                  </span>
                )}
                {weekend && <span className="mt-2 text-[10px] text-fg/30">—</span>}
              </div>
            );
          })}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-fg/50"><CalendarPlus className="size-3.5" />Each meeting lands in your calendar; recipients get the day&apos;s invite with the email.</p>
      </div>
    </div>
  );
}
