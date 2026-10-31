"use client";

// Home page: the ideas that make Cloudesk different, in five groups. Each
// card has a small animated mock-up of the feature at work (HTML and CSS, so
// it's crisp and light). The groups take turns while the section is on
// screen; hovering pauses, and people who prefer less motion see it still.
import clsx from "clsx";
import { ArrowUpRight, Bot, CalendarPlus, Check, IndianRupee, Link2, ListChecks, Mail, MessagesSquare, NotebookPen, ShieldCheck, Sparkles, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Tone = "sky" | "lavender" | "peach" | "mint" | "rose" | "butter";

// ── The little animated scenes ──────────────────────────────────────────────

/** Something flowing out to several places, one after another. */
function Flow({ from, to }: { from: { icon: ReactNode; label: string }; to: { label: string; tone: Tone }[] }) {
  return (
    <div className="flex h-full items-center gap-3">
      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-[12px] bg-[var(--surface-solid)] px-3 py-2 text-[12.5px] font-semibold shadow-sm ring-1 ring-fg/[0.08] [&>svg]:size-3.5">{from.icon}{from.label}</span>
      <div className="grid min-w-0 flex-1 gap-2">
        {to.map((t, i) => (
          <div key={t.label} className="flex min-w-0 items-center gap-2" style={{ "--i": i } as CSSProperties}>
            <span className="relative h-px min-w-6 flex-1 bg-fg/10"><span className="mk-inv-dot absolute top-1/2 left-0 size-1.5 -translate-y-1/2 rounded-full" style={{ background: `var(--p-${t.tone}-ink)` }} /></span>
            <span className="mk-inv-light truncate rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: `var(--p-${t.tone})`, color: `var(--p-${t.tone}-ink)` }}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Messages arriving one by one. */
function Bubbles({ lines }: { lines: { who?: string; text: ReactNode; me?: boolean; card?: boolean }[] }) {
  return (
    <div className="grid h-full content-center gap-1.5">
      {lines.map((l, i) => (
        <div key={i} className={clsx("mk-inv-pop flex", l.me && "justify-end")} style={{ "--i": i } as CSSProperties}>
          <span className={clsx("max-w-[88%] rounded-[14px] px-3 py-1.5 text-[12px] leading-snug shadow-sm", l.card ? "border-l-[3px] border-violet-500 bg-[var(--surface-solid)] ring-1 ring-fg/[0.08]" : l.me ? "rounded-br-[4px] bg-fg text-bg" : "rounded-bl-[4px] bg-[var(--surface-solid)] ring-1 ring-fg/[0.08]")}>
            {l.who && <b className="mr-1 font-semibold">{l.who}</b>}{l.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A question or sentence being typed, then what comes of it. */
function Typed({ prompt, chips, icon }: { prompt: string; chips: { label: string; tone: Tone }[]; icon?: ReactNode }) {
  return (
    <div className="grid h-full content-center gap-2.5">
      <div className="flex items-center gap-2 rounded-[12px] bg-[var(--surface-solid)] px-3 py-2 text-[12.5px] shadow-sm ring-1 ring-fg/[0.08]">
        <span className="shrink-0 text-violet-600 [&>svg]:size-3.5">{icon ?? <Sparkles />}</span>
        <span className="mk-inv-type overflow-hidden whitespace-nowrap" style={{ "--n": prompt.length } as CSSProperties}>{prompt}</span>
        <span className="mk-inv-caret h-3.5 w-px bg-fg/60" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => (
          <span key={c.label} className="mk-inv-chip rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ "--i": i, background: `var(--p-${c.tone})`, color: `var(--p-${c.tone}-ink)` } as CSSProperties}>{c.label}</span>
        ))}
      </div>
    </div>
  );
}

/** A scan running down a list, catching the bad ones. */
function Shield({ rows }: { rows: { text: string; bad?: string }[] }) {
  return (
    <div className="relative grid h-full content-center gap-1.5 overflow-hidden">
      <span aria-hidden className="mk-inv-scan pointer-events-none absolute inset-x-0 h-10 bg-gradient-to-b from-transparent via-emerald-400/20 to-transparent" />
      {rows.map((r, i) => (
        <div key={r.text} className={clsx("flex items-center gap-2 rounded-[10px] bg-[var(--surface-solid)] px-3 py-1.5 text-[12px] ring-1 ring-fg/[0.08]", r.bad && "mk-inv-flag")} style={{ "--i": i } as CSSProperties}>
          <span className="min-w-0 flex-1 truncate">{r.text}</span>
          {r.bad ? <span className="mk-inv-badge shrink-0 rounded-full bg-red-500/12 px-2 py-0.5 text-[10.5px] font-semibold text-red-600" style={{ "--i": i } as CSSProperties}>{r.bad}</span> : <Check className="size-3.5 shrink-0 text-emerald-600" />}
        </div>
      ))}
    </div>
  );
}

/** A week of sends dropping in. */
function Week() {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div className="grid h-full grid-cols-7 content-center gap-1.5">
      {days.map((d, i) => {
        const sends = i < 5 && i !== 2;
        return (
          <div key={i} className={clsx("grid justify-items-center gap-1.5 rounded-[10px] py-2", i >= 5 ? "bg-fg/[0.03]" : "bg-[var(--p-sky)]/50")}>
            <span className="text-[10px] font-semibold text-fg/50">{d}</span>
            {sends ? <span className="mk-inv-drop grid size-6 place-items-center rounded-[8px] bg-[var(--surface-solid)] text-[var(--p-sky-ink)] shadow-sm ring-1 ring-fg/10" style={{ "--i": i } as CSSProperties}><Mail className="size-3" /></span> : <span className="grid size-6 place-items-center text-[10px] text-fg/30">{i === 2 ? "skip" : "—"}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Pay by UPI: a QR being scanned, then paid. */
function Pay() {
  const cells = "1111111010111111100000101010000011011101001101110110111010111011101101110110000010101000001111111010101111111";
  return (
    <div className="flex h-full items-center gap-4">
      <div className="relative shrink-0 overflow-hidden rounded-[12px] bg-white p-2 shadow-sm ring-1 ring-fg/10">
        <div className="grid grid-cols-[repeat(11,6px)] gap-px">{[...cells].slice(0, 121).map((c, i) => <span key={i} className={clsx("size-[6px]", c === "1" ? "bg-zinc-900" : "bg-transparent")} />)}</div>
        <span aria-hidden className="mk-inv-scan absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-emerald-400/40 to-transparent" />
      </div>
      <div className="grid gap-1.5 text-[12px]">
        <p className="font-semibold">Counter · ₹1,240</p>
        <p className="text-fg/55">Scan with any UPI app</p>
        <span className="mk-inv-chip inline-flex w-fit items-center gap-1 rounded-full bg-emerald-500/12 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300" style={{ "--i": 2 } as CSSProperties}><Check className="size-3" />Paid</span>
      </div>
    </div>
  );
}

// ── What's in each group ───────────────────────────────────────────────────

type Card = { title: string; body: string; href: string; visual: ReactNode };
type Group = { key: string; label: string; icon: ReactNode; tone: Tone; pitch: string; cards: Card[] };

const GROUPS: Group[] = [
  {
    key: "connected", label: "Everything connected", icon: <Link2 />, tone: "sky",
    pitch: "Your email, chat, notes, calendar and records aren't separate apps here — anything can become anything, and it links back.",
    cards: [
      { title: "Any email becomes a note, a meeting, a task or a chat", body: "The time and video link are read from the email, the quoted history is left out, and everything it becomes is listed on the email.", href: "/features/mail", visual: <Flow from={{ icon: <Mail />, label: "Email" }} to={[{ label: "Note", tone: "butter" }, { label: "Meeting · Thu 4 pm", tone: "sky" }, { label: "Task #12", tone: "mint" }, { label: "#launch", tone: "lavender" }]} /> },
      { title: "Share any record into Chat", body: "An invoice, deal or contact lands as a live card with its key numbers — the team discusses it right there.", href: "/features/chat", visual: <Bubbles lines={[{ card: true, text: <><span className="block text-[9.5px] font-semibold tracking-wide text-fg/50 uppercase">Invoice</span>INV-2041 · ₹48,000 · due Fri</> }, { who: "Ravi", text: "Chasing them today 👍" }, { me: true, text: "Thanks!" }]} /> },
      { title: "Notes on every page", body: "Jot something on an invoice, a customer or a project — it stays attached to it and turns up when you're back.", href: "/features/notes", visual: <Flow from={{ icon: <NotebookPen />, label: "This customer" }} to={[{ label: "Call notes", tone: "butter" }, { label: "[[Pricing]]", tone: "lavender" }]} /> },
      { title: "Your website, wired to your business", body: "A contact form becomes a CRM contact; a support form opens a helpdesk ticket — no plugins, no zaps.", href: "/features/website-builder", visual: <Flow from={{ icon: <ListChecks />, label: "Website form" }} to={[{ label: "CRM contact", tone: "peach" }, { label: "Helpdesk ticket", tone: "rose" }]} /> },
    ],
  },
  {
    key: "ai", label: "AI that does the work", icon: <Bot />, tone: "lavender",
    pitch: "AI that sets things up and reads your own data for you — and never changes anything without asking.",
    cards: [
      { title: "Your business, set up while you watch", body: "Say what you do. Your website, store and the right modules are set up in minutes, with the reasons shown.", href: "/features/launch", visual: <Typed prompt="A bakery in Pune with home delivery" chips={[{ label: "Website", tone: "lavender" }, { label: "Online store", tone: "peach" }, { label: "GST billing", tone: "mint" }, { label: "Delivery", tone: "sky" }]} /> },
      { title: "Ask your business anything", body: "Who owes the most? What sold best this week? Answers from your own numbers, with links to the records.", href: "/features/copilot", visual: <Typed prompt="Who owes us the most?" chips={[{ label: "Sharma Traders · ₹1.2L", tone: "rose" }, { label: "4 open invoices", tone: "butter" }]} /> },
      { title: "Catch me up", body: "Back from leave? A summary of any chat: decisions made, who's doing what, and questions waiting on you.", href: "/features/chat", visual: <Bubbles lines={[{ text: <><Sparkles className="mr-1 inline size-3 text-violet-600" />3 decisions · 2 action items</> }, { text: "1 question is waiting on you" }]} /> },
      { title: "Imports that understand your columns", body: "Drop in any spreadsheet — its columns are matched to the right fields, with a preview before anything is saved.", href: "/features/online-store", visual: <Flow from={{ icon: <ListChecks />, label: "items.xlsx" }} to={[{ label: "Rate → Price", tone: "mint" }, { label: "Qty → Stock", tone: "sky" }, { label: "Item code → SKU", tone: "butter" }]} /> },
    ],
  },
  {
    key: "talk", label: "Talk to anyone", icon: <MessagesSquare />, tone: "peach",
    pitch: "Clients, vendors and your team in one place — without making anyone sign up.",
    cards: [
      { title: "Guests join a chat with just their name", body: "Send a link by WhatsApp, email or QR. They type their name, you let them in, and they see only that conversation.", href: "/features/chat", visual: <Bubbles lines={[{ text: <><UserPlus className="mr-1 inline size-3" />Asha asks to join #client-project</> }, { me: true, text: "Let in ✓" }, { who: "Asha (guest)", text: "Hello team!" }]} /> },
      { title: "Recurring emails, with their meetings", body: "A stand-up invite every weekday at 9, skipping holidays — the meetings go into your calendar automatically.", href: "/features/mail", visual: <Week /> },
      { title: "Invites read from plain email", body: "“Can we meet Thursday at 4pm?” — the time and link are picked up, ready to add, and the minutes go out after.", href: "/features/calendar", visual: <Typed icon={<CalendarPlus />} prompt="Can we meet Thursday at 4pm?" chips={[{ label: "Thu 4:00 pm", tone: "sky" }, { label: "Google Meet", tone: "mint" }, { label: "Add to calendar", tone: "lavender" }]} /> },
      { title: "Polls, decisions and approvals in chat", body: "Ask, decide and sign off right in the conversation — with who agreed, and why someone objected.", href: "/features/chat", visual: <Bubbles lines={[{ card: true, text: <><span className="block text-[9.5px] font-semibold tracking-wide text-fg/50 uppercase">Approval</span>Laptop for Asha · ₹82,000</> }, { who: "Meera", text: "Approved ✓" }]} /> },
    ],
  },
  {
    key: "india", label: "Made for India", icon: <IndianRupee />, tone: "mint",
    pitch: "GST, UPI, WhatsApp and lakhs-and-crores aren't add-ons here — they're how it works.",
    cards: [
      { title: "GST invoices in your own format", body: "CGST/SGST or IGST worked out by place of supply, HSN codes, amounts in words — eight designs or your own.", href: "/features/invoicing", visual: <Typed icon={<IndianRupee />} prompt="₹40,000 to Maharashtra" chips={[{ label: "CGST 9%", tone: "mint" }, { label: "SGST 9%", tone: "mint" }, { label: "₹47,200", tone: "butter" }]} /> },
      { title: "UPI at the counter and online", body: "Customers scan and pay from any UPI app — at your shop counter or in your online store's checkout.", href: "/features/point-of-sale", visual: <Pay /> },
      { title: "WhatsApp order updates", body: "Confirmed, packed, out for delivery — customers who opt in hear on WhatsApp, with your approved messages.", href: "/features/online-store", visual: <Bubbles lines={[{ text: "Your order #1042 is confirmed ✅" }, { text: "Out for delivery 🚚 — arriving today" }]} /> },
      { title: "Numbers the Indian way", body: "A built-in calculator with lakhs and crores, amounts in words like a cheque, and one tap for 5, 12, 18 or 28% GST.", href: "/start", visual: <Typed icon={<IndianRupee />} prompt="1,25,000 + 18% GST" chips={[{ label: "₹1,47,500", tone: "mint" }, { label: "One Lakh Forty-Seven Thousand Five Hundred Only", tone: "butter" }]} /> },
    ],
  },
  {
    key: "safe", label: "Safe by design", icon: <ShieldCheck />, tone: "rose",
    pitch: "Protection that's switched on from day one — and tells you, in plain words, what it caught.",
    cards: [
      { title: "Phishing, called out in red", body: "Look-alike names, failed sender checks and replies going elsewhere are flagged, with the reason.", href: "/features/mail", visual: <Shield rows={[{ text: "Asha Verma <asha@client.in>" }, { text: "PayPal <alert@paypa1-secure.co>", bad: "Look-alike" }, { text: "Ravi Kumar <ravi@saffron.in>" }]} /> },
      { title: "A firewall built into the app", body: "Common attacks and floods of requests are stopped before they reach your data — on every page and every published site.", href: "/security", visual: <Shield rows={[{ text: "GET /store/products" }, { text: "?id=1' OR '1'='1", bad: "Blocked" }, { text: "200 sign-in tries / min", bad: "Slowed" }]} /> },
      { title: "Guests see one conversation — nothing else", body: "People outside your workspace never see your other channels, your team's emails or older messages, unless you allow it.", href: "/features/chat", visual: <Flow from={{ icon: <Users />, label: "Guest" }} to={[{ label: "#client-project ✓", tone: "mint" }, { label: "Other channels ✕", tone: "rose" }]} /> },
      { title: "Emails can't track you", body: "Remote images stay blocked until you choose to show them, so senders can't tell when you've opened their mail.", href: "/features/mail", visual: <Shield rows={[{ text: "newsletter.png" }, { text: "pixel.gif (tracker)", bad: "Blocked" }]} /> },
    ],
  },
];

const SPANS = ["lg:col-span-4", "lg:col-span-2", "lg:col-span-3", "lg:col-span-3"];
const TURN_MS = 8000;

export function Innovations() {
  const root = useRef<HTMLDivElement>(null);
  const [inView, setIn] = useState(false);
  const [at, setAt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setIn(!!e?.isIntersecting), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const running = inView && !paused && !still;
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setAt((a) => (a + 1) % GROUPS.length), TURN_MS);
    return () => clearTimeout(t);
  }, [running, at]);
  const g = GROUPS[at]!;
  return (
    <div ref={root} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      {/* The groups */}
      <div role="tablist" aria-label="Kinds of ideas" className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-full bg-fg/[0.04] p-1 ring-1 ring-fg/[0.06] [scrollbar-width:none]">
        {GROUPS.map((x, i) => {
          const on = i === at;
          return (
            <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => setAt(i)} className={clsx("relative flex shrink-0 items-center gap-2 overflow-hidden rounded-full px-4 py-2 text-[13px] font-semibold transition-colors [&>svg]:size-4", on ? "bg-[var(--surface-solid)] text-fg shadow-[0_2px_10px_-4px_rgba(0,0,0,0.2)]" : "text-fg/55 hover:text-fg")}>
              <span className={clsx("grid size-6 place-items-center rounded-full [&>svg]:size-3.5", `tint-${x.tone}`, on ? "tint-chip" : "")}>{x.icon}</span>
              {x.label}
              {on && running && <span key={`p-${at}`} aria-hidden className="mk-inv-progress absolute inset-x-3 bottom-0.5 h-[2px] origin-left rounded-full" style={{ background: `var(--p-${x.tone}-ink)`, animationDuration: `${TURN_MS}ms` }} />}
            </button>
          );
        })}
      </div>
      <p key={`pitch-${at}`} className="mk-inv-rise mx-auto mt-5 max-w-2xl text-center text-[15.5px] leading-relaxed text-fg/60">{g.pitch}</p>

      {/* Its ideas */}
      <div key={g.key} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6" role="tabpanel" aria-label={g.label}>
        {g.cards.map((c, i) => (
          <Link
            key={c.title}
            href={c.href}
            className={clsx("mk-inv-card group relative flex flex-col overflow-hidden rounded-[26px] border border-fg/[0.07] bg-[var(--surface-solid)] p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_50px_-36px_rgba(30,27,75,0.35)] transition-[transform,box-shadow] duration-300 hover:-translate-y-1 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_30px_60px_-30px_rgba(30,27,75,0.4)]", SPANS[i], `tint-${g.tone}`)}
            style={{ "--i": i } as CSSProperties}
          >
            <div className={clsx("relative overflow-hidden rounded-[20px] p-4", i === 0 ? "h-[190px]" : "h-[160px]")} style={{ background: `linear-gradient(140deg, var(--p-${g.tone}) 0%, color-mix(in oklab, var(--p-${g.tone}) 40%, var(--surface-solid)) 100%)` }}>
              <span aria-hidden className="pointer-events-none absolute -top-10 -right-10 size-32 rounded-full bg-white/40 blur-2xl" />
              <div className="relative h-full">{c.visual}</div>
            </div>
            <div className="flex flex-1 flex-col px-3 pt-4 pb-3">
              <h3 className="text-[16.5px] leading-snug font-semibold tracking-[-0.01em]">{c.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg/60">{c.body}</p>
              <span className="tint-ink mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-semibold">See how <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" /></span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
