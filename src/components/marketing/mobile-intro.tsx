"use client";

// Phones don't get the long marketing page: they open on a short, swipeable
// story — too many apps, then one: the store, every inbox and chat, the
// calendar and getting paid, all on Cloudesk — ending on the right sign-up
// for what they came to do. One ribbon runs through every screen. "Explore the
// website" lets them through to the full page for the rest of the visit.
import "./mobile-intro.css";
import clsx from "clsx";
import { ArrowRight, BadgeCheck, Bell, CalendarDays, CheckCheck, Globe, LayoutGrid, Lock, Mail, MessageCircle, NotebookPen, Package, ReceiptIndianRupee, ShoppingBag, Store, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  { id: "one", tone: "#ff7a59", title: <>Too many apps? Meet <em>one</em>.</>, art: <OneArt /> },
  { id: "store", tone: "#ff6b6b", title: <>One link. Your <em>store</em> is live.</>, art: <StoreArt /> },
  { id: "talk", tone: "#2ec4b6", title: <>One inbox for <em>every chat</em>.</>, art: <TalkArt /> },
  { id: "plan", tone: "#8b7bff", title: <>One calendar, <em>zero chaos</em>.</>, art: <PlanArt /> },
  { id: "paid", tone: "#3ccf91", title: <>One tap, and <em>you&apos;re paid</em>.</>, art: <PaidArt /> },
];
const LAST = SLIDES.length; // the final "start" screen comes after the story
const FINAL_TONE = "#f5a35c";
const toneAt = (i: number) => SLIDES[i]?.tone ?? FINAL_TONE;

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
      metas.forEach((m, i) => (m.content = on ? "#09090b" : before[i]!));
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
  const last = at === LAST;

  return (
    <div className="mi" data-at={at} style={{ "--tone": toneAt(at) } as CSSProperties} role="region" aria-roledescription="carousel" aria-label="Welcome to Cloudesk">
      <script dangerouslySetInnerHTML={{ __html: SKIP_SCRIPT }} />
      <Materials />
      {/* Colour light behind each screen, crossfading as they change. */}
      <div className="mi-bg" aria-hidden>
        {Array.from({ length: LAST + 1 }, (_, i) => (
          <span key={i} style={{ "--g": toneAt(i) } as CSSProperties} data-on={i === at || undefined} />
        ))}
      </div>

      <header className="mi-top">
        <Wordmark className="text-[20px]" />
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
            {i === at && <i className={clsx(auto && !last && !dragging && "is-run")} style={{ animationDuration: `${AUTO_MS}ms` }} />}
          </span>
        ))}
      </div>

      <div ref={stage} className="mi-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <div className={clsx("mi-track", dragging && "is-drag")} style={{ transform: `translate3d(calc(${-at * 100}% + ${drag}px),0,0)` }}>
          <Ribbon screens={LAST + 1} />
          {SLIDES.map((s, i) => (
            <section key={s.id} className="mi-slide" style={{ "--tone": s.tone } as CSSProperties} data-on={i === at || undefined} aria-hidden={i !== at} aria-roledescription="slide" aria-label={`${i + 1} of ${LAST + 1}`}>
              <div className="mi-art-wrap">{s.art}</div>
              <h2 className="mi-title">{s.title}</h2>
            </section>
          ))}

          <section className="mi-slide mi-final" style={{ "--tone": FINAL_TONE } as CSSProperties} data-on={last || undefined} aria-hidden={!last} aria-roledescription="slide" aria-label={`${LAST + 1} of ${LAST + 1}`}>
            <div className="mi-art-wrap">
              <FinalArt />
            </div>
            <h2 className="mi-title">
              One workspace. <em>Every business.</em>
            </h2>
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
        <button type="button" className="mi-next" onClick={() => go(at + 1)} tabIndex={last ? -1 : undefined}>
          {at === LAST - 1 ? "Get started" : "Next"}
          <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

// ─── The ribbon that runs through every screen ──────────────────────────────

