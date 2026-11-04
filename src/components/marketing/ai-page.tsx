"use client";

// Cloudesk AI (/intelligence): every AI power in the product, on one page. A matte-black
// opening around a living "core" — a turning aurora with the apps it reaches
// in orbit; four powers (understands, acts, checks, builds) on a pinned stage
// that changes as you scroll; an ask bar that types real questions; every AI
// feature in a bento of small animated scenes; real screens; the two AI films;
// the guard rails; and the free trial to start. Everything listed exists in
// the product today — the
// sample figures are marked as samples. Styles: .aix-* in (marketing)/marketing.css.
import clsx from "clsx";
import {
  ArrowRight, AudioLines, BookOpenCheck, Bot, Brain, Camera, Check, CheckCircle2, Code2, FileScan, FileText, FlaskConical, Globe, Languages, Lock, Mail, MessagesSquare, NotebookPen, Receipt, ScanSearch, Search, ShieldCheck, ShoppingBag, Sparkles, Store, TriangleAlert, Wallet, Wand2, type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DarkBand } from "./dark-hero";
import { Reveal } from "./interactive";
import { IPhone17 } from "./iphone";
import { MacBook } from "./macbook";
import { H2, W } from "./sections";

const PublicAiMode = dynamic(() => import("@/components/ai-mode/public-ai").then((m) => m.PublicAiMode), { ssr: false });

/** True once the element has scrolled into view (and stays true). */
function useSeen<T extends HTMLElement>(margin = "-10% 0px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (setSeen(true), io.disconnect()), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return [ref, seen] as const;
}

const Eyebrow = ({ children, className }: { children: ReactNode; className?: string }) => <p className={clsx("aix-eyebrow", className)}>{children}</p>;

/* ───────── the opening ───────── */

/** The apps the AI reaches, in orbit around the core. */
const ORBIT: [LucideIcon, string][] = [[Mail, "Mail"], [NotebookPen, "Notes"], [MessagesSquare, "Chat"], [Receipt, "Bills"], [Store, "Store"], [Globe, "Website"], [FileText, "Docs"], [Search, "Search"]];

function Core() {
  return (
    <div className="aix-core" aria-hidden>
      <div className="aix-aurora" />
      <div className="aix-ring aix-ring-1" />
      <div className="aix-ring aix-ring-2" />
      <div className="aix-ring aix-ring-3" />
      <div className="aix-orbit">
        {ORBIT.map(([I, label], k) => (
          <span key={label} className="aix-sat" style={{ animationDelay: `${-(k / ORBIT.length) * 48}s` } as CSSProperties}>
            <span className="aix-sat-in" style={{ animationDelay: `${-(k / ORBIT.length) * 48}s` }}>
              <I className="size-4" /> {label}
            </span>
          </span>
        ))}
      </div>
      <div className="aix-heart">
        <span className="aix-pulse" />
        <span className="aix-pulse" style={{ animationDelay: "1.4s" }} />
        <Sparkles className="size-9" strokeWidth={1.5} />
      </div>
    </div>
  );
}

export function AiHero() {
  const [ai, setAi] = useState(false);
  return (
    <DarkBand tint="lavender" className="overflow-hidden">
      <div className={clsx(W, "relative grid grid-cols-[minmax(0,1fr)] items-center gap-6 pt-10 pb-6 sm:gap-12 sm:pt-14 sm:pb-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pt-20 lg:pb-16")}>
        <div className="relative z-10">
          <Eyebrow>Cloudesk AI</Eyebrow>
          <h1 className="mt-6 text-[clamp(2.7rem,6.4vw,5.6rem)] leading-[0.98] font-[300] tracking-[-0.05em] text-balance">
            Intelligence in <span className="aix-shine">every corner</span> of your business.
          </h1>
          <p className="mt-6 max-w-xl text-[clamp(1rem,1.4vw,1.2rem)] leading-relaxed text-fg/60">
            Ask your books a question. Let it draft the reply, read the bill, list the product, catch the duplicate, build the page. Cloudesk AI works across mail, chat, notes, money, your store and your website — and nothing changes until you say so.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3 max-sm:[&>*]:w-full max-sm:[&>*]:justify-center sm:mt-9">
            <Link href="/start" className="aix-cta">Start free <ArrowRight className="size-4" /></Link>
            <button type="button" onClick={() => setAi(true)} className="aix-ghost"><Sparkles className="size-4" /> Set up with AI</button>
          </div>
          <dl className="mt-9 grid max-w-xl grid-cols-3 gap-4 border-t border-fg/10 pt-6 sm:mt-12 sm:gap-6">
            {[["20+", "AI powers"], ["Every", "app in one place"], ["0", "changes without you"]].map(([n, l]) => (
              <div key={l}><dt className="text-[clamp(1.5rem,2.4vw,2.1rem)] font-[300] tracking-[-0.04em]">{n}</dt><dd className="mt-1 text-[13px] text-fg/50">{l}</dd></div>
            ))}
          </dl>
        </div>
        <Core />
      </div>
      {ai && createPortal(<PublicAiMode onClose={() => setAi(false)} />, document.body)}
    </DarkBand>
  );
}

