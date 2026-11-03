"use client";

// Phones don't get the long marketing page: they open on a short, swipeable
// story — too many apps, then one: the store, every inbox and chat, the
// calendar and getting paid, all on Cloudesk — ending on the right sign-up
// for what they came to do. Each screen shows the real app (a browser window
// with a phone in front) in the homepage's light pastel look, after a short
// logo splash on every load. "Explore the website" lets them through to the
// full page for the rest of the visit.
import "./mobile-intro.css";
import clsx from "clsx";
import { ArrowRight, ChevronRight, X, BellRing, CalendarCheck, CreditCard, FileCheck, Gift, Globe, LayoutGrid, Link as LinkIcon, RefreshCw, ScanBarcode, Sparkles, Store, TrendingUp, Video, Zap, type LucideIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { IPhone17, type IPhoneColor } from "@/components/marketing/iphone";
import { ModuleGlyph } from "@/components/shell/module-glyph";
import { MODULE_GROUPS, MODULES, type Tint } from "@/lib/workspace/modules";

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
      { icon: Gift, text: "Free for 30 days", at: { bottom: "6%", left: "2%" }, from: "l" },
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
const LAST = SLIDES.length; // the final "start" screen comes after the story
const FINAL_TONE = "#f08a4b";
const toneAt = (i: number) => SLIDES[i]?.tone ?? FINAL_TONE;

export function MobileIntro({ signedIn }: { signedIn: boolean }) {
  const [at, setAt] = useState(0);
  const [auto, setAuto] = useState(true);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  // The logo splash plays first; nothing on the screens animates until it clears.
  const [splash, setSplash] = useState<"on" | "leaving" | "off">("on");
  const [features, setFeatures] = useState(false);
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
    if (!ready || !auto || dragging || features || aiMode || at >= LAST) return;
    const t = setTimeout(() => go(at + 1, false), AUTO_MS);
    return () => clearTimeout(t);
  }, [ready, auto, dragging, features, aiMode, at, go]);

  // The status bar matches the intro on phones; the page's own colour comes back when it goes.
  useEffect(() => {
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
    const before = metas.map((m) => m.content);
    const mq = window.matchMedia(PHONE);
    const apply = () => {
      const on = mq.matches && !document.documentElement.classList.contains("intro-off");
      metas.forEach((m, i) => (m.content = on ? "#f7f4fb" : before[i]!));
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
      if (!window.matchMedia(PHONE).matches || document.documentElement.classList.contains("intro-off") || features || aiMode) return;
      if (e.key === "ArrowRight") go(at + 1);
      if (e.key === "ArrowLeft") go(at - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [at, go, features, aiMode]);

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
    <div className="mi" data-at={at} style={{ "--tone": toneAt(at) } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Welcome to Cloudesk">
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      {splash !== "off" && <Splash leaving={splash === "leaving"} />}
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
          AI mode
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
          {SLIDES.map((s, i) => (
            <section key={s.id} className="mi-slide" style={{ "--tone": s.tone } as CSSProperties} data-on={(ready && i === at) || undefined} aria-hidden={i !== at} aria-roledescription="slide" aria-label={`${i + 1} of ${LAST + 1}`}>
              <div className="mi-art-wrap">
                <ShotArt screen={s.screen} phones={s.phones} first={i === 0} label={s.id}>
                  <Badges items={s.badges} />
                </ShotArt>
              </div>
              <h2 className="mi-title">{s.title}</h2>
              <p className="mi-sub">{s.sub}</p>
            </section>
          ))}

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
        <button type="button" className="mi-all" onClick={() => setFeatures(true)} tabIndex={last ? -1 : undefined} aria-haspopup="dialog">
          <LayoutGrid className="size-[15px]" aria-hidden />
          All features
        </button>
        <button type="button" className="mi-next" onClick={() => go(at + 1)} tabIndex={last ? -1 : undefined}>
          <span>{at === LAST - 1 ? "Get started" : "Continue"}</span>
          <span className="mi-next-arrow" aria-hidden>
            <ArrowRight className="size-[14px]" strokeWidth={2.25} />
          </span>
        </button>
      </div>
      {aiMode && <PublicAiMode onClose={() => setAiMode(false)} />}
      <FeatureSheet open={features} onClose={() => setFeatures(false)} startHref={signedIn ? "/home" : "/start"} startLabel={signedIn ? "Open my workspace" : "Start free"} />
    </div>
  );
}

// ─── Every feature, in a sheet from below ──────────────────────────────────

/** Each tint as a colour that reads on the light sheet. */
const TINT: Record<Tint, string> = { peach: "#c2562c", lavender: "#5b48b0", mint: "#1f7a55", sky: "#2d6db5", butter: "#9a6b00", rose: "#b03a6b" };
const GROUPS = MODULE_GROUPS.map((g) => ({ ...g, items: MODULES.filter((m) => m.group === g.id) })).filter((g) => g.items.length);

function FeatureSheet({ open, onClose, startHref, startLabel }: { open: boolean; onClose: () => void; startHref: string; startLabel: string }) {
  const list = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const [pull, setPull] = useState(0);
  const [group, setGroup] = useState(GROUPS[0]!.id);

  // Esc closes; each opening starts at the top.
  useEffect(() => {
    if (!open) return;
    list.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // The category strip follows the list as it scrolls.
  const onScroll = () => {
    const el = list.current;
    if (!el) return;
    const top = el.scrollTop + 8;
    let current = GROUPS[0]!.id;
    for (const g of GROUPS) {
      const sec = el.querySelector<HTMLElement>(`[data-group="${g.id}"]`);
      if (sec && sec.offsetTop <= top) current = g.id;
    }
    if (current !== group) setGroup(current);
  };
  const jump = (id: string) => {
    const el = list.current;
    const sec = el?.querySelector<HTMLElement>(`[data-group="${id}"]`);
    if (el && sec) el.scrollTo({ top: sec.offsetTop, behavior: "smooth" });
  };

  // Drag the handle down to dismiss.
  const onDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, t: performance.now() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => drag.current && setPull(Math.max(0, e.clientY - drag.current.y));
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const v = pull / Math.max(1, performance.now() - d.t);
    if (pull > 110 || v > 0.6) onClose();
    setPull(0);
  };

  return (
    <div className="mi-sheet-wrap" data-open={open || undefined} inert={!open}>
      <button type="button" className="mi-sheet-scrim" aria-label="Close" tabIndex={-1} onClick={onClose} />
      <div ref={sheet} className={clsx("mi-sheet", pull > 0 && "is-pulling")} role="dialog" aria-modal="true" aria-label="All features" style={pull ? { transform: `translate3d(0,${pull}px,0)` } : undefined}>
        <div className="mi-sheet-grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <span className="mi-sheet-handle" />
          <div className="mi-sheet-head">
            <div>
              <h2>All features</h2>
              <p>{MODULES.length} apps · switch on what you need</p>
            </div>
            <button type="button" className="mi-sheet-x" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <nav className="mi-sheet-tabs" aria-label="Categories">
          {GROUPS.map((g) => (
            <button key={g.id} type="button" aria-current={group === g.id || undefined} onClick={() => jump(g.id)}>
              {g.label.replace(/ — .*/, "")}
              <span>{g.items.length}</span>
            </button>
          ))}
        </nav>
        <div ref={list} className="mi-sheet-list" onScroll={onScroll}>
          {GROUPS.map((g, gi) => (
            <section key={g.id} data-group={g.id} className="mi-sheet-group" style={{ "--g": gi } as CSSProperties}>
              <h3>{g.label.replace(/ — .*/, "")}</h3>
              <ul>
                {g.items.map((m) => (
                  <li key={m.id} style={{ "--c": TINT[m.tint] } as CSSProperties}>
                    <Link href={`/features/${m.feature}`} tabIndex={open ? undefined : -1}>
                      <span className="mi-sheet-ic">
                        <ModuleGlyph id={m.id} className="size-[17px]" />
                      </span>
                      <span className="mi-sheet-tx">
                        <b>{m.name}</b>
                        {/* One line: the feature's first two highlights. */}
                        <small>{m.adds.slice(0, 2).join(" · ")}</small>
                      </span>
                      <ChevronRight className="mi-sheet-go size-4" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="mi-sheet-foot">
          <Link href={startHref} className="mi-sheet-cta" tabIndex={open ? undefined : -1}>
            {startLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>

        </div>
      </div>
    </div>
  );
}

// ─── The logo splash ────────────────────────────────────────────────────────

/** The Cloudesk mark drawing itself stroke by stroke, the name settling in under it, then everything dissolving into the intro. */
function Splash({ leaving }: { leaving: boolean }) {
  return (
    <div className={clsx("mi-splash", leaving && "is-leaving")} aria-hidden>
      <div className="mi-splash-in">
        <span className="mi-splash-glow" />
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
