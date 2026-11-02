"use client";

// Phones don't get the long marketing page: they open on a short, swipeable
// intro — the store first, then mail, chat, calendar, notes and invoices — that ends
// on the right sign-up for what they came to do. "Explore the website" lets
// them through to the full page for the rest of the visit.
import "./mobile-intro.css";
import clsx from "clsx";
import { AlarmClock, ArrowRight, BadgeCheck, Bell, CalendarDays, Check, CheckCheck, Clock, FileText, Globe, Hash, LayoutGrid, Lock, Mail, MessageCircle, NotebookPen, ReceiptIndianRupee, ShoppingBag, Sparkles, Store, Video } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Wordmark } from "@/components/brand";

const SKIP_KEY = "cc-intro";
const AT_KEY = "cc-intro-at";
const AUTO_MS = 5000;
const PHONE = "(max-width: 639.98px)";

/** Runs before first paint: a visitor who chose the full website keeps it for this visit. */
const SKIP_SCRIPT = `try{if(sessionStorage.getItem('${SKIP_KEY}')==='skip')document.documentElement.classList.add('intro-off')}catch(e){}`;

// Sign-up carries where to go once the account exists: /start → emailed code → log in → next.
const withNext = (next: string, extra = "") => `/start?${extra}${extra ? "&" : ""}next=${encodeURIComponent(next)}`;

type Slide = { id: string; tone: string; title: ReactNode; art: ReactNode };

const SLIDES: Slide[] = [
  { id: "store", tone: "coral", title: <>Open your <em>store</em> in minutes.</>, art: <StoreArt /> },
  { id: "mail", tone: "teal", title: <>Every <em>inbox</em>, in one place.</>, art: <MailArt /> },
  { id: "chat", tone: "sky", title: <><em>Chat</em> with your whole team.</>, art: <ChatArt /> },
  { id: "calendar", tone: "violet", title: <>Your day, <em>perfectly planned</em>.</>, art: <CalendarArt /> },
  { id: "notes", tone: "amber", title: <><em>Notes</em> that turn into action.</>, art: <NotesArt /> },
  { id: "paid", tone: "mint", title: <>Invoices that <em>get paid</em>.</>, art: <PaidArt /> },
];
const LAST = SLIDES.length; // the final "start" screen comes after the slides
const TONES = [...SLIDES.map((s) => s.tone), "gold"];
const TONE: Record<string, string> = { coral: "#ff6b6b", teal: "#2ec4b6", sky: "#4fb3ff", violet: "#8b7bff", amber: "#f5b544", mint: "#3ccf91", gold: "#f5a35c" };