/* ───────── four powers, on a pinned stage ───────── */

function UnderstandScene() {
  const rows: [string, number, string][] = [["Asha Traders", 92, "₹1,84,200"], ["Lumen Living", 58, "₹1,12,400"], ["Brew & Bloom", 34, "₹64,900"], ["Still Waters Spa", 21, "₹38,500"]];
  return (
    <div className="aix-stage-card">
      <p className="aix-q"><span className="aix-type">Which customers owe us the most right now?</span></p>
      <div className="aix-a">
        <p className="flex items-center gap-2 text-[12px] text-fg/50"><BookOpenCheck className="size-3.5" /> Ran “Invoices by customer” · unpaid only</p>
        <div className="mt-3 grid gap-2.5">
          {rows.map(([n, w, v], k) => (
            <div key={n} className="aix-row" style={{ "--i": k } as CSSProperties}>
              <span className="w-32 shrink-0 truncate">{n}</span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-fg/[0.06]"><i className="aix-bar" style={{ "--w": `${w}%` } as CSSProperties} /></span>
              <b className="w-20 text-right font-medium tabular-nums">{v}</b>
            </div>
          ))}
        </div>
        <p className="aix-row mt-4 text-[13px] text-fg/70" style={{ "--i": 4 } as CSSProperties}>Four customers owe ₹4,00,000 between them. Asha Traders is 46 days past due — want me to draft a reminder?</p>
      </div>
      <p className="aix-sample">Sample data</p>
    </div>
  );
}

function ActScene() {
  const cards: [LucideIcon, string, string][] = [[Mail, "Send a payment reminder", "To Asha Traders · ₹1,84,200 · friendly tone"], [Wallet, "Record the supplier bill", "Moradabad Brass Works · ₹42,380 · Office supplies"], [Check, "Add a follow-up task", "Call Lumen Living about the renewal · Friday"]];
  return (
    <div className="aix-stage-card">
      <p className="text-[12px] text-fg/50">The copilot suggests — you decide</p>
      <div className="mt-4 grid gap-3">
        {cards.map(([I, t, s], k) => (
          <div key={t} className={clsx("aix-propose", k === 0 && "aix-propose-done")} style={{ "--i": k } as CSSProperties}>
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-fg/[0.05]"><I className="size-4" /></span>
            <span className="min-w-0 flex-1"><b className="block text-[14px] font-medium">{t}</b><span className="block truncate text-[12px] text-fg/50">{s}</span></span>
            <span className="aix-confirm"><span>Confirm</span><CheckCircle2 className="size-4" /></span>
          </div>
        ))}
      </div>
      <p className="aix-sample">Sample data</p>
    </div>
  );
}

function CheckScene() {
  const rows: [string, string, string | null][] = [["BL-0004", "Kaveri Dairy · ₹18,400", null], ["BL-0005", "Pune Packaging · ₹9,950", null], ["BL-0006", "Moradabad Brass Works · ₹42,380", null], ["BL-0007", "Moradabad Brass Works · ₹42,380", "Possible duplicate — same bill number as BL-0006"], ["EXP", "Office supplies · ₹2,02,950", "Spending spike — about 13× the usual month"]];
  return (
    <div className="aix-stage-card">
      <p className="text-[12px] text-fg/50">Checks run through your books</p>
      <div className="aix-scan relative mt-4 grid gap-1.5 overflow-hidden rounded-[14px]">
        <span className="aix-scanline" />
        {rows.map(([n, t, flag], k) => (
          <div key={n + k} className={clsx("aix-ledger", flag && "aix-flag")} style={{ "--i": k } as CSSProperties}>
            <span className="w-16 shrink-0 font-mono text-[11px] text-fg/40">{n}</span>
            <span className="min-w-0 flex-1 truncate">{t}</span>
            {flag && <span className="aix-flag-tag"><TriangleAlert className="size-3" /> {flag}</span>}
          </div>
        ))}
      </div>
      <p className="aix-sample">Sample data</p>
    </div>
  );
}

