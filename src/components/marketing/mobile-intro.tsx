"use client";

// Phones don't get the long marketing page: they open on a short, swipeable
// story — too many apps, then one: the store, every inbox and chat, the
// calendar and getting paid, all on Cloudesk — ending on the right sign-up
// for what they came to do. Each screen shows the real app (a browser window
// with a phone in front) on the pages' matte black lit by each screen's tone,
// after a short logo splash on every load. "Setup with AI" opens the sign-up
// conversation from any screen. "Explore the website" lets them through to the
// full page for the rest of the visit.
import { LAUNCH_OFFER } from "@/lib/festive";
import { freeFor } from "@/lib/festive";
import "./mobile-intro.css";
import clsx from "clsx";
import { ArrowRight, BellRing, CalendarCheck, CreditCard, FileCheck, Gift, Globe, LayoutGrid, Link as LinkIcon, RefreshCw, ScanBarcode, ScanSearch, Sparkles, Wand2, Store, TrendingUp, Video, Zap, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { IPhone17, type IPhoneColor } from "@/components/marketing/iphone";
import { useSignedIn } from "@/lib/client/use-signed-in";

// AI mode loads only when it's opened.
const PublicAiMode = dynamic(() => import("@/components/ai-mode/public-ai").then((m) => m.PublicAiMode), { ssr: false });

const SKIP_KEY = "cc-intro";
const AT_KEY = "cc-intro-at";
/** The splash's length: the intro starts animating at READY, the splash is gone by DONE. */
const SPLASH_READY_MS = 2050;
const SPLASH_DONE_MS = 2700;
const AUTO_MS = 5000;
const PHONE = "(max-width: 639.98px)";

/** Runs before first paint: a visitor who chose the full website keeps it for this visit. */
const SKIP_SCRIPT = `try{if(sessionStorage.getItem('${SKIP_KEY}')==='skip')document.documentElement.classList.add('intro-off')}catch(e){}`;

// Sign-up carries where to go once the account exists: /start → emailed code → log in → next.
const withNext = (next: string, extra = "") => `/start?${extra}${extra ? "&" : ""}next=${encodeURIComponent(next)}`;

type Slide = { id: string; tone: string; title: ReactNode; sub: string; screen: string; phones: string[]; badges: Badge[] };

/** A key feature floating over a screen: where it sits (CSS insets, %) and which side it flies in from. */
type Badge = { icon: LucideIcon; text: string; at: Partial<Record<"top" | "bottom" | "left" | "right", string>>; from: "l" | "r" };

function Badges({ items }: { items: Badge[] }) {
  return (
    <>
      {items.map((b, i) => {
        const Icon = b.icon;
        return (
          <span key={b.text} className="mi-badge" data-from={b.from} style={{ ...b.at, "--i": i } as CSSProperties}>
            <span className="mi-badge-in">
              <span className="mi-badge-ic">
                <Icon className="size-3.5" aria-hidden />
              </span>
              {b.text}
            </span>
          </span>
        );
      })}
    </>
  );
}

// Screens are paths under public/marketing: wide ones are 2880×1800, phones 1206×2622.
const SLIDES: Slide[] = [
  {
    id: "one",
    tone: "#ff7a59",
    title: <>Too many apps? Meet <em>one</em>.</>,
    sub: "35+ tools, one login, set up in minutes.",
    screen: "home/dashboard",
    phones: ["phones/crm", "phones/hrms", "phones/inventory"],
    badges: [
      { icon: LayoutGrid, text: "35+ apps, one login", at: { top: "0", left: "0" }, from: "l" },
      { icon: Zap, text: "Set up in minutes", at: { top: "52%", left: "-2%" }, from: "l" },
      { icon: Gift, text: `Free for ${freeFor()}`, at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
  {
    id: "ai",
    tone: "#8b6cff",
    title: <>AI that <em>runs with you</em>.</>,
    sub: "Ask your books. It drafts, checks and builds.",
    screen: "copilot/checks",
    phones: ["phones/chatbot", "phones/ai-ide"],
    badges: [
      { icon: Sparkles, text: "Ask in plain words", at: { top: "0", left: "0" }, from: "l" },
      { icon: ScanSearch, text: "Catches duplicate bills", at: { top: "52%", left: "-2%" }, from: "l" },
      { icon: Wand2, text: "Nothing changes till you confirm", at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
  {
    id: "store",
    tone: "#ef5da8",
    title: <>Your store, <em>live today</em>.</>,
    sub: "UPI, cards and COD — and no commission.",
    screen: "store/products",
    phones: ["store/sf-phone"],
    badges: [
      { icon: CreditCard, text: "UPI, cards & COD", at: { top: "0", left: "0" }, from: "l" },
      { icon: Globe, text: "Your own domain", at: { top: "52%", left: "-2%" }, from: "l" },
      { icon: ScanBarcode, text: "Shop & online, one stock", at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
  {
    id: "talk",
    tone: "#14a89b",
    title: <>Every chat, <em>one inbox</em>.</>,
    sub: "Mail, chat and WhatsApp, sorted by AI.",
    screen: "chat/channel",
    phones: ["workspace/m-mail", "workspace/m-chat"],
    badges: [
      { icon: Sparkles, text: "Sorts itself, AI replies", at: { top: "0", left: "0" }, from: "l" },
      { icon: LinkIcon, text: "Guests join by link", at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
  {
    id: "plan",
    tone: "#7a6af0",
    title: <>Your day, <em>sorted</em>.</>,
    sub: "Meetings, bookings and reminders together.",
    screen: "calendar/week",
    phones: ["workspace/m-calendar", "phones/bookings"],
    badges: [
      { icon: Video, text: "Meeting links built in", at: { top: "0", left: "0" }, from: "l" },
      { icon: RefreshCw, text: "Syncs Google & Outlook", at: { top: "52%", left: "-2%" }, from: "l" },
      { icon: CalendarCheck, text: "Online bookings", at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
  {
    id: "paid",
    tone: "#22a06b",
    title: <>One tap, <em>you&apos;re paid</em>.</>,
    sub: "GST invoices that chase themselves.",
    screen: "finance/overview",
    phones: ["phones/invoicing", "phones/point-of-sale"],
    badges: [
      { icon: FileCheck, text: "GST e-invoices", at: { top: "0", left: "0" }, from: "l" },
      { icon: TrendingUp, text: "Live profit & loss", at: { top: "52%", left: "-2%" }, from: "l" },
      { icon: BellRing, text: "Reminders send themselves", at: { bottom: "6%", left: "2%" }, from: "l" },
    ],
  },
];
const FINAL_TONE = "#f08a4b";
const DIWALI_TONE = "#e0a03a";

export function MobileIntro({ diwali = false, offer = false }: { diwali?: boolean; offer?: boolean }) {
  const signedIn = useSignedIn();
  // During Diwali the story opens on the gift (lib/festive.ts), and every screen wears the festival.
  const lead = diwali ? 1 : 0;
  const LAST = SLIDES.length + lead; // the final "start" screen comes after the story
  const toneAt = (i: number) => (i < lead ? DIWALI_TONE : (SLIDES[i - lead]?.tone ?? FINAL_TONE));
  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The logo splash plays first; nothing on the screens animates until it clears.
  const [splash, setSplash] = useState<"on" | "leaving" | "off">("on");
  const [aiMode, setAiMode] = useState(false);
  const ready = splash !== "on";

  // Every load plays it, except where motion is turned off or there's no intro (wider screens).
  useEffect(() => {
    const quick = window.matchMedia("(prefers-reduced-motion: reduce)").matches || !window.matchMedia(PHONE).matches;
    if (quick) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- decided once after mount; media queries aren't there during server rendering
      setSplash("off");
      return;
    }
    const a = setTimeout(() => setSplash("leaving"), SPLASH_READY_MS);
    const b = setTimeout(() => setSplash("off"), SPLASH_DONE_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);

  const go = useCallback((i: number, manual = true) => {
    setAt(Math.max(0, Math.min(LAST, i)));
    if (manual) setAuto(false);
  }, [LAST]);

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
  }, [LAST]);
  useEffect(() => {
    try {
      sessionStorage.setItem(AT_KEY, String(at));
    } catch {}
  }, [at]);

  // Moves on by itself until they take over.
  useEffect(() => {
    if (!ready || !auto || dragging || aiMode || at >= LAST) return;
    const t = setTimeout(() => go(at + 1, false), AUTO_MS);
    return () => clearTimeout(t);
  }, [ready, auto, dragging, aiMode, at, go, LAST]);

  // The status bar matches the intro on phones; the page's own colour comes back when it goes.
  useEffect(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    const mq = window.matchMedia(PHONE);
    const apply = () => {
      const on = mq.matches && !document.documentElement.classList.contains("intro-off");
      metas.forEach((m, i) => (m.content = on ? (diwali ? "#fdf6ee" : "#0b0b0c") : before[i]!));
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
  }, [diwali]);

  // Arrow keys for anyone with a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!window.matchMedia(PHONE).matches || document.documentElement.classList.contains("intro-off") || aiMode) return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, aiMode]);

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
  const last = at === LAST;

  return (
    <div className="mi" data-at={at} data-diwali={diwali || undefined} style={{ "--tone": toneAt(at) } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Welcome to Cloudesk">
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      {splash !== "off" && <Splash leaving={splash === "leaving"} diwali={diwali} />}
      {diwali && <MiFestive />}
      {/* Colour light behind each screen, crossfading as they change. */}
      <div className="mi-bg" aria-hidden>
        {Array.from({ length: LAST + 1 }, (_, i) => (
          <span key={i} style={{ "--g": toneAt(i) } as CSSProperties} data-on={i === at || undefined} />
        ))}
      </div>

      <header className="mi-top">
        <Wordmark className="text-[20px]" />
        <button type="button" className="mi-ai" onClick={() => setAiMode(true)} aria-haspopup="dialog">
          <Sparkles className="size-3.5" aria-hidden />
          <span>AI mode</span>
        </button>
        {last ? (
          <Link href={signedIn ? "/home" : "/login"} className="mi-link">
            {signedIn ? "Open app" : "Log in"}
          </Link>
        ) : (
          <button type="button" className="mi-link" onClick={() => go(LAST)}>
            Skip
          </button>
        )}
      </header>
      <div className="mi-prog" aria-hidden>
        {Array.from({ length: LAST + 1 }, (_, i) => (
          <span key={i} className={clsx(i < at && "is-past", i === at && "is-on")}>
            {i === at && <i className={clsx(ready && auto && !last && !dragging && "is-run")} style={{ animationDuration: `${AUTO_MS}ms` }} />}
          </span>
        ))}
      </div>

      <div ref={stage} className="mi-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className={clsx("mi-track", dragging && "is-drag")} style={{ transform: `translate3d(calc(${-at * 100}% + ${drag}px),0,0)` }}>
          {diwali && <DiwaliSlide on={ready && at === 0} offer={offer} signedIn={signedIn} label={`1 of ${LAST + 1}`} />}
          {SLIDES.map((s, j) => {
            const i = j + lead;
            return (
            <section key={s.id} className="mi-slide" style={{ "--tone": s.tone } as CSSProperties} data-on={(ready && i === at) || undefined} aria-hidden={i !== at} aria-roledescription="slide" aria-label={`${i + 1} of ${LAST + 1}`}>
              <div className="mi-art-wrap">
                <ShotArt screen={s.screen} phones={s.phones} first={i === 0} label={s.id}>
                  <Badges items={s.badges} />
                </ShotArt>
              </div>
              <h2 className="mi-title">{s.title}</h2>
              <p className="mi-sub">{s.sub}</p>
            </section>
            );
          })}

          <section className="mi-slide mi-final" style={{ "--tone": FINAL_TONE } as CSSProperties} data-on={(ready && last) || undefined} aria-hidden={!last} aria-roledescription="slide" aria-label={`${LAST + 1} of ${LAST + 1}`}>
            <div className="mi-art-wrap">
              <FinalArt />
            </div>
            <h2 className="mi-title">
              One app. <em>Every business.</em>
            </h2>
            <p className="mi-sub">Start with what you need, add the rest later.</p>
            <div className="mi-ctas">
              {ctas.map((c, i) => {
                const Icon = c.icon;
                return (
                  <Link key={c.href} href={c.href} tabIndex={last ? undefined : -1} className={clsx("mi-btn", i === 0 ? "mi-btn-main" : "mi-btn-glass")} style={{ "--d": `${160 + i * 70}ms` } as CSSProperties}>
                    <Icon className="size-[18px]" aria-hidden />
                    <span>{c.label}</span>
                    <ArrowRight className="mi-btn-arrow size-4" aria-hidden />
                  </Link>
                );
              })}
              <div className="mi-foot">
                {!signedIn && (
                  <Link href="/login" tabIndex={last ? undefined : -1}>
                    Have an account? <b>Log in</b>
                  </Link>
                )}
                <button type="button" onClick={explore} tabIndex={last ? undefined : -1}>
                  Explore the website
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <div className="mi-bar" data-hide={last || undefined}>
        <button type="button" className="mi-setup" onClick={() => setAiMode(true)} tabIndex={last ? -1 : undefined} aria-haspopup="dialog">
          <Sparkles className="size-[15px]" aria-hidden />
          <span>Setup with AI</span>
        </button>
        <button type="button" className="mi-next" onClick={() => go(at + 1)} tabIndex={last ? -1 : undefined}>
          <span>{at === LAST - 1 ? "Get started" : "Continue"}</span>
          <span className="mi-next-arrow" aria-hidden>
            <ArrowRight className="size-[14px]" strokeWidth={2.25} />
          </span>
        </button>
      </div>
      {aiMode && <PublicAiMode onClose={() => setAiMode(false)} />}
    </div>
  );
}

// ─── Diwali (while lib/festive.ts says so) ──────────────────────────────────

/** The festival over every screen: a marigold toran across the top, and petals drifting down. */
function MiFestive() {
  return (
    <div className="mi-festive" aria-hidden>
      <svg className="mi-toran" width="100%" height="64">
        <defs>
          <radialGradient id="mi-mg" cx="45%" cy="40%" r="60%"><stop offset="0" stopColor="#ffd36b" /><stop offset="0.55" stopColor="#f6a43a" /><stop offset="1" stopColor="#e07b1f" /></radialGradient>
          <radialGradient id="mi-mg2" cx="45%" cy="40%" r="60%"><stop offset="0" stopColor="#fff0a8" /><stop offset="0.6" stopColor="#f7c948" /><stop offset="1" stopColor="#e3a21a" /></radialGradient>
          <pattern id="mi-toran" width="130" height="64" patternUnits="userSpaceOnUse">
            <path d="M0 3 Q65 37 130 3" fill="none" stroke="#c8922f" strokeWidth="0.7" opacity="0.6" />
            {Array.from({ length: 6 }, (_, i) => {
              const t = (i + 0.5) / 6;
              return <circle key={i} cx={130 * t} cy={3 + 68 * t * (1 - t)} r="5.4" fill={i % 2 ? "url(#mi-mg2)" : "url(#mi-mg)"} stroke="#c46a12" strokeWidth="0.7" strokeDasharray="1.1 1.4" />;
            })}
            <path d="M0 3 q-5 10 0 22 q5 -12 0 -22 z M2 5 q9 7 7 19 q-9 -6 -7 -19 z M-2 5 q-9 7 -7 19 q9 -6 7 -19 z" fill="#86b571" />
            <path d="M130 3 q-5 10 0 22 q5 -12 0 -22 z M132 5 q9 7 7 19 q-9 -6 -7 -19 z M128 5 q-9 7 -7 19 q9 -6 7 -19 z" fill="#86b571" />
            <path d="M65 20 v8" stroke="#c8922f" strokeWidth="0.7" opacity="0.6" />
            <path d="M65 27 c-3 4 -3 7 0 9 c3 -2 3 -5 0 -9 z" fill="#e3b14d" />
          </pattern>
        </defs>
        <rect width="100%" height="64" fill="url(#mi-toran)" />
      </svg>
      {Array.from({ length: 9 }, (_, i) => <span key={i} className="mi-petal" style={{ left: `${(i * 37 + 8) % 94}%`, "--d": `${(i * 1.9) % 11}s`, "--t": `${11 + (i % 4) * 3}s`, "--x": `${(i % 2 ? 1 : -1) * (24 + (i % 3) * 20)}px`, "--c": i % 3 ? "#f6a43a" : "#f7c948" } as CSSProperties} />)}
    </div>
  );
}

/** The first screen during Diwali: a gift that wobbles, bursts open and lifts its card out — the launch offer. */
function DiwaliSlide({ on, offer, signedIn, label }: { on: boolean; offer: boolean; signedIn: boolean; label: string }) {
  const [left, setLeft] = useState<string | null>(null);
  useEffect(() => {
    if (!offer) return;
    const tick = () => {
      const ms = Math.max(0, new Date(LAUNCH_OFFER.until).getTime() - Date.now());
      setLeft(`${Math.floor(ms / 86_400_000)}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h left`);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [offer]);
  return (
    <section className="mi-slide mi-dw" style={{ "--tone": DIWALI_TONE } as CSSProperties} data-on={on || undefined} aria-hidden={!on} aria-roledescription="slide" aria-label={label}>
      <div className="mi-art-wrap">
        <div className="mi-gift-stage" role="img" aria-label={offer ? `A Diwali gift: three months of Cloudesk, free, until ${LAUNCH_OFFER.lastDay}` : "A Diwali gift from Cloudesk"}>
          <span className="mi-rays" />
          <span className="mi-halo" />
          <div className="mi-gift">
            <div className="mi-card">
              {offer ? (
                <>
                  <span className="mi-card-kick">Your Diwali gift</span>
                  <span className="mi-card-big"><b>3</b> months</span>
                  <span className="mi-card-sub">of Cloudesk, free</span>
                </>
              ) : (
                <>
                  <span className="mi-card-kick" lang="hi">शुभ दीपावली</span>
                  <span className="mi-card-big">Happy</span>
                  <span className="mi-card-sub">Diwali</span>
                </>
              )}
              {Array.from({ length: 6 }, (_, i) => <i key={i} className="mi-orbit" style={{ "--i": i } as CSSProperties} />)}
            </div>
            <div className="mi-box"><i className="mi-ribbon" /><i className="mi-sheen" /></div>
            <div className="mi-lid"><i className="mi-ribbon" /><span className="mi-bow"><i /><i /><b /></span></div>
            <div className="mi-burst">
              {Array.from({ length: 18 }, (_, i) => <i key={i} className={i % 3 === 0 ? "mi-spark" : "mi-flake"} style={{ "--a": `${(360 / 18) * i + (i % 2) * 8}deg`, "--r": `${90 + (i % 4) * 34}px`, "--d": `${(i % 5) * 40}ms`, "--c": i % 2 ? "#f6a43a" : "#f7c948" } as CSSProperties} />)}
            </div>
          </div>
          <span className="mi-floor" />
        </div>
      </div>
      <p className="mi-dw-hi" lang="hi">शुभ दीपावली</p>
      <h2 className="mi-title">{offer ? <>Grow with <em>Cloudesk</em> this Diwali.</> : <>Happy <em>Diwali</em>.</>}</h2>
      <p className="mi-sub">{offer ? <>3 months of every feature, free{left ? <> · <b className="mi-dw-left">{left}</b></> : null}</> : "Light, joy and growth to you and yours."}</p>
      <Link href={signedIn ? "/home" : "/start"} tabIndex={on ? undefined : -1} className="mi-dw-cta">
        {offer && !signedIn ? "Claim offer" : signedIn ? "Open my workspace" : "Start free"} <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}

// ─── The logo splash ────────────────────────────────────────────────────────

/** The Cloudesk mark drawing itself stroke by stroke, the name settling in under it, then everything dissolving into the intro. */
function Splash({ leaving, diwali }: { leaving: boolean; diwali: boolean }) {
  return (
    <div className={clsx("mi-splash", leaving && "is-leaving")} aria-hidden>
      <div className="mi-splash-in">
        <span className="mi-splash-glow" />
        {diwali && <span className="mi-splash-diya"><i /></span>}
        <svg viewBox="14 9 292 459" className="mi-splash-mark" fill="none" strokeWidth="28">
          <path pathLength={1} d="M28 387V90A67 67 0 0 1 95 23" stroke="#FF5A5F" />
          <path pathLength={1} d="M95 23A67 67 0 0 1 161 102A100 100 0 0 1 238 282" stroke="#FDBA5A" />
          <path pathLength={1} d="M238 282A72 72 0 0 1 162 398A67 67 0 0 1 28 387" stroke="#16132a" strokeOpacity=".85" />
        </svg>
        <p className="mi-splash-name">
          {"cloudesk".split("").map((ch, i) => (
            <span key={i} style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

// ─── Real screens ────────────────────────────────────────────────────────────

/** A browser window with a real screen, and a phone in front cross-fading through its screens. */
function ShotArt({ screen, phones, first, label, children }: { screen: string; phones: string[]; first?: boolean; label: string; children?: ReactNode }) {
  return (
    <div className="mi-art">
      <div className="mi-win">
        <div className="mi-win-bar" aria-hidden>
          <i />
          <i />
          <i />
          <span>app.cloudesk.in</span>
        </div>
        <div className="mi-win-shot">
          <Image src={`/marketing/${screen}.jpg`} alt="" aria-hidden fill sizes="92vw" priority={first} className="mi-pan object-cover object-left-top" />
        </div>
      </div>
      <PhoneShot shots={phones} first={first} className="mi-phone" key={label} />
      {children}
    </div>
  );
}

/** An iPhone 17; with more than one screen they take turns (CSS only, so it pauses with its slide). */
function PhoneShot({ shots, first, className, color }: { shots: string[]; first?: boolean; className?: string; color?: IPhoneColor }) {
  return (
    <IPhone17 className={clsx("mi-ph", className)} color={color} data-n={shots.length} style={{ "--n": shots.length } as CSSProperties}>
      {shots.map((p, k) => (
        <Image key={p} src={`/marketing/${p}.jpg`} alt="" fill sizes="40vw" priority={first && k === 0} className={clsx("object-cover object-top", shots.length > 1 && "mi-cyc")} style={{ "--k": k } as CSSProperties} />
      ))}
    </IPhone17>
  );
}

/** The last screen: three phones fanned out, each a different part of the business. */
function FinalArt() {
  return (
    <div className="mi-art mi-fan" aria-hidden>
      <PhoneShot shots={["phones/online-store"]} className="mi-fan-l" color="lavender" />
      <PhoneShot shots={["phones/point-of-sale"]} className="mi-fan-r" color="sage" />
      <PhoneShot shots={["workspace/m-mail"]} className="mi-fan-c" />
    </div>
  );
}