export function MobileIntro({ signedIn }: { signedIn: boolean }) {
  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const go = useCallback((i: number, manual = true) => {
    setAt(Math.max(0, Math.min(LAST, i)));
    if (manual) setAuto(false);
  }, []);

  // Back from sign-up lands where they left; storage may be blocked, which is fine.
  useEffect(() => {
    try {
      const n = Number(sessionStorage.getItem(AT_KEY));
      if (Number.isInteger(n) && n > 0 && n <= LAST) {
        /* eslint-disable react-hooks/set-state-in-effect -- read once after mount; storage isn't there during server rendering */
        setAt(n);
        setAuto(false);
        /* eslint-enable react-hooks/set-state-in-effect */
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(AT_KEY, String(at));
    } catch {}
  }, [at]);

  // Moves on by itself until they take over.
  useEffect(() => {
    if (!auto || dragging || at >= LAST) return;
    const t = setTimeout(() => go(at + 1, false), AUTO_MS);
    return () => clearTimeout(t);
  }, [auto, dragging, at, go]);

  // The status bar matches the intro on phones; the page's own colour comes back when it goes.
  useEffect(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    const mq = window.matchMedia(PHONE);
    const apply = () => {
      const on = mq.matches && !document.documentElement.classList.contains("intro-off");
      metas.forEach((m, i) => (m.content = on ? "#0b0b0e" : before[i]!));
    };
    apply();
    mq.addEventListener("change", apply);
    const watch = new MutationObserver(apply);
    watch.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => {
      mq.removeEventListener("change", apply);
      watch.disconnect();
      metas.forEach((m, i) => (m.content = before[i]!));
    };
  }, []);

  // Arrow keys for anyone with a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia(PHONE).matches || document.documentElement.classList.contains("intro-off")) return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go]);

  const explore = () => {
    try {
      sessionStorage.setItem(SKIP_KEY, "skip");
    } catch {}
    document.documentElement.classList.add("intro-off");
    window.scrollTo(0, 0);
  };

  // Swipe: the track follows the finger, then settles on the nearest screen.
  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("a,button")) return;
    start.current = { x: e.clientX, y: e.clientY, t: performance.now(), axis: null };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
      s.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") {
        stage.current?.setPointerCapture(e.pointerId);
        setDragging(true);
      }
    }
    if (s.axis !== "x") return;
    // Resists past the first and last screens.
    const edge = (at === 0 && dx > 0) || (at === LAST && dx < 0);
    setDrag(edge ? dx / 3 : dx);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== "x") return;
    const w = stage.current?.clientWidth || 1;
    const v = drag / Math.max(1, performance.now() - s.t);
    if (drag < -w * 0.18 || v < -0.45) go(at + 1);
    else if (drag > w * 0.18 || v > 0.45) go(at - 1);
    setDrag(0);
    setDragging(false);
  };

  const ctas = signedIn
    ? [
        { href: "/home", label: "Open my workspace", icon: LayoutGrid },
        { href: "/launch?kind=store", label: "Open a store", icon: Store },
        { href: "/launch?kind=website", label: "Build a website", icon: Globe },
      ]
    : [
        { href: withNext("/launch?kind=store", "build=store"), label: "Open my store", icon: Store },
        { href: withNext("/launch?kind=website"), label: "Build my website", icon: Globe },
        { href: "/start", label: "Run my whole business", icon: LayoutGrid },
      ];

  return (
    <div className="mi" data-at={at} style={{ "--tone": TONE[TONES[at]!] } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Welcome to Cloudesk">
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      {/* Colour light behind each screen, crossfading as they change. */}
      <div className="mi-bg" aria-hidden>
        {TONES.map((tone, i) => (
          <span key={i} style={{ "--g": TONE[tone] } as CSSProperties} data-on={i === at || undefined} />
        ))}
      </div>

      <header className="mi-top">
        <Wordmark className="text-[21px]" />
        <Link href={signedIn ? "/home" : "/login"} className="mi-ghost">
          {signedIn ? "Open app" : "Log in"}
        </Link>
      </header>

      <div ref={stage} className="mi-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className={clsx("mi-track", dragging && "is-drag")} style={{ transform: `translate3d(calc(${-at * 100}% + ${drag}px),0,0)` }}>
          {SLIDES.map((s, i) => (
            <section key={s.id} className="mi-slide" style={{ "--tone": TONE[s.tone] } as CSSProperties} data-on={i === at || undefined} aria-hidden={i !== at} aria-roledescription="slide" aria-label={`${i + 1} of ${LAST + 1}`}>
              <div className="mi-art-wrap">{s.art}</div>
              <h2 className={`mi-title mi-t-${s.tone}`}>{s.title}</h2>
            </section>
          ))}

          <section className="mi-slide mi-final" style={{ "--tone": TONE.gold } as CSSProperties} data-on={at === LAST || undefined} aria-hidden={at !== LAST} aria-roledescription="slide" aria-label={`${LAST + 1} of ${LAST + 1}`}>
            <div className="mi-art-wrap">
              <FinalArt />
            </div>
            <h2 className="mi-title mi-t-gold">
              Your business, <em>one workspace</em>.
            </h2>
            <div className="mi-ctas">
              {ctas.map((c, i) => {
                const Icon = c.icon;
                return (
                  <Link key={c.href} href={c.href} tabIndex={at === LAST ? undefined : -1} className={clsx("mi-btn", i === 0 ? "mi-btn-main" : "mi-btn-glass")} style={{ "--d": `${160 + i * 70}ms` } as CSSProperties}>
                    <Icon className="size-[18px]" aria-hidden />
                    <span>{c.label}</span>
                    <ArrowRight className="mi-btn-arrow size-4" aria-hidden />
                  </Link>
                );
              })}
              <div className="mi-foot">
                {!signedIn && (
                  <Link href="/login" tabIndex={at === LAST ? undefined : -1}>
                    Have an account? <b>Log in</b>
                  </Link>
                )}
                <button type="button" onClick={explore} tabIndex={at === LAST ? undefined : -1}>
                  Explore the website
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <nav className="mi-bar" aria-label="Intro screens">
        <button type="button" className="mi-skip" onClick={() => go(LAST)} data-hide={at === LAST || undefined} tabIndex={at === LAST ? -1 : undefined}>
          Skip
        </button>
        <div className="mi-dots">
          {Array.from({ length: LAST + 1 }, (_, i) => (
            <button key={i} type="button" aria-label={`Screen ${i + 1}`} aria-current={i === at || undefined} onClick={() => go(i)} className={clsx("mi-dot", i === at && "is-on", i < at && "is-past")}>
              {i === at && auto && at < LAST && !dragging && <i style={{ animationDuration: `${AUTO_MS}ms` }} />}
            </button>
          ))}
        </div>
        <button type="button" className="mi-next" onClick={() => go(at + 1)} aria-label="Next" data-hide={at === LAST || undefined} tabIndex={at === LAST ? -1 : undefined}>
          <ArrowRight className="size-5" />
        </button>
      </nav>
    </div>
  );
}