function BuildScene() {
  return (
    <div className="aix-stage-card !p-3">
      <div className="overflow-hidden rounded-[14px] ring-1 ring-fg/[0.06]">
        <Image src="/marketing/builder/ai.jpg" alt="The website builder with its AI assistant open" width={1440} height={900} className="aix-build-shot h-auto w-full" />
      </div>
      <div className="aix-build-prompt">
        <Wand2 className="size-4 shrink-0" />
        <span className="aix-type">Add a gallery of our cakes after the menu, and make the hero warmer</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 px-1">
        {["+ Gallery section", "~ Hero colours: warmer", "✓ Review the diff, then apply"].map((t, k) => <span key={t} className="aix-diff" style={{ "--i": k } as CSSProperties}>{t}</span>)}
      </div>
    </div>
  );
}

const POWERS = [
  { id: "understand", n: "01", title: "It understands", body: "Ask in plain words. It picks the right report — invoices, deals, stock, the ledger, projects — runs it as you, and answers with the figures. Only what your role can see.", scene: <UnderstandScene /> },
  { id: "act", n: "02", title: "It acts — when you say so", body: "Reminders, bills, tasks, deals, invoices, calendar events, emails: it drafts each one as a card. Nothing is saved or sent until you press Confirm.", scene: <ActScene /> },
  { id: "check", n: "03", title: "It checks", body: "Bills entered twice, a bill far above a supplier's usual, expense accounts running well ahead of recent months — flagged before you pay.", scene: <CheckScene /> },
  { id: "build", n: "04", title: "It builds", body: "Describe a change to your website and it edits the design, then shows you the difference to apply or reject. In the AI IDE it proposes code edits the same way.", scene: <BuildScene /> },
];

const GLOW = ["#c9bcff", "#ffc9b5", "#ffe1a8", "#b8e0ff"];

function SeenScene({ children }: { children: ReactNode }) {
  const [ref, seen] = useSeen<HTMLDivElement>("-15% 0px");
  return <div ref={ref} className="mt-6 min-h-[260px] lg:hidden">{seen && children}</div>;
}