/** A twisting band: wide behind each screen's art, turning over between screens. */
function Ribbon({ screens }: { screens: number }) {
  const W = screens * 100;
  const top: string[] = [];
  const bot: string[] = [];
  // It runs out where the last screen begins, so it never crosses the buttons.
  const end = W - 104;
  for (let x = -20; x <= end; x += 2.5) {
    const mid = 80 + 40 * Math.sin((Math.PI * x) / 100 - Math.PI / 2);
    const half = 15 * Math.sin((Math.PI * x) / 100) * Math.min(1, (end - x) / 40);
    top.push(`${x.toFixed(1)},${(mid - half).toFixed(1)}`);
    bot.unshift(`${x.toFixed(1)},${(mid + half).toFixed(1)}`);
  }
  const edge = `M${top.join(" L")}`;
  const tones = [...SLIDES.map((s) => s.tone), FINAL_TONE];
  return (
    <svg className="mi-ribbon" viewBox={`0 0 ${W} 200`} preserveAspectRatio="none" style={{ width: `${screens * 100}%` }} aria-hidden>
      <defs>
        <linearGradient id="mi-rib" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
          {tones.map((t, i) => (
            <Fragment key={i}>
              <stop offset={(i * 100 + 20) / W} stopColor={t} />
              <stop offset={(i * 100 + 80) / W} stopColor={t} stopOpacity={0.85} />
            </Fragment>
          ))}
        </linearGradient>
        <linearGradient id="mi-rib-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      <path d={`${edge} L${bot.join(" L")} Z`} fill="url(#mi-rib)" opacity="0.92" />
      <path d={`${edge} L${bot.join(" L")} Z`} fill="url(#mi-rib-shade)" />
      <path d={edge} fill="none" stroke="#fff" strokeOpacity="0.45" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ─── Isometric drawing ──────────────────────────────────────────────────────
// Scenes are drawn in isometric 3D: x runs down-right, y down-left, z up.
// A Box is a lit block (top, front-left and front-right faces); anything can
// be drawn flat onto a face through that face's transform.

const C = 0.866;
const S = 0.5;
type V3 = [number, number, number];
const pt = ([x, y, z]: V3) => `${((x - y) * C).toFixed(1)},${((x + y) * S - z).toFixed(1)}`;
const pts = (a: V3[]) => a.map(pt).join(" ");
const faceTop = (x: number, y: number, z: number) => `matrix(${C} ${S} ${-C} ${S} ${((x - y) * C).toFixed(2)} ${((x + y) * S - z).toFixed(2)})`;

/** Glossy materials: [top, front-left, front-right] gradients. */
const MATS: Record<string, [string, string][]> = {
  coral: [["#ffc2ad", "#ff6a5f"], ["#ff6d55", "#c62a40"], ["#a3243c", "#561022"]],
  amber: [["#ffe7a8", "#f7a845"], ["#f5a040", "#b45f17"], ["#9a4c13", "#552808"]],
  teal: [["#b3fff6", "#2ec4b6"], ["#2bb5a8", "#0e6f68"], ["#0c5a55", "#052f2d"]],
  violet: [["#ddd6ff", "#8b7bff"], ["#7d6bf2", "#4335ad"], ["#382a90", "#1c1452"]],
  mint: [["#c6ffe3", "#3ccf91"], ["#33bb83", "#147c53"], ["#0f6645", "#073725"]],
  sky: [["#c9ecff", "#4fb3ff"], ["#3fa2f0", "#1b5fae"], ["#174f91", "#0a2850"]],
  ink: [["#34343d", "#1d1d23"], ["#202027", "#121216"], ["#17171c", "#0a0a0d"]],
  paper: [["#ffffff", "#ecebe5"], ["#e2e0d8", "#bdbab0"], ["#b3b0a6", "#8a877d"]],
  gold: [["#fff1b8", "#f6c34a"], ["#f0b53c", "#a66d0f"], ["#94600d", "#4f3305"]],
};

/** The gradients every scene paints with, defined once. */
function Materials() {
  return (
    <svg className="mi-defs" aria-hidden>
      <defs>
        {Object.entries(MATS).map(([k, [t, l, r]]) => (
          <Fragment key={k}>
            <linearGradient id={`m-${k}-t`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={t[0]} />
              <stop offset="1" stopColor={t[1]} />
            </linearGradient>
            <linearGradient id={`m-${k}-l`} x1="0" y1="0" x2="0.3" y2="1">
              <stop offset="0" stopColor={l[0]} />
              <stop offset="1" stopColor={l[1]} />
            </linearGradient>
            <linearGradient id={`m-${k}-r`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={r[0]} />
              <stop offset="1" stopColor={r[1]} />
            </linearGradient>
          </Fragment>
        ))}
        <filter id="m-soft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
    </svg>
  );
}

type BoxProps = { x?: number; y?: number; z?: number; w: number; d: number; h: number; m: keyof typeof MATS; top?: ReactNode; left?: ReactNode; className?: string; style?: CSSProperties };

function Box({ x = 0, y = 0, z = 0, w, d, h, m, top, left, className, style }: BoxProps) {
  const T: V3[] = [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]];
  const L: V3[] = [[x, y + d, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x, y + d, z]];
  const R: V3[] = [[x + w, y, z + h], [x + w, y + d, z + h], [x + w, y + d, z], [x + w, y, z]];
  return (
    <g className={className} style={style}>
      <polygon points={pts(L)} fill={`url(#m-${m}-l)`} />
      <polygon points={pts(R)} fill={`url(#m-${m}-r)`} />
      <polygon points={pts(T)} fill={`url(#m-${m}-t)`} />
      {left && <g transform={`matrix(${C} ${S} 0 1 ${((x - y - d) * C).toFixed(2)} ${((x + y + d) * S - z - h).toFixed(2)})`}>{left}</g>}
      {top && <g transform={faceTop(x, y, z + h)}>{top}</g>}
      {/* Light catching the front edges. */}
      <polyline points={pts([T[3]!, T[2]!, T[1]!])} fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="0.7" strokeLinejoin="round" />
      <polyline points={pts([T[2]!, [x + w, y + d, z]])} fill="none" stroke="#fff" strokeOpacity="0.25" strokeWidth="0.6" />
    </g>
  );
}

/** A soft shadow under a footprint. */
function Shadow({ x, y, w, d, o = 0.55 }: { x: number; y: number; w: number; d: number; o?: number }) {
  return <polygon points={pts([[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]])} fill="#000" opacity={o} filter="url(#m-soft)" />;
}

/** A coin (or any disc) lying flat, radius r, height h. */
function Disc({ x, y, z, r, h, m, children }: { x: number; y: number; z: number; r: number; h: number; m: keyof typeof MATS; children?: ReactNode }) {
  const cx = (x - y) * C;
  const cy = (x + y) * S - z;
  const rx = r * 1.2247;
  const ry = r * 0.7071;
  return (
    <g>
      <path d={`M${cx - rx} ${cy} v${-h} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy - h} v${h} A${rx} ${ry} 0 0 1 ${cx - rx} ${cy} Z`} fill={`url(#m-${m}-l)`} />
      <ellipse cx={cx} cy={cy - h} rx={rx} ry={ry} fill={`url(#m-${m}-t)`} stroke="#fff" strokeOpacity="0.5" strokeWidth="0.6" />
      {children && <g transform={faceTop(x, y, z + h)}>{children}</g>}
    </g>
  );
}

/** A lucide icon drawn flat on a face, centred at (u, v). */
const Glyph = ({ icon: Icon, u, v, s, c = "#fff" }: { icon: LucideIcon; u: number; v: number; s: number; c?: string }) => <Icon x={u - s / 2} y={v - s / 2} width={s} height={s} color={c} strokeWidth={2.2} />;

/** The Cloudesk mark (as in components/brand) at height s, centred on (u, v). */
function CloudMark({ u, v, s }: { u: number; v: number; s: number }) {
  const k = s / 459;
  return (
    <g transform={`translate(${u - 146 * k} ${v - s / 2}) scale(${k}) translate(-14 -9)`} fill="none" strokeWidth="30">
      <path d="M28 387V90A67 67 0 0 1 95 23" stroke="#FF5A5F" />
      <path d="M95 23A67 67 0 0 1 161 102A100 100 0 0 1 238 282" stroke="#FDBA5A" />
      <path d="M238 282A72 72 0 0 1 162 398A67 67 0 0 1 28 387" stroke="#fff" strokeOpacity=".85" />
    </g>
  );
}

/** Small glowing shapes drifting around a scene, like dust in the light. */
function Sparks({ items }: { items: [number, number, number, string][] }) {
  return (
    <g>
      {items.map(([x, y, s, c], i) => (
        <g key={i} className="mi-spark" style={{ "--i": i } as CSSProperties}>
          <polygon points={`${x},${y - s} ${x + s * 0.7},${y} ${x},${y + s} ${x - s * 0.7},${y}`} fill={c} opacity="0.95" />
        </g>
      ))}
    </g>
  );
}

const Scene = ({ children, extra }: { children: ReactNode; extra?: ReactNode }) => (
  <div className="mi-art">
    <svg viewBox="-128 -128 256 256" className="mi-svg" aria-hidden>
      <g className="mi-float">{children}</g>
    </svg>
    {extra}
  </div>
);

// ─── Brand marks (for "works with") ─────────────────────────────────────────

const GmailMark = () => (
  <svg viewBox="0 0 24 24" aria-label="Gmail">
    <path fill="#4285F4" d="M2.5 19.5h3.6V10.6L1 6.9v11.1c0 .8.7 1.5 1.5 1.5z" />
    <path fill="#34A853" d="M17.9 19.5h3.6c.8 0 1.5-.7 1.5-1.5V6.9l-5.1 3.7z" />
    <path fill="#FBBC04" d="M17.9 4.4v6.2L23 6.9V5c0-1.9-2.1-2.9-3.6-1.8z" />
    <path fill="#EA4335" d="M6.1 10.6V4.4L12 8.8l5.9-4.4v6.2L12 15z" />
    <path fill="#C5221F" d="M1 5v1.9l5.1 3.7V4.4L4.6 3.2C3.1 2.1 1 3.1 1 5z" />
  </svg>
);
const OutlookMark = () => (
  <svg viewBox="0 0 24 24" aria-label="Outlook">
    <rect x="9" y="4" width="13" height="16" rx="2" fill="#28a8ea" />
    <path d="M9 9h13v9a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2z" fill="#0078d4" />
    <rect x="2" y="6" width="12" height="12" rx="2" fill="#0a5cb8" />
    <ellipse cx="8" cy="12" rx="3" ry="3.4" fill="none" stroke="#fff" strokeWidth="1.8" />
  </svg>
);
const WhatsAppMark = () => (
  <svg viewBox="0 0 24 24" aria-label="WhatsApp">
    <path fill="#25D366" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z" />
    <path fill="#fff" d="M9.3 7.2c-.2-.5-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4l-.6-.3-2-1c-.3-.1-.5-.1-.7.1l-.9 1.1c-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6.3-.5v-.5z" />
  </svg>
);
const UpiMark = () => (
  <svg viewBox="0 0 44 18" aria-label="UPI">
    <text x="0" y="14.5" fontSize="15" fontWeight="800" fontStyle="italic" fill="#fff" letterSpacing="-0.5" fontFamily="Arial, sans-serif">
      UPI
    </text>
    <path d="M33 2l6 7-6 7z" fill="#f37021" />
    <path d="M37.5 2l6 7-6 7z" fill="#00a651" />
  </svg>
);

/** A logo on a small glass tile floating over a scene. */
function LogoTile({ children, x, y, i }: { children: ReactNode; x: number; y: number; i: number }) {
  return (
    <span className="mi-logo" style={{ left: `${x}%`, top: `${y}%`, "--i": i } as CSSProperties}>
      {children}
    </span>
  );
}

// ─── Scenes ─────────────────────────────────────────────────────────────────

/** Nine scattered apps fly in and dock on one block: Cloudesk. */
function OneArt() {
  const apps: { icon: LucideIcon; m: keyof typeof MATS; fx: number; fy: number; fr: number }[] = [
    { icon: Store, m: "coral", fx: -120, fy: -150, fr: -40 },
    { icon: Mail, m: "teal", fx: -20, fy: -190, fr: 30 },
    { icon: MessageCircle, m: "sky", fx: 110, fy: -160, fr: 50 },
    { icon: CalendarDays, m: "violet", fx: -150, fy: -60, fr: -60 },
    { icon: ReceiptIndianRupee, m: "mint", fx: 0, fy: -120, fr: 20 },
    { icon: Users, m: "amber", fx: 150, fy: -70, fr: 40 },
    { icon: NotebookPen, m: "gold", fx: -130, fy: 40, fr: -30 },
    { icon: Package, m: "coral", fx: 40, fy: -210, fr: -20 },
    { icon: ShoppingBag, m: "teal", fx: 140, fy: 30, fr: 60 },
  ];
  const tiles = apps.map((a, k) => ({ ...a, i: k % 3, j: Math.floor(k / 3) }));
  // Back to front, so nearer tiles draw over farther ones.
  const order = [...tiles].sort((p, q) => p.i + p.j - (q.i + q.j));
  return (
    <Scene>
      <Shadow x={-46} y={-40} w={96} d={96} />
      <Box className="mi-b-rise" x={-40} y={-40} z={-30} w={80} d={80} h={62} m="ink" left={<CloudMark u={40} v={31} s={36} />} />
      {order.map((t) => (
        <Box key={t.i + t.j * 3} className="mi-b-dock" style={{ "--fx": `${t.fx}px`, "--fy": `${t.fy}px`, "--fr": `${t.fr}deg`, "--k": t.i + t.j * 3 } as CSSProperties} x={-35 + t.i * 25} y={-35 + t.j * 25} z={32} w={20} d={20} h={5} m={t.m} top={<Glyph icon={t.icon} u={10} v={10} s={11} />} />
      ))}
      <Sparks items={[[-110, -70, 5, "#ff7a59"], [105, -95, 4, "#2ec4b6"], [112, 40, 3.5, "#8b7bff"], [-100, 60, 3, "#f6c34a"]]} />
    </Scene>
  );
}

/** A little shop with its sign on, orders stacking up beside it. */
function StoreArt() {
  const stripes = Array.from({ length: 7 }, (_, k) => <rect key={k} x={k * 10} y={0} width={5} height={6} fill="#fff" opacity="0.85" />);
  return (
    <Scene
      extra={
        <>
          <span className="mi-chip mi-chip-url" style={{ left: "4%", top: "10%" }}>
            <i className="mi-dot-live" />
            <Lock className="size-[1em] opacity-70" aria-hidden /> yourshop.in
          </span>
          <span className="mi-chip" style={{ right: "0%", bottom: "12%" }}>
            <span className="mi-chip-ic">
              <ShoppingBag className="size-[1.1em]" aria-hidden />
            </span>
            <span>
              <b>New order</b>
              <small>₹1,299 · just now</small>
            </span>
          </span>
        </>
      }
    >
      <Shadow x={-44} y={-30} w={110} d={70} />
      <Box className="mi-b-rise" x={-40} y={-26} z={-25} w={70} d={46} h={52} m="coral" left={<ShopFront />} />
      <Box className="mi-b-drop" style={{ "--k": 1 } as CSSProperties} x={-40} y={20} z={18} w={70} d={9} h={4} m="amber" left={<g>{stripes}</g>} />
      <Box className="mi-b-drop" style={{ "--k": 2 } as CSSProperties} x={-26} y={-6} z={27} w={42} d={7} h={13} m="ink" left={<text x="21" y="9.5" textAnchor="middle" fontSize="7.5" fontWeight="700" letterSpacing="1.5" fill="#ffd28a">OPEN</text>} />
      <Box className="mi-b-drop" style={{ "--k": 3 } as CSSProperties} x={40} y={-12} z={-25} w={24} d={24} h={18} m="amber" top={<rect x="10" y="0" width="4" height="24" fill="#fff" opacity="0.5" />} />
      <Box className="mi-b-drop" style={{ "--k": 4 } as CSSProperties} x={43} y={-9} z={-7} w={18} d={18} h={13} m="gold" top={<rect x="7" y="0" width="4" height="18" fill="#fff" opacity="0.5" />} />
      <Box className="mi-b-drop" style={{ "--k": 5 } as CSSProperties} x={46} y={22} z={-25} w={16} d={16} h={14} m="mint" top={<Glyph icon={ShoppingBag} u={8} v={8} s={10} />} />
      <Sparks items={[[-112, -40, 4, "#ff6b6b"], [96, -96, 3.5, "#f6c34a"], [-90, 78, 3, "#ffb59e"]]} />
    </Scene>
  );
}

function ShopFront() {
  return (
    <g>
      <rect x="6" y="16" width="18" height="16" rx="1.5" fill="#ffe9d6" opacity="0.92" />
      <rect x="46" y="16" width="18" height="16" rx="1.5" fill="#ffe9d6" opacity="0.92" />
      <rect x="29" y="20" width="12" height="32" rx="1.5" fill="#3a0d17" />
      <circle cx="38" cy="37" r="0.9" fill="#ffd28a" />
      <rect x="9" y="25" width="5" height="5" rx="1" fill="#ff8a7a" />
      <rect x="16" y="22" width="5" height="8" rx="1" fill="#8b7bff" opacity="0.8" />
      <rect x="49" y="24" width="12" height="6" rx="1" fill="#3ccf91" opacity="0.85" />
    </g>
  );
}

/** Messages from every app landing in one stack. */
function TalkArt() {
  const layers: { z: number; m: keyof typeof MATS }[] = [
    { z: -30, m: "ink" },
    { z: -14, m: "sky" },
    { z: 2, m: "teal" },
  ];
  return (
    <Scene
      extra={
        <>
          <LogoTile x={10} y={18} i={0}>
            <GmailMark />
          </LogoTile>
          <LogoTile x={84} y={14} i={1}>
            <OutlookMark />
          </LogoTile>
          <LogoTile x={88} y={60} i={2}>
            <WhatsAppMark />
          </LogoTile>
          <span className="mi-chip" style={{ left: "0%", bottom: "10%" }}>
            <span className="mi-av">P</span>
            <span>
              <b>Priya</b>
              <small>
                New stock just arrived <CheckCheck className="inline size-[1.1em] text-[#4fb3ff]" aria-hidden />
              </small>
            </span>
          </span>
        </>
      }
    >
      <Shadow x={-46} y={-34} w={92} d={72} />
      {layers.map((l, k) => (
        <Box key={k} className="mi-b-drop" style={{ "--k": k } as CSSProperties} x={-42 + k * 3} y={-32 - k * 3} z={l.z} w={80} d={62} h={6} m={l.m} />
      ))}
      <Box className="mi-b-drop" style={{ "--k": 3 } as CSSProperties} x={-33} y={-41} z={18} w={80} d={62} h={7} m="paper" top={<InboxFace />} />
      <Sparks items={[[-115, -20, 4, "#2ec4b6"], [100, -105, 3.5, "#4fb3ff"], [110, 70, 3, "#3ccf91"]]} />
    </Scene>
  );
}

function InboxFace() {
  return (
    <g>
      <rect x="6" y="6" width="68" height="10" rx="2.5" fill="#2ec4b6" opacity="0.18" />
      <Glyph icon={Mail} u={12} v={11} s={7} c="#0e6f68" />
      <rect x="19" y="9.5" width="30" height="3" rx="1.5" fill="#0e6f68" opacity="0.7" />
      {[22, 34, 46].map((v, k) => (
        <g key={k}>
          <circle cx="11" cy={v + 3} r="3.2" fill={["#ff8a7a", "#8b7bff", "#3ccf91"][k]} />
          <rect x="18" y={v} width={[44, 36, 40][k]} height="2.6" rx="1.3" fill="#1d1d23" opacity="0.55" />
          <rect x="18" y={v + 4} width={[30, 40, 24][k]} height="2.2" rx="1.1" fill="#1d1d23" opacity="0.25" />
        </g>
      ))}
    </g>
  );
}

/** A calendar block with today picked out, a sticky checklist on top. */
function PlanArt() {
  const cells: ReactNode[] = [];
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 6; c++) {
      const today = r === 1 && c === 3;
      cells.push(<rect key={`${r}-${c}`} x={6 + c * 11.5} y={22 + r * 13} width={9} height={10} rx={2} fill={today ? "#ff6b6b" : "#fff"} opacity={today ? 1 : 0.22} />);
    }
  const note = (
    <g>
      {[8, 17, 26].map((v, k) => (
        <g key={k}>
          <rect x="5" y={v - 3} width="6" height="6" rx="1.5" fill={k < 2 ? "#7a4b05" : "none"} stroke="#7a4b05" strokeWidth="1" />
          {k < 2 && <path d={`M6.3 ${v} l1.5 1.5 l2.8 -3`} fill="none" stroke="#ffe7a8" strokeWidth="1.1" strokeLinecap="round" />}
          <rect x="14" y={v - 1.2} width={[18, 14, 16][k]} height="2.4" rx="1.2" fill="#7a4b05" opacity={k < 2 ? 0.4 : 0.8} />
        </g>
      ))}
    </g>
  );
  return (
    <Scene
      extra={
        <span className="mi-chip" style={{ right: "0%", bottom: "12%" }}>
          <span className="mi-chip-ic">
            <Bell className="size-[1.1em]" aria-hidden />
          </span>
          <span>
            <b>Client demo · 11:30</b>
            <small>In 10 minutes</small>
          </span>
        </span>
      }
    >
      <Shadow x={-46} y={-44} w={96} d={92} />
      <Box
        className="mi-b-rise"
        x={-42}
        y={-42}
        z={-30}
        w={84}
        d={84}
        h={18}
        m="violet"
        top={
          <g>
            <rect x="6" y="6" width="72" height="11" rx="3" fill="#fff" opacity="0.28" />
            <rect x="10" y="10" width="22" height="3" rx="1.5" fill="#fff" />
            {cells}
          </g>
        }
        left={<rect x="4" y="6" width="76" height="2" rx="1" fill="#fff" opacity="0.25" />}
      />
      <Box className="mi-b-drop" style={{ "--k": 1 } as CSSProperties} x={-30} y={-46} z={-12} w={7} d={8} h={9} m="ink" />
      <Box className="mi-b-drop" style={{ "--k": 1 } as CSSProperties} x={22} y={-46} z={-12} w={7} d={8} h={9} m="ink" />
      <Box className="mi-b-note" x={8} y={6} z={-12} w={38} d={38} h={3} m="gold" top={note} />
      <Sparks items={[[-112, -60, 4, "#8b7bff"], [110, -80, 3.5, "#ff6b6b"], [-96, 80, 3, "#f6c34a"]]} />
    </Scene>
  );
}

/** Takings rising, an invoice stamped paid and the coins to prove it. */
function PaidArt() {
  const bars = [18, 30, 44, 62];
  return (
    <Scene
      extra={
        <span className="mi-chip" style={{ left: "0%", top: "8%" }}>
          <span className="mi-upi">
            <UpiMark />
          </span>
          <span>
            <b>₹24,500 received</b>
            <small>Invoice #1042 · paid</small>
          </span>
          <BadgeCheck className="size-[1.25em] text-[#3ccf91]" aria-hidden />
        </span>
      }
    >
      <Shadow x={-60} y={-46} w={124} d={104} o={0.45} />
      {bars.map((h, k) => (
        <Box key={k} className="mi-b-grow" style={{ "--k": k } as CSSProperties} x={-10 + k * 18} y={-44} z={-30} w={13} d={13} h={h} m="mint" />
      ))}
      <Box className="mi-b-drop" style={{ "--k": 2 } as CSSProperties} x={-58} y={-8} z={-30} w={56} d={66} h={3} m="paper" top={<InvoiceFace />} />
      {[0, 1, 2].map((k) => (
        <g key={k} className="mi-b-coin" style={{ "--k": k } as CSSProperties}>
          <Disc x={34} y={36} z={-30 + k * 6} r={13} h={5} m="gold">
            {k === 2 && (
              <text x="0" y="3.5" textAnchor="middle" fontSize="11" fontWeight="800" fill="#8a5a0a">
                ₹
              </text>
            )}
          </Disc>
        </g>
      ))}
      <Sparks items={[[-110, -90, 4, "#3ccf91"], [112, -40, 3.5, "#f6c34a"], [-100, 80, 3, "#2ec4b6"]]} />
    </Scene>
  );
}

function InvoiceFace() {
  return (
    <g>
      <rect x="6" y="6" width="9" height="9" rx="2" fill="#111" />
      <rect x="19" y="7" width="24" height="3" rx="1.5" fill="#111" opacity="0.8" />
      <rect x="19" y="12" width="14" height="2" rx="1" fill="#111" opacity="0.35" />
      {[24, 31, 38].map((v, k) => (
        <rect key={k} x="6" y={v} width={[42, 32, 38][k]} height="2.4" rx="1.2" fill="#111" opacity="0.14" />
      ))}
      <line x1="6" x2="50" y1="48" y2="48" stroke="#111" strokeOpacity="0.2" strokeDasharray="2 2" />
      <rect x="32" y="52" width="18" height="4" rx="2" fill="#111" opacity="0.85" />
      <g transform="rotate(-14 28 30)">
        <g className="mi-stamp">
          <rect x="12" y="24" width="32" height="12" rx="2.5" fill="#16a34a" fillOpacity="0.08" stroke="#16a34a" strokeWidth="1.6" />
          <text x="28" y="33.2" textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing="1.4" fill="#16a34a">
            PAID
          </text>
        </g>
      </g>
    </g>
  );
}

/** The Cloudesk block lit up, with what it holds hovering around it. */
function FinalArt() {
  return (
    <Scene>
      <Shadow x={-38} y={-32} w={80} d={80} />
      <circle className="mi-halo-ring" cx="0" cy="-10" r="70" fill="none" stroke={FINAL_TONE} strokeOpacity="0.35" />
      <circle className="mi-halo-ring mi-halo-ring-2" cx="0" cy="-10" r="70" fill="none" stroke={FINAL_TONE} strokeOpacity="0.35" />
      <Box className="mi-b-rise" x={-34} y={-34} z={-30} w={68} d={68} h={56} m="ink" left={<CloudMark u={34} v={28} s={32} />} />
      <Box className="mi-b-hover" style={{ "--k": 0 } as CSSProperties} x={-100} y={-30} z={30} w={22} d={22} h={5} m="coral" top={<Glyph icon={Store} u={11} v={11} s={12} />} />
      <Box className="mi-b-hover" style={{ "--k": 1 } as CSSProperties} x={-20} y={-108} z={36} w={22} d={22} h={5} m="teal" top={<Glyph icon={Mail} u={11} v={11} s={12} />} />
      <Box className="mi-b-hover" style={{ "--k": 2 } as CSSProperties} x={70} y={-50} z={10} w={22} d={22} h={5} m="mint" top={<Glyph icon={ReceiptIndianRupee} u={11} v={11} s={12} />} />
      <Box className="mi-b-hover" style={{ "--k": 3 } as CSSProperties} x={-40} y={60} z={-10} w={22} d={22} h={5} m="violet" top={<Glyph icon={CalendarDays} u={11} v={11} s={12} />} />
    </Scene>
  );
}