// ─── Art ────────────────────────────────────────────────────────────────────

const v = (vars: Record<string, string | number>) => vars as CSSProperties;

function Avatar({ name, c }: { name: string; c: string }) {
  return (
    <span className="mi-av" style={v({ "--c": c })}>
      {name}
    </span>
  );
}

/** A storefront building itself, then going live and taking an order. */
function StoreArt() {
  const tiles = [
    { name: "Linen shirt", price: "₹1,299", g: "linear-gradient(150deg,#f3d9cf,#d9a796)" },
    { name: "Clay mug", price: "₹449", g: "linear-gradient(150deg,#efe3cf,#cfb48b)" },
    { name: "Canvas tote", price: "₹799", g: "linear-gradient(150deg,#dcdbe8,#a9a6c4)" },
    { name: "Soy candle", price: "₹599", g: "linear-gradient(150deg,#d8e6dc,#9fbea9)" },
  ];
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-phone">
        <div className="mi-ph-bar">
          <span className="mi-ph-url">
            <Lock className="size-[0.85em]" aria-hidden /> yourshop.in
          </span>
        </div>
        <div className="mi-ph-hero">
          <small>New season</small>
          <b>Made by hand.</b>
          <span className="mi-ph-btn">Shop now</span>
        </div>
        <div className="mi-ph-grid">
          {tiles.map((t, i) => (
            <div key={t.name} className="mi-ph-tile" style={v({ "--i": i })}>
              <span className="mi-ph-img" style={{ background: t.g }} />
              <span className="mi-ph-name">{t.name}</span>
              <span className="mi-ph-price">{t.price}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="mi-chip mi-chip-live">
        <i /> Live
      </span>
      <span className="mi-chip mi-chip-time">
        <Clock className="size-[1.1em]" aria-hidden /> <Clockface />
      </span>
      <div className="mi-toast mi-toast-order">
        <span className="mi-toast-ic">
          <ShoppingBag className="size-[1.15em]" aria-hidden />
        </span>
        <span className="mi-toast-tx">
          <b>New order · ₹1,299</b>
          <small>Linen shirt · just now</small>
        </span>
      </div>
    </div>
  );
}

/** Counts up to 3:58 each time the first screen shows. */
function Clockface() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    const slide = el?.closest(".mi-slide");
    if (!el || !slide) return;
    let raf = 0;
    const run = () => {
      cancelAnimationFrame(raf);
      if (!slide.hasAttribute("data-on")) return;
      const t0 = performance.now();
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0 - 500) / 1700);
        const s = Math.round(238 * (1 - Math.pow(1 - Math.max(0, p), 3)));
        el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    run();
    const watch = new MutationObserver(run);
    watch.observe(slide, { attributes: true, attributeFilter: ["data-on"] });
    return () => {
      cancelAnimationFrame(raf);
      watch.disconnect();
    };
  }, []);
  return <span ref={ref}>3:58</span>;
}