export function Powers() {
  const [on, setOn] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setOn(Number((e.target as HTMLElement).dataset.k))), { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <section className="relative py-14 sm:py-28">
      <div className={W}>
        <Reveal className="max-w-3xl">
          <Eyebrow>Four powers</Eyebrow>
          <h2 className={clsx(H2, "mt-4")}>It understands, acts, checks — and builds.</h2>
        </Reveal>
        <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
          <ol className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:gap-0">
            {POWERS.map((p, k) => (
              <li key={p.id} ref={(el) => { refs.current[k] = el; }} data-k={k} className={clsx("aix-power", on === k && "aix-power-on")}>
                <span className="aix-power-n">{p.n}</span>
                <h3 className="text-[clamp(1.5rem,2.4vw,2.2rem)] leading-tight font-[340] tracking-[-0.035em]">{p.title}</h3>
                <p className="mt-3 max-w-md text-[15.5px] leading-relaxed text-fg/60">{p.body}</p>
                {/* Phones and tablets get each scene under its words, playing once it's on screen. */}
                <SeenScene>{p.scene}</SeenScene>
              </li>
            ))}
          </ol>
          <div className="relative hidden lg:block">
            <div className="aix-stage sticky top-28">
              <div aria-hidden className="aix-stage-glow" style={{ "--g": GLOW[on] } as CSSProperties} />
              {POWERS.map((p, k) => (
                <div key={p.id} className="aix-stage-slot" data-on={on === k || undefined} aria-hidden={on !== k}>
                  {on === k && p.scene}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────── ask anything ───────── */

const ASKS = [
  "How did October's sales compare with September?",
  "Which open deals haven't moved in a while?",
  "What's running low in stock?",
  "Summarise this contract and flag anything unusual",
  "Draft a polite reply asking for the payment",
  "Catch me up on the #launch channel",
  "Translate this note into Hindi",
  "What's our GST position this quarter?",
];

function useTyping(lines: string[], run: boolean) {
  const [state, set] = useState({ k: 0, n: 0 });
  useEffect(() => {
    if (!run) return;
    const line = lines[state.k]!;
    const done = state.n >= line.length;
    const t = setTimeout(() => set(done ? { k: (state.k + 1) % lines.length, n: 0 } : { k: state.k, n: state.n + 1 }), done ? 1800 : 34);
    return () => clearTimeout(t);
  }, [state, run, lines]);
  return lines[state.k]!.slice(0, state.n);
}

export function AskAnything() {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const text = useTyping(ASKS, seen);
  const row = (items: string[], rev = false) => (
    <div className="aix-marquee" data-rev={rev || undefined}>
      <div className="aix-marquee-track">
        {[...items, ...items].map((q, k) => <span key={k} className="aix-pill">{q}</span>)}
      </div>
    </div>
  );
  return (
    <section className="relative overflow-hidden py-14 sm:py-28">
      <div className={clsx(W, "text-center")} ref={ref}>
        <Reveal>
          <Eyebrow className="justify-center">Ask anything</Eyebrow>
          <h2 className={clsx(H2, "mx-auto mt-4 max-w-4xl")}>Your business, answerable.</h2>
          <p className="mx-auto mt-4 max-w-xl text-[16px] leading-relaxed text-fg/55">From the copilot, from search, from any note, thread or document. Answers come from your own data, with the figures.</p>
        </Reveal>
        <div className="aix-askbar mx-auto mt-9 max-w-3xl sm:mt-12">
          <Sparkles className="size-5 shrink-0 text-[#7c5cff]" />
          <span className="min-w-0 flex-1 truncate text-left text-[clamp(1rem,1.6vw,1.25rem)]">{text}<span className="aix-caret" /></span>
          <span className="aix-ask-go"><ArrowRight className="size-4" /></span>
        </div>
      </div>
      <div className="mt-9 grid gap-2.5 sm:mt-12 sm:gap-3">
        {row(ASKS.slice(0, 4).concat(["Who are our top ten customers this year?", "Which invoices are overdue?"]))}
        {row(ASKS.slice(4).concat(["Remind me to call Asha on Friday", "What did we spend on travel last month?"]), true)}
      </div>
    </section>
  );
}

/* ───────── every AI feature ───────── */

type Tile = { icon: LucideIcon; tint: string; title: string; body: string; chips?: string[]; viz?: ReactNode; wide?: boolean; key?: boolean };

const Lines = ({ n = 3 }: { n?: number }) => <div className="aix-lines">{Array.from({ length: n }, (_, k) => <i key={k} style={{ "--i": k } as CSSProperties} />)}</div>;
const Cycle = ({ words }: { words: string[] }) => (
  <div className="aix-cycle" style={{ "--n": words.length } as CSSProperties}>
    <div className="aix-cycle-track">{[...words, words[0]].map((w, k) => <span key={k}>{w}</span>)}</div>
  </div>
);

const TILES: Tile[] = [
  { icon: Brain, tint: "lavender", title: "Copilot and six specialist advisors", body: "One assistant for the whole workspace, plus advisors with an expert brief on Indian rules and practice. It runs reports, searches records, reads your calendar and mail, and finds problems in the books.", viz: <Cycle words={["Finance & tax", "Legal", "Sales", "Operations", "People", "Strategy"]} />, wide: true, key: true },
  { icon: FileScan, tint: "peach", title: "Reads your documents", body: "Attach a photo or file and it knows what it is — a bill, receipt, invoice, PO, quotation, contract, bank statement, business card and more — and offers what to do with it.", viz: <div className="aix-doc"><span className="aix-doc-scan" /><Lines n={5} /></div> },
  { icon: Receipt, tint: "butter", title: "Bills fill themselves in", body: "Upload a supplier bill and it drafts the bill form with the expense accounts suggested. You review, then save.", chips: ["PDF", "JPG", "PNG"] },
  { icon: ShoppingBag, tint: "rose", title: "A photo becomes a listing", body: "From one product photo: title, description, tags, alt text, a collection — and for Indian shops, a suggested HSN code and GST rate.", viz: <Lines n={4} /> },
  { icon: Mail, tint: "sky", title: "Mail that reads itself", body: "Summaries, reply drafts (friendly, formal or short), the action items in a thread, and a morning briefing of what needs you first.", viz: <Cycle words={["Summary", "Friendly reply", "Formal reply", "Action items", "Morning briefing"]} /> },
  { icon: MessagesSquare, tint: "mint", title: "Chat that catches you up", body: "What happened, what was decided and what's asked of you. Ask a conversation a question; rewrite a message clearer, shorter — or in Hindi.", chips: ["Catch me up", "Ask", "Rewrite"], viz: <div className="aix-chat"><i>Catch me up on #launch</i><i>3 decisions, 2 tasks for you — the banner goes live Friday.</i></div>, wide: true },
  { icon: NotebookPen, tint: "butter", title: "Notes and documents that write with you", body: "Rewrite, change the tone, translate, summarise, continue, turn text into a table — and ask across all your notes, with sources.", viz: <Lines n={4} />, wide: true },
  { icon: Globe, tint: "lavender", title: "A website from a brief", body: "Describe your business and it plans the pages and sections; then change the design in plain words and review every change before it goes live.", chips: ["Plan", "Edit", "Review"] },
  { icon: Languages, tint: "sky", title: "Your site, in another language", body: "Translate all of a website's copy in one go." , viz: <Cycle words={["Hello", "नमस्ते", "Bonjour", "Hola", "こんにちは"]} /> },
  { icon: Code2, tint: "mint", title: "An AI pair in the IDE", body: "It proposes file changes as a diff for a person to apply. It reads your project; it never runs anything on its own.", viz: <div className="aix-code"><i>+ const used = new Set()</i><i>− let used = []</i><i>+ return `SW-${"{n}"}`</i></div> },
  { icon: FlaskConical, tint: "peach", title: "Headlines that earn their place", body: "It suggests a headline to test against yours. Half your visitors see each; the new one only replaces yours if it measurably wins." },
  { icon: Bot, tint: "rose", title: "A chatbot for your visitors", body: "Answers on your website from your own pages, products and policies — and says when it doesn't know, handing over to your team.", viz: <div className="aix-chat"><i>Do you do gluten-free cakes?</i><i>Yes — three, from ₹650. Want to order?</i></div> },
  { icon: Camera, tint: "lavender", title: "A camera that scans", body: "Snap a page: crop, straighten and clean it up like a scan, add pages, then send it to the AI, save it as a PDF or file it in Documents." },
  { icon: Search, tint: "sky", title: "Search that answers", body: "Ask a question from the search bar and get an answer, not just a list of links." },
  { icon: AudioLines, tint: "mint", title: "It remembers what matters", body: "Owners add policies, prices and FAQs for everyone's conversations; it remembers lasting facts you tell it — for you only." },
  { icon: ScanSearch, tint: "butter", title: "Setup, by conversation", body: "Tell it what you do in one line. It works out your industry, ticks the right answers and picks the features you need. Two minutes.", chips: ["No key needed"], wide: true },
];

export function Bento() {
  return (
    <section className="relative py-14 sm:py-28">
      <div className={W}>
        <Reveal className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-3xl">
            <Eyebrow>Every AI feature</Eyebrow>
            <h2 className={clsx(H2, "mt-4")}>One intelligence, in every app.</h2>
          </div>
          <p className="max-w-sm text-[15px] leading-relaxed text-fg/55 sm:text-[15.5px]">Not a chatbot bolted on the side. It&apos;s inside your mail, chat, notes, documents, books, store and website — where the work already is.</p>
        </Reveal>
        {/* A swipeable row on phones; a bento grid from tablets up. */}
        <div className="-mx-5 mt-9 flex snap-x snap-mandatory scroll-px-5 gap-3 overflow-x-auto px-5 pb-3 [scrollbar-width:none] sm:mx-0 sm:mt-12 sm:grid sm:grid-cols-2 sm:gap-4 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          {TILES.map((t, k) => (
            <Reveal key={t.title} delay={(k % 4) * 70} className={clsx("aix-tile w-[82%] shrink-0 snap-start sm:w-auto", `tint-${t.tint}`, t.wide && "lg:col-span-2", t.key && "aix-tile-key")}>
              <span className="aix-tile-icon"><t.icon className="size-5" /></span>
              <h3 className="mt-5 text-[18px] leading-snug font-medium tracking-[-0.02em]">{t.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-fg/58">{t.body}</p>
              {t.chips && <div className="mt-4 flex flex-wrap gap-1.5">{t.chips.map((c) => <span key={c} className="aix-chip">{c}</span>)}</div>}
              {t.viz && <div className="mt-5">{t.viz}</div>}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── real screens ───────── */

const SCREENS = [
  { src: "/marketing/copilot/checks.jpg", title: "Checks", body: "A duplicate bill and a spending spike, caught." },
  { src: "/marketing/chatbot/inbox.jpg", title: "Website chatbot", body: "A visitor's question, answered from the spa's own services." },
  { src: "/marketing/ai-ide/editor.jpg", title: "AI IDE", body: "Code changes proposed, reviewed, applied by a person." },
  { src: "/marketing/growth/ideas.jpg", title: "Growth", body: "Tests to try, measured on real visitors." },
];

export function RealScreens() {
  const [on, setOn] = useState(0);
  const [ref, seen] = useSeen<HTMLDivElement>();
  useEffect(() => {
    if (!seen) return;
    const t = setInterval(() => setOn((k) => (k + 1) % SCREENS.length), 4200);
    return () => clearInterval(t);
  }, [seen]);
  return (
    <section className="relative py-14 sm:py-28">
      <div className={W} ref={ref}>
        <Reveal className="max-w-3xl">
          <Eyebrow>The real thing</Eyebrow>
          <h2 className={clsx(H2, "mt-4")}>Not a concept. It&apos;s in the product.</h2>
        </Reveal>
        <div className="mt-9 grid grid-cols-[minmax(0,1fr)] items-center gap-6 sm:mt-12 lg:gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.6fr)]">
          <MacBook>
            <div className="relative aspect-[16/10] w-full">
              {SCREENS.map((s, k) => <Image key={s.src} src={s.src} alt={s.title} fill sizes="(min-width:1024px) 60vw, 100vw" className={clsx("object-cover object-top transition-opacity duration-1000", on === k ? "opacity-100" : "opacity-0")} />)}
            </div>
          </MacBook>
          <ol className="-mx-5 flex snap-x gap-2 overflow-x-auto px-5 [scrollbar-width:none] lg:mx-0 lg:grid lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
            {SCREENS.map((s, k) => (
              <li key={s.src} className="w-[68%] shrink-0 snap-start sm:w-[40%] lg:w-auto">
                <button type="button" onClick={() => setOn(k)} className={clsx("aix-screen-tab", on === k && "aix-screen-on")}>
                  <b className="block text-[16px] font-medium">{s.title}</b>
                  <span className="mt-1 block text-[13.5px] text-fg/55">{s.body}</span>
                  <i className="aix-screen-bar" />
                </button>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

/* ───────── the films ───────── */

export function Films() {
  const films = [
    { src: "/marketing/films/ai.mp4", poster: "/marketing/films/ai.jpg", title: "Meet Cloudesk AI", body: "It understands, powers, checks and tools your business." },
    { src: "/marketing/films/ai-camera.mp4", poster: "/marketing/films/ai-camera.jpg", title: "The AI camera", body: "Snap it, clean it, file it — or ask about it." },
  ];
  return (
    <>
    <div aria-hidden className="aix-fade-in" />
    <DarkBand tint="lavender" className="!pt-0">
      <section className={clsx(W, "py-14 sm:py-28")}>
        <Reveal className="mx-auto max-w-3xl text-center">
          <Eyebrow className="justify-center">See it move</Eyebrow>
          <h2 className={clsx(H2, "mt-4")}>Two films. Ninety seconds.</h2>
        </Reveal>
        <div className="mt-10 flex items-start justify-center gap-4 sm:mt-14 sm:gap-16">
          {films.map((f, k) => (
            <Reveal key={f.src} delay={k * 120} className="w-[min(43vw,290px)] text-center">
              <IPhone17 className="w-full">
                <video src={f.src} poster={f.poster} autoPlay muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
              </IPhone17>
              <h3 className="mt-5 text-[15px] font-medium sm:mt-6 sm:text-[18px]">{f.title}</h3>
              <p className="mt-1 text-[12.5px] leading-snug text-fg/55 sm:text-[14px]">{f.body}</p>
            </Reveal>
          ))}
        </div>
      </section>
    </DarkBand>
    </>
  );
}

/* ───────── the guard rails ───────── */

const RAILS: [LucideIcon, string, string][] = [
  [CheckCircle2, "Nothing changes until you confirm", "Every email, bill, task or edit it suggests waits as a card for your Confirm."],
  [Lock, "Your permissions, always", "It runs as you. A rep who sees only their own deals gets answers about only their own deals."],
  [BookOpenCheck, "Figures, not guesses", "Numbers come from reports it runs on your data, and it says when it can't find something."],
  [ShieldCheck, "A budget you control", "AI use counts against your plan's monthly allowance, so there are no surprise bills. Bring your own Claude or Gemini key if you like."],
];

export function Rails() {
  return (
    <section className="relative py-14 sm:py-28">
      <div className={W}>
        <Reveal className="max-w-3xl">
          <Eyebrow>On a leash</Eyebrow>
          <h2 className={clsx(H2, "mt-4")}>Powerful. And polite about it.</h2>
        </Reveal>
        <div className="mt-9 grid gap-px overflow-hidden rounded-[24px] sm:mt-12 bg-fg/[0.07] ring-1 ring-fg/[0.07] sm:grid-cols-2 lg:grid-cols-4">
          {RAILS.map(([I, t, b], k) => (
            <Reveal key={t} delay={k * 80} className="aix-rail">
              <I className="size-6" strokeWidth={1.5} />
              <h3 className="mt-8 text-[17px] font-medium tracking-[-0.02em]">{t}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-fg/55">{b}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────── start ───────── */

export function StartCta() {
  const [ai, setAi] = useState(false);
  return (
    <section className="relative py-14 sm:py-28">
      <div className={clsx(W, "max-sm:px-3")}>
        <Reveal className="aix-pre text-center">
          <div aria-hidden className="aix-pre-glow" />
          <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-white/[0.06] ring-1 ring-white/10"><Sparkles className="size-6 text-[#c9bcff]" strokeWidth={1.5} /></span>
          <h2 className="mx-auto mt-7 max-w-3xl text-[clamp(2.2rem,4.6vw,4rem)] leading-[1.02] font-[300] tracking-[-0.045em] text-balance">Put <span className="aix-shine">intelligence</span> to work.</h2>
          <p className="mx-auto mt-4 max-w-md text-[16px] leading-relaxed text-fg/60">Every feature and every AI power, free for 30 days. No card needed.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3 max-sm:[&>*]:w-full max-sm:[&>*]:justify-center">
            <Link href="/start" className="aix-cta">Start free <ArrowRight className="size-4" /></Link>
            <button type="button" onClick={() => setAi(true)} className="aix-ghost"><Sparkles className="size-4" /> Set up with AI</button>
          </div>
        </Reveal>
      </div>
      {ai && createPortal(<PublicAiMode onClose={() => setAi(false)} />, document.body)}
    </section>
  );
}

/* ───────── questions ───────── */

const FAQ: [string, string][] = [
  ["Which AI does Cloudesk use?", "Claude, by Anthropic, or Google's Gemini. Your workspace can connect its own key under Settings → AI providers; otherwise it uses the platform's."],
  ["Can it change my data on its own?", "No. Everything it suggests — an email, a bill, a task, an edit to your site — waits for you to press Confirm, and it can only do what your role can do."],
  ["Does any of it work without an AI key?", "Yes — Setup with AI, the checks on your books, the daily briefing and forecasts run on built-in rules. The rest uses the platform's AI, or your own Claude or Gemini key."],
  ["Does the AI cost extra?", "AI use is included in every plan up to its monthly allowance, so there are no surprise bills. Setup with AI and the built-in checks need no AI allowance at all."],
];

export function Questions() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="relative pt-6 pb-20 sm:pt-10 sm:pb-32">
      <div className={clsx(W, "grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]")}>
        <Reveal>
          <Eyebrow>Questions</Eyebrow>
          <h2 className={clsx(H2, "mt-4")}>Asked often.</h2>
        </Reveal>
        <div className="divide-y divide-fg/[0.08] border-y border-fg/[0.08]">
          {FAQ.map(([q, a], k) => (
            <div key={q}>
              <button type="button" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)} className="flex w-full items-center justify-between gap-6 py-4 text-left text-[15.5px] font-medium sm:py-5 sm:text-[17px]">
                {q}<span className={clsx("aix-plus", open === k && "aix-plus-on")} aria-hidden />
              </button>
              <div className={clsx("grid transition-[grid-template-rows] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]", open === k ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                <p className="overflow-hidden pb-0 text-[15px] leading-relaxed text-fg/60"><span className="block pb-5">{a}</span></p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
