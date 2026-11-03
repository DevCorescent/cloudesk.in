"use client";

// Home page: the ideas that make Cloudesk different, in five groups, on a
// full-width matte-black band lit in each group's pastel. One idea at a time
// takes the spotlight with its small animated mock-up shown large (HTML and
// CSS, so it's crisp and light); they play in turn, then the next group.
// Hovering pauses, and people who prefer less motion see it still.
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

const IDEA_MS = 3600;

/** The whole "What makes it different" section, on matte black lit in each group's pastel. */
export function Innovations() {
  const root = useRef<HTMLElement>(null);
  const [inView, setIn] = useState(false);
  const [at, setAt] = useState(0);
  const [idea, setIdea] = useState(0);
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
  // Each idea in turn; after a group's last idea, the next group.
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => {
      if (idea + 1 < GROUPS[at]!.cards.length) {
        setIdea(idea + 1);
      } else {
        setIdea(0);
        setAt((at + 1) % GROUPS.length);
      }
    }, IDEA_MS);
    return () => clearTimeout(t);
  }, [running, at, idea]);
  // Keep the active group in view in the row (it scrolls on phones), without moving the page.
  const rail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = rail.current;
    const tab = r?.children[at] as HTMLElement | undefined;
    if (r && tab && r.scrollWidth > r.clientWidth) r.scrollTo({ left: tab.offsetLeft - r.offsetLeft - (r.clientWidth - tab.offsetWidth) / 2, behavior: "smooth" });
  }, [at]);
  const g = GROUPS[at]!;
  const c = g.cards[idea]!;
  const pickGroup = (i: number) => (setAt(i), setIdea(0));
  return (
    <section ref={root} id="ideas" className="relative py-12 sm:py-16" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <div className="mk-dark iv-band relative isolate overflow-hidden pt-16 pb-10 sm:pt-24 sm:pb-14">
        {/* The light takes each group's pastel; all five stay mounted and cross-fade. */}
        {GROUPS.map((x, i) => <div key={x.key} aria-hidden className={clsx("mk-dark-glow iv-glow", `tint-${x.tone}`, i === at && "is-on")} />)}
        <div className="mx-auto w-full max-w-[1600px] px-5 sm:px-8 lg:px-14 xl:px-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[12px] font-semibold tracking-[0.18em] text-fg/45 uppercase">What makes it different</p>
            <h2 className="mt-3 text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.03] font-[360] tracking-[-0.045em] text-balance">Ideas no one else <span className="iv-shine">put together.</span></h2>
          </div>

          <div className="mt-12 grid gap-8 lg:mt-16 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:items-center lg:gap-14">
            {/* The five groups */}
            <div ref={rail} role="tablist" aria-label="Kinds of ideas" className="-mx-5 flex gap-2 overflow-x-auto px-5 [scrollbar-width:none] sm:-mx-8 sm:px-8 lg:mx-0 lg:grid lg:gap-1 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
              {GROUPS.map((x, i) => {
                const on = i === at;
                return (
                  <button key={x.key} type="button" role="tab" aria-selected={on} onClick={() => pickGroup(i)} className={clsx("iv-group group relative shrink-0 text-left transition-colors max-lg:rounded-full max-lg:px-4 max-lg:py-2.5 lg:rounded-[20px] lg:px-5 lg:py-4", `tint-${x.tone}`, on ? "is-on max-lg:bg-white max-lg:text-[#0b0b0c] lg:bg-white/[0.06]" : "text-fg/45 hover:text-fg/80 max-lg:bg-white/[0.06]")}>
                    <span className="flex items-center gap-3">
                      <span className="hidden text-[12px] font-medium tabular-nums opacity-60 lg:inline">{String(i + 1).padStart(2, "0")}</span>
                      <span className={clsx("grid size-7 shrink-0 place-items-center rounded-full [&>svg]:size-3.5 lg:size-9 lg:[&>svg]:size-4", on ? "tint-chip" : "bg-white/[0.06]")}>{x.icon}</span>
                      <span className={clsx("text-[13.5px] font-medium whitespace-nowrap lg:text-[clamp(1.15rem,1.7vw,1.5rem)] lg:font-[380] lg:tracking-[-0.025em]", on && "lg:text-fg")}>{x.label}</span>
                    </span>
                    {on && <span key={`pitch-${at}`} className="mk-inv-rise mt-2 hidden pl-[4.6rem] text-[14px] leading-relaxed text-fg/55 lg:block">{x.pitch}</span>}
                    {on && running && <span key={`p-${at}`} aria-hidden className="iv-progress absolute right-5 bottom-0 left-5 hidden h-[2px] origin-left rounded-full lg:block" style={{ animationDuration: `${IDEA_MS * x.cards.length}ms` }} />}
                  </button>
                );
              })}
            </div>

            {/* The spotlight: one idea, its animated scene large */}
            <div className={clsx("min-w-0", `tint-${g.tone}`)}>
              <Link key={`${g.key}-${idea}`} href={c.href} className="iv-card group block overflow-hidden rounded-[30px] bg-white/[0.05] p-2.5 ring-1 ring-white/[0.08] backdrop-blur-xl">
                <div className="mk-keep-light iv-scene relative h-[240px] overflow-hidden rounded-[22px] p-6 sm:h-[300px] sm:p-10" style={{ background: `linear-gradient(140deg, var(--p-${g.tone}) 0%, color-mix(in oklab, var(--p-${g.tone}) 45%, #fff) 100%)` }}>
                  <span aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-white/50 blur-3xl" />
                  <div className="iv-visual relative mx-auto h-full max-w-[440px]">{c.visual}</div>
                </div>
                <div className="flex items-end justify-between gap-4 px-4 pt-5 pb-3 sm:px-5">
                  <div className="min-w-0">
                    <h3 className="text-[clamp(1.15rem,1.8vw,1.45rem)] leading-snug font-[420] tracking-[-0.02em] text-balance">{c.title}</h3>
                    <p className="mt-1.5 line-clamp-2 max-w-xl text-[14px] leading-relaxed text-fg/55">{c.body}</p>
                  </div>
                  <span className="tint-chip grid size-11 shrink-0 place-items-center rounded-full transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"><ArrowUpRight className="size-5" /></span>
                </div>
              </Link>
              {/* The group's ideas */}
              <div role="tablist" aria-label={g.label} className="mt-4 grid grid-cols-4 gap-2">
                {g.cards.map((x, i) => (
                  <button key={x.title} type="button" role="tab" aria-selected={i === idea} onClick={() => setIdea(i)} title={x.title} className={clsx("relative h-1.5 overflow-hidden rounded-full transition-colors", i < idea ? "bg-white/60" : "bg-white/[0.12] hover:bg-white/25")}>
                    {i === idea && <span key={`i-${at}-${idea}-${running}`} aria-hidden className={clsx("absolute inset-0 origin-left rounded-full bg-white", running && "iv-fill")} style={running ? { animationDuration: `${IDEA_MS}ms` } : undefined} />}
                    <span className="sr-only">{x.title}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden className="mk-dark-fade -mt-px" />
    </section>
  );
}