/** One inbox for every mailbox: a new mail lands, sorted and labelled, with a follow-up set and a reply drafted. */
function MailArt() {
  const rows = [
    { name: "Meera Shah", av: "M", c: "#ff8a7a", subject: "Bulk order for Diwali", time: "10:42", tag: "Client", tc: "#ff8a7a", acct: "#ea4335", fresh: true },
    { name: "Razorpay", av: "R", c: "#4fb3ff", subject: "Payment received · ₹24,500", time: "10:15", tag: "Invoice", tc: "#3ccf91", acct: "#0a64d8" },
    { name: "Arjun Rao", av: "A", c: "#8b7bff", subject: "Re: Supplier rates", time: "9:40", follow: true, acct: "#f5b544" },
    { name: "Shiprocket", av: "S", c: "#f5b544", subject: "Order #2381 delivered", time: "9:02", acct: "#ea4335" },
  ];
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-win mi-mail">
        <div className="mi-mail-head">
          <span className="mi-win-title">
            <b>All inboxes</b>
            <small>Gmail · Outlook · Zoho</small>
          </span>
          <span className="mi-accts" aria-hidden>
            <i style={{ background: "#ea4335" }}>G</i>
            <i style={{ background: "#0a64d8" }}>O</i>
            <i style={{ background: "#f5b544" }}>Z</i>
          </span>
        </div>
        <div className="mi-tabs">
          <span className="is-on">Primary</span>
          <span>
            Clients <b>3</b>
          </span>
          <span>Invoices</span>
          <span>Updates</span>
        </div>
        <div className="mi-rows">
          {rows.map((r, i) => (
            <div key={r.name} className={clsx("mi-row", r.fresh && "is-new")} style={v({ "--i": i, "--acct": r.acct })}>
              <Avatar name={r.av} c={r.c} />
              <span className="mi-row-tx">
                <span className="mi-row-top">
                  <b>{r.name}</b>
                  <small>{r.time}</small>
                </span>
                <span className="mi-row-sub">
                  <span>{r.subject}</span>
                  {r.tag && (
                    <em className="mi-tag" style={v({ "--c": r.tc! })}>
                      {r.tag}
                    </em>
                  )}
                  {r.follow && <AlarmClock className="mi-row-follow size-[1.15em]" aria-label="Follow-up set" />}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="mi-toast mi-toast-ai">
        <span className="mi-toast-ic">
          <Sparkles className="size-[1.1em]" aria-hidden />
        </span>
        <span className="mi-toast-tx">
          <b>Reply drafted</b>
          <small>Ready to send to Meera</small>
        </span>
      </div>
    </div>
  );
}

/** A team channel: messages arrive, a file is shared, someone is typing. */
function ChatArt() {
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-win mi-chat">
        <div className="mi-win-head">
          <span className="mi-win-ic">
            <Hash className="size-[1.1em]" aria-hidden />
          </span>
          <span className="mi-win-title">
            <b>store-team</b>
            <small>
              <i className="mi-online" /> 6 online
            </small>
          </span>
          <span className="mi-stack">
            <Avatar name="P" c="#ff8a7a" />
            <Avatar name="A" c="#8b7bff" />
            <Avatar name="R" c="#3ccf91" />
          </span>
        </div>
        <div className="mi-chat-body">
          <div className="mi-msg" style={v({ "--i": 0 })}>
            <Avatar name="P" c="#ff8a7a" />
            <p className="mi-bub">
              <b>Priya</b>New stock just arrived.
            </p>
          </div>
          <div className="mi-msg mi-msg-me" style={v({ "--i": 1 })}>
            <p className="mi-bub">
              Listing it on the store now.
              <small>
                10:42 <CheckCheck className="size-[1.1em]" aria-hidden />
              </small>
            </p>
          </div>
          <div className="mi-msg" style={v({ "--i": 2 })}>
            <Avatar name="A" c="#8b7bff" />
            <div className="mi-bub mi-file">
              <span className="mi-file-ic">
                <FileText className="size-[1.1em]" aria-hidden />
              </span>
              <span>
                <b>Diwali-offer.pdf</b>
                <small>2.4 MB</small>
              </span>
            </div>
          </div>
          <div className="mi-msg" style={v({ "--i": 3 })}>
            <Avatar name="R" c="#3ccf91" />
            <p className="mi-bub mi-typing" aria-label="Typing">
              <i />
              <i />
              <i />
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Today's schedule filling in, with the time line moving through it. */
function CalendarArt() {
  const days = [
    ["M", 3],
    ["T", 4],
    ["W", 5],
    ["T", 6],
    ["F", 7],
    ["S", 8],
    ["S", 9],
  ] as const;
  const events = [
    { title: "Supplier call", time: "9:30 – 10:15", top: 6.5, h: 9.75, c: "#4fb3ff" },
    { title: "Team stand-up", time: "10:30", top: 19.5, h: 6.5, c: "#8b7bff", who: true },
    { title: "Client demo", time: "11:30 – 12:30", top: 32.5, h: 13, c: "#ff8a7a", meet: true },
  ];
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-win mi-cal">
        <div className="mi-cal-head">
          <b>November</b>
          <span>Today</span>
        </div>
        <div className="mi-week">
          {days.map(([d, n]) => (
            <span key={n} className={clsx(n === 6 && "is-today")}>
              <small>{d}</small>
              <b>{n}</b>
            </span>
          ))}
        </div>
        <div className="mi-day">
          {["9", "10", "11", "12"].map((h, i) => (
            <span key={h} className="mi-hour" style={v({ "--r": i })}>
              {h}
            </span>
          ))}
          {events.map((e, i) => (
            <div key={e.title} className="mi-ev" style={v({ "--top": `${e.top}cqw`, "--h": `${e.h}cqw`, "--c": e.c, "--i": i })}>
              <b>{e.title}</b>
              <small>
                {e.meet && <Video className="size-[1.1em]" aria-hidden />}
                {e.time}
              </small>
              {e.who && (
                <span className="mi-stack mi-ev-who">
                  <Avatar name="P" c="#ff8a7a" />
                  <Avatar name="A" c="#8b7bff" />
                </span>
              )}
            </div>
          ))}
          <span className="mi-now" />
        </div>
      </div>
      <div className="mi-toast mi-toast-remind">
        <span className="mi-toast-ic">
          <Bell className="size-[1.1em]" aria-hidden />
        </span>
        <span className="mi-toast-tx">
          <b>Client demo in 10 min</b>
          <small>Join with one tap</small>
        </span>
      </div>
    </div>
  );
}

/** A shared note whose checklist ticks itself off while a teammate edits. */
function NotesArt() {
  const items = [
    { t: "Shoot product photos", done: "pre" },
    { t: "Write store policies", done: "a" },
    { t: "Set up UPI payments", done: "b" },
    { t: "Announce the launch", done: "" },
  ];
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-win mi-doc">
        <p className="mi-doc-crumb">
          <NotebookPen className="size-[1.1em]" aria-hidden /> Notes / Launch
        </p>
        <b className="mi-doc-title">Launch plan</b>
        <p className="mi-doc-meta">
          <span className="mi-stack">
            <Avatar name="K" c="#f5b544" />
            <Avatar name="A" c="#8b7bff" />
          </span>
          Edited just now
        </p>
        <ul className="mi-todo">
          {items.map((it, i) => (
            <li key={it.t} data-done={it.done || undefined} style={v({ "--i": i })}>
              <span className="mi-box">
                <Check className="size-[0.8em]" strokeWidth={3.2} aria-hidden />
              </span>
              <span className="mi-todo-t">{it.t}</span>
            </li>
          ))}
        </ul>
        <span className="mi-cursor">
          <i />
          <b>Arjun</b>
        </span>
      </div>
      <span className="mi-chip mi-chip-ai">
        <Sparkles className="size-[1.1em]" aria-hidden /> 3 of 4 done
      </span>
    </div>
  );
}

/** An invoice getting stamped paid, with the month's takings rising behind it. */
function PaidArt() {
  const bars = [38, 52, 44, 66, 58, 84];
  return (
    <div className="mi-art">
      <div className="mi-halo" />
      <div className="mi-chart">
        <div className="mi-chart-head">
          <span>Collected this month</span>
          <b>+38%</b>
        </div>
        <div className="mi-bars">
          {bars.map((h, i) => (
            <span key={i} style={v({ "--h": `${h}%`, "--i": i })} />
          ))}
        </div>
      </div>
      <div className="mi-inv">
        <div className="mi-inv-head">
          <span className="mi-inv-ic">
            <ReceiptIndianRupee className="size-[1.1em]" aria-hidden />
          </span>
          <span>
            <b>Invoice #1042</b>
            <small>Tax invoice · GST</small>
          </span>
        </div>
        <span className="mi-inv-line" style={v({ "--w": "86%", "--i": 0 })} />
        <span className="mi-inv-line" style={v({ "--w": "64%", "--i": 1 })} />
        <span className="mi-inv-line" style={v({ "--w": "74%", "--i": 2 })} />
        <div className="mi-inv-total">
          <span>Total</span>
          <b>₹24,500</b>
        </div>
        <span className="mi-stamp">
          <Check className="size-[1em]" strokeWidth={3} aria-hidden /> Paid
        </span>
      </div>
      <div className="mi-toast mi-toast-upi">
        <span className="mi-toast-ic">
          <BadgeCheck className="size-[1.15em]" aria-hidden />
        </span>
        <span className="mi-toast-tx">
          <b>₹24,500 received</b>
          <small>via UPI · reminder auto-sent</small>
        </span>
      </div>
    </div>
  );
}

/** Everything they just saw, as apps on one home screen. */
function FinalArt() {
  const apps = [
    { icon: Store, label: "Store", c: "#ff8a7a" },
    { icon: MessageCircle, label: "Chat", c: "#4fb3ff" },
    { icon: CalendarDays, label: "Calendar", c: "#8b7bff" },
    { icon: NotebookPen, label: "Notes", c: "#f5b544" },
    { icon: ReceiptIndianRupee, label: "Invoices", c: "#3ccf91" },
    { icon: Mail, label: "Mail", c: "#7dd3fc" },
  ];
  return (
    <div className="mi-art mi-art-final">
      <div className="mi-halo" />
      <div className="mi-apps">
        {apps.map((a, i) => {
          const Icon = a.icon;
          return (
            <span key={a.label} className="mi-appt" style={v({ "--c": a.c, "--i": i })}>
              <span className="mi-appt-ic">
                <Icon className="size-[44%]" aria-hidden />
              </span>
              <small>{a.label}</small>
            </span>
          );
        })}
      </div>
    </div>
  );
}
