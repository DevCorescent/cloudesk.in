// "All your mail. Every action. One place." — the upbeat Mail film. Night glass:
// a deep indigo night lit by soft brand-coloured light, frosted glass panels with
// hairline edges, crisp white lines, fast motion on the beat and deliberate stops.
// Every piece of interface is cut from real captures of Mail (video/public/mail/).
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { AlarmClock, Archive, BellRing, CalendarClock, Forward, ListTodo, Mail, MessageSquareReply, Reply, Sparkles, Star, Tag, Users } from "lucide-react";
import { Emblem, FONT, c01, kf, seg, smooth, soft } from "./film";
import { BPM } from "./up-plan.js";

type Icon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
const src = (n: string) => staticFile(`mail/${n}.jpg`);
const INK = "#f7f7fb";
const DIM = "rgba(235,236,250,0.62)";
const GRAD = "linear-gradient(100deg, #ff6a6f 0%, #ff8a5c 40%, #fdba5a 100%)";
const BEAT = 60 / BPM;

/* ───────── materials ───────── */

const glass = (k = 1): React.CSSProperties => ({
  background: `linear-gradient(135deg, rgba(255,255,255,${0.16 * k}), rgba(255,255,255,${0.05 * k}))`,
  backdropFilter: "blur(26px) saturate(170%)",
  WebkitBackdropFilter: "blur(26px) saturate(170%)",
  boxShadow: `inset 0 1px 0 rgba(255,255,255,${0.4 * k}), inset 0 0 0 1px rgba(255,255,255,${0.18 * k}), 0 40px 90px -30px rgba(0,0,0,0.75)`,
});

/** The night: indigo depth, slow brand-coloured light, a hairline grid. */
function Night({ t, pulse }: { t: number; pulse: number }) {
  const blobs: [string, number, number, number][] = [["124,92,255", 18, 22, 0.55], ["255,90,95", 84, 30, 0.45], ["56,189,248", 30, 90, 0.38], ["253,186,90", 78, 86, 0.28]];
  return (
    <AbsoluteFill style={{ background: "radial-gradient(120% 90% at 50% 40%, #12123a 0%, #08081c 55%, #04040d 100%)", overflow: "hidden" }}>
      {blobs.map(([rgb, x, y, a], i) => (
        <div key={i} style={{ position: "absolute", left: `${x + Math.sin(t * 0.25 + i * 1.9) * 7 - 32}%`, top: `${y + Math.cos(t * 0.22 + i) * 6 - 32}%`, width: "64%", height: "64%", borderRadius: "50%", background: `radial-gradient(closest-side, rgba(${rgb},${a * (0.85 + pulse * 0.3)}), transparent)`, filter: "blur(30px)" }} />
      ))}
      <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "96px 96px", backgroundPosition: "48px 12px", maskImage: "radial-gradient(75% 70% at 50% 50%, #000 30%, transparent 85%)", WebkitMaskImage: "radial-gradient(75% 70% at 50% 50%, #000 30%, transparent 85%)", opacity: seg(t, 0.1, 1.2) }} />
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "3px 3px" }} />
    </AbsoluteFill>
  );
}

/** A real piece of a captured screen (fractions of the 16:10 frame), at width w. */
function Crop({ name, r, w, radius = 14 }: { name: string; r: { x: number; y: number; w: number; h: number }; w: number; radius?: number }) {
  const iw = w / r.w;
  const h = (w * r.h * 10) / (r.w * 16);
  return (
    <div style={{ width: w, height: h, borderRadius: radius, overflow: "hidden", position: "relative", background: "#fff" }}>
      <Img src={src(name)} style={{ position: "absolute", width: iw, left: -r.x * iw, top: -r.y * iw * 0.625 }} />
    </div>
  );
}
/** The crop in a frosted glass frame. */
const Framed = ({ children, pad = 8, radius = 22 }: { children: React.ReactNode; pad?: number; radius?: number }) => <div style={{ padding: pad, borderRadius: radius, ...glass() }}>{children}</div>;

/** A glass pill with an icon. */
function Pill({ I, label, size = 26, hot = 0 }: { I?: Icon; label: string; size?: number; hot?: number }) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.45, padding: `${size * 0.42}px ${size * 0.85}px ${size * 0.42}px ${I ? size * 0.42 : size * 0.85}px`, borderRadius: 999, ...glass(), boxShadow: `${glass().boxShadow}, 0 0 ${hot * 40}px rgba(255,120,110,${0.5 * hot})`, fontFamily: FONT, fontSize: size, fontWeight: 600, letterSpacing: "-0.015em", color: INK, whiteSpace: "nowrap" }}>
      {I && <span style={{ width: size * 1.5, height: size * 1.5, borderRadius: 99, display: "grid", placeItems: "center", background: "rgba(255,255,255,0.14)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }}><I size={size * 0.8} color={INK} strokeWidth={2} /></span>}
      {label}
    </div>
  );
}

/** A headline that rises out of a mask; a second line can carry the brand gradient. */
function Head({ t, a, b, l1, l2, y = 118, size = 92 }: { t: number; a: number; b: number; l1: string; l2?: string; y?: number; size?: number }) {
  const o = seg(t, b - 0.3, b, soft);
  if (t < a || o >= 1) return null;
  const line = (txt: string, d: number, g: boolean) => {
    const p = seg(t, a + d, a + d + 0.45, smooth);
    return (
      <div style={{ overflow: "hidden", paddingBottom: size * 0.1 }}>
        <div style={{ transform: `translateY(${(1 - p) * 105}%)`, fontSize: size, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.02, ...(g ? { backgroundImage: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : { color: INK }) }}>{txt}</div>
      </div>
    );
  };
  return (
    <div style={{ position: "absolute", left: 160, right: 160, top: y, textAlign: "center", fontFamily: FONT, opacity: 1 - o, filter: `blur(${o * 8}px)` }}>
      {line(l1, 0, false)}
      {l2 && line(l2, 0.22, true)}
    </div>
  );
}

/** A hairline that draws from a to b. */
const Hair = ({ x1, y1, x2, y2, p, o = 0.55 }: { x1: number; y1: number; x2: number; y2: number; p: number; o?: number }) => <line x1={x1} y1={y1} x2={x1 + (x2 - x1) * p} y2={y1 + (y2 - y1) * p} stroke={`rgba(255,255,255,${o})`} strokeWidth={1.5} />;

/* ───────── content ───────── */

const ROWY = [[145, 212], [213, 299], [300, 367], [368, 454], [455, 522], [523, 610], [611, 678], [679, 745]];
const rowR = (k: number) => ({ x: 0.3275, y: ROWY[k]![0] / 750, w: 0.2625, h: (ROWY[k]![1] - ROWY[k]![0]) / 750 });
const SCATTER = [[-620, -300, -8], [580, -320, 7], [-700, 30, 5], [650, 0, -6], [-560, 310, -4], [600, 300, 5], [-60, -380, 3], [40, 380, -3]];
const PROVIDERS = ["Gmail", "Microsoft 365 / Outlook", "Zoho Mail", "Yahoo Mail", "iCloud Mail", "Any IMAP server"];
const RING = ["Gmail", "Google Workspace", "Outlook", "Zoho Mail", "Yahoo Mail", "iCloud Mail", "Titan Mail", "Hostinger", "GoDaddy", "IMAP / SMTP"];
const ACTIONS: [Icon, string][] = [[Reply, "Reply"], [Forward, "Forward"], [Archive, "Archive"], [AlarmClock, "Snooze"], [Star, "Star"], [Tag, "Label"], [CalendarClock, "Schedule send"], [BellRing, "Remind me"], [Sparkles, "Summarise"], [MessageSquareReply, "Suggest a reply"], [ListTodo, "To-dos & dates"], [Users, "Open in CRM"]];
const PROOF: { l1: string; l2: string; name: string; r: { x: number; y: number; w: number; h: number }; w: number }[] = [
  { l1: "Archive. Snooze.", l2: "Star. Label.", name: "thread", r: { x: 0.598, y: 0.052, w: 0.16, h: 0.05 }, w: 560 },
  { l1: "Summarise.", l2: "Suggest a reply.", name: "thread", r: { x: 0.603, y: 0.322, w: 0.28, h: 0.05 }, w: 860 },
  { l1: "To CRM.", l2: "To a ticket.", name: "thread", r: { x: 0.613, y: 0.266, w: 0.36, h: 0.045 }, w: 920 },
  { l1: "Schedule it.", l2: "Get reminded.", name: "reply", r: { x: 0.612, y: 0.88, w: 0.165, h: 0.05 }, w: 600 },
  { l1: "Invites, straight", l2: "to your calendar.", name: "meeting", r: { x: 0.608, y: 0.33, w: 0.375, h: 0.205 }, w: 860 },
  { l1: "Fakes,", l2: "flagged.", name: "phishing", r: { x: 0.608, y: 0.33, w: 0.375, h: 0.152 }, w: 860 },
];
// Where each action lives on the real thread screen (fractions), for the payoff.
const LAND: [number, number, number][] = [[2, 0.608, 0.077], [3, 0.649, 0.077], [4, 0.676, 0.077], [5, 0.697, 0.077], [11, 0.664, 0.288], [8, 0.665, 0.348], [9, 0.742, 0.348], [0, 0.638, 0.824], [1, 0.711, 0.824]];

/* ───────── the film ───────── */

export const MailUp: React.FC = () => {
  const t = useCurrentFrame() / 30;
  const beatPhase = (t % BEAT) / BEAT;
  const drive = (t >= 6 && t < 10) || (t >= 12 && t < 32) || (t >= 34 && t < 40);
  const pulse = drive ? Math.exp(-beatPhase * 5) : 0;
  const bump = 1 + pulse * 0.006;

  /* A — the hook: inboxes everywhere */
  const freeze = t >= 5.5 && t < 6.0;
  const tf = freeze ? 5.5 : t;
  const providerK = Math.floor((t - 2) / BEAT);
  const provider = t >= 2 && t < 5 ? PROVIDERS[providerK] : undefined;
  const provPop = interpolate((t - 2) % BEAT, [0, 0.12], [1.25, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  /* B — converge */
  const stream = (k: number) => seg(t, 6.4 + k * 0.25, 7.3 + k * 0.25, smooth);
  const ringIn = (k: number) => seg(t, 6.0 + k * 0.06, 6.5 + k * 0.06, smooth);
  const hub = seg(t, 6.0, 6.6, smooth);
  const hubFlash = Math.exp(-Math.max(0, t - 9) * 4) * (t >= 9 ? 1 : 0);

  /* C — the unified inbox */
  const win = seg(t, 12.0, 13.0, smooth);
  const lift = seg(t, 16.4, 17.6, smooth); // the first row lifts out to become the hero card
  const W = 1040, H = W * 0.625, WX = 960 - W / 2, WY = 290;
  const onWin = (px: number, py: number) => ({ x: WX + px * W, y: WY + py * H });

  /* D — every action */
  const chip = (k: number) => seg(t, 20 + k * 0.5, 20.35 + k * 0.5, smooth);
  const chipsOut = seg(t, 25.6, 26.0, soft);
  const proofK = Math.floor(t - 26);
  const proof = t >= 26 && t < 32 ? PROOF[proofK] : undefined;
  const pIn = seg(t - proofK, 26, 26.28, smooth), pOut = seg(t - proofK, 26.82, 27.0, smooth);

  /* E — the payoff */
  const thr = seg(t, 34.0, 35.0, smooth);
  const thrOut = seg(t, 39.6, 40.2, smooth);

  /* F — the signature */
  const sig = seg(t, 40.0, 40.9, smooth);
  const fadeAll = 1 - seg(t, 46.2, 47.6, soft);

  const cardHero = { x: 960, y: 560, w: 760 };
  const firstRowOnWin = onWin(0.3275 + 0.2625 / 2, (145 + 212) / 2 / 750);
  const heroX = interpolate(lift, [0, 1], [firstRowOnWin.x, cardHero.x]);
  const heroY = interpolate(lift, [0, 1], [firstRowOnWin.y, cardHero.y]);
  const heroW = interpolate(lift, [0, 1], [0.2625 * W, cardHero.w]);

  return (
    <AbsoluteFill style={{ fontFamily: FONT, opacity: fadeAll, background: "#04040d" }}>
      <Night t={t} pulse={pulse} />
      <AbsoluteFill style={{ transform: `scale(${bump})` }}>

        {/* ── A: the hook ── */}
        {t < 8.6 && GLYPH_CARDS(tf, stream, freeze)}
        {provider && (
          <div style={{ position: "absolute", left: 0, right: 0, top: 490, display: "flex", justifyContent: "center", transform: `scale(${provPop})` }}>
            <Pill I={Mail} label={provider} size={42} />
          </div>
        )}
        <Head t={t} a={5.0} b={6.05} l1="So many inboxes." y={470} size={110} />

        {/* ── B: converge into one hub ── */}
        {t >= 6 && t < 12.3 && (
          <AbsoluteFill style={{ opacity: 1 - seg(t, 11.8, 12.3) }}>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
              {RING.map((_, k) => {
                const a = (k / RING.length) * Math.PI * 2 - Math.PI / 2;
                const x = 960 + Math.cos(a) * 640, y = 650 + Math.sin(a) * 270;
                const p = seg(t, 6.2 + k * 0.05, 7.0 + k * 0.05, smooth);
                const dot = ((t * 0.9 + k * 0.13) % 1);
                return (
                  <g key={k}>
                    <Hair x1={x} y1={y} x2={960} y2={650} p={p} o={0.32} />
                    {p >= 1 && <circle cx={x + (960 - x) * dot} cy={y + (650 - y) * dot} r={3.5} fill="#fff" opacity={0.85} />}
                  </g>
                );
              })}
            </svg>
            {RING.map((name, k) => {
              const a = (k / RING.length) * Math.PI * 2 - Math.PI / 2;
              const p = ringIn(k);
              return <div key={name} style={{ position: "absolute", left: 960 + Math.cos(a) * 640, top: 650 + Math.sin(a) * 270, transform: `translate(-50%, -50%) scale(${0.6 + p * 0.4})`, opacity: p * (1 - seg(t, 10, 11) * 0.5) }}><Pill label={name} size={22} /></div>;
            })}
            <div style={{ position: "absolute", left: 960 - 130, top: 650 - 130, width: 260, height: 260, borderRadius: "50%", ...glass(1.2), boxShadow: `${glass(1.2).boxShadow}, 0 0 ${40 + hubFlash * 120}px rgba(255,140,120,${0.25 + hubFlash * 0.5})`, display: "grid", placeItems: "center", transform: `scale(${hub * (1 + hubFlash * 0.08)})` }}>
              <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
                <Mail size={64} color={INK} strokeWidth={1.6} />
                <div style={{ fontSize: 24, fontWeight: 600, color: INK, letterSpacing: "-0.01em" }}>All inboxes</div>
              </div>
            </div>
          </AbsoluteFill>
        )}
        <Head t={t} a={9.0} b={12.1} l1="All your mail." l2="One place." />

        {/* ── C: the unified inbox, in glass ── */}
        {t >= 12 && t < 18.2 && (
          <AbsoluteFill style={{ perspective: 2200 }}>
            <div style={{ position: "absolute", left: WX - 10, top: WY - 10, transform: `translateY(${(1 - win) * 160}px) rotateX(${(1 - win) * 22}deg) scale(${0.94 + win * 0.06})`, transformOrigin: "50% 100%", opacity: c01(win * 1.4) * (1 - seg(t, 16.6, 17.4)), filter: `blur(${seg(t, 16.6, 17.4) * 10}px)` }}>
              <Framed pad={10} radius={26}><Crop name="inbox" r={{ x: 0, y: 0, w: 1, h: 1 }} w={W} radius={16} /></Framed>
            </div>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: 1 - seg(t, 16.2, 16.6) }}>
              {([[14.0, 0.25, 0.134, 400, 330], [14.5, 0.46, 0.167, 1520, 330], [15.0, 0.25, 0.5, 400, 650], [15.5, 0.47, 0.129, 1520, 560]] as const).map(([at, px, py, cx, cy], i) => {
                const p = seg(t, at, at + 0.3, smooth);
                const q = onWin(px, py);
                return p > 0 && <g key={i}><Hair x1={cx} y1={cy} x2={q.x} y2={q.y} p={p} o={0.7} /><circle cx={q.x} cy={q.y} r={6 * p} fill="none" stroke="#fff" strokeWidth={2} /></g>;
              })}
            </svg>
            {([[14.0, "Every mailbox", 400, 330, "right"], [14.5, "Sorted for you", 1520, 330, "left"], [15.0, "Views that think ahead", 400, 650, "right"], [15.5, "Search everything", 1520, 560, "left"]] as const).map(([at, label, x, y, side]) => {
              const p = seg(t, at, at + 0.3, smooth);
              return p > 0 && <div key={label} style={{ position: "absolute", left: x, top: y, transform: `translate(${side === "right" ? "-100%" : "0"}, -50%) scale(${0.85 + p * 0.15})`, opacity: p * (1 - seg(t, 16.2, 16.6)) }}><Pill label={label} size={22} /></div>;
            })}
          </AbsoluteFill>
        )}
        <Head t={t} a={12.6} b={13.9} l1="Every account. One inbox." size={72} y={120} />

        {/* ── C→D: the first row lifts out and becomes the hero ── */}
        {t >= 16.4 && t < 32.4 && (
          <div style={{ position: "absolute", left: heroX, top: heroY, transform: `translate(-50%, -50%) scale(${1 + (t >= 20 && t < 26 ? Math.exp(-((t - 20) % BEAT) * 8) * 0.012 : 0)})`, opacity: (1 - seg(t, 26.0, 26.3)) }}>
            <Framed pad={8} radius={22}><Crop name="inbox" r={rowR(0)} w={heroW} radius={14} /></Framed>
          </div>
        )}
        <Head t={t} a={18.2} b={19.9} l1="Every action." l2="Right there." />

        {/* ── D: actions burst on the beat ── */}
        {t >= 20 && t < 26 && (
          <AbsoluteFill style={{ opacity: 1 - chipsOut }}>
            <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
              {ACTIONS.map((_, k) => {
                const a = (k / ACTIONS.length) * Math.PI * 2 - Math.PI / 2;
                const x = 960 + Math.cos(a) * 700, y = 560 + Math.sin(a) * 330;
                return <Hair key={k} x1={960 + Math.cos(a) * 300} y1={560 + Math.sin(a) * 90} x2={x} y2={y} p={chip(k)} o={0.35} />;
              })}
            </svg>
            {ACTIONS.map(([I, label], k) => {
              const a = (k / ACTIONS.length) * Math.PI * 2 - Math.PI / 2;
              const p = chip(k);
              const hot = Math.exp(-Math.max(0, t - (20 + k * 0.5)) * 6) * (t >= 20 + k * 0.5 ? 1 : 0);
              return p > 0 && <div key={label} style={{ position: "absolute", left: 960 + Math.cos(a) * 700 * (0.7 + p * 0.3), top: 560 + Math.sin(a) * 330 * (0.7 + p * 0.3), transform: `translate(-50%, -50%) scale(${0.5 + p * 0.5 + hot * 0.08})`, opacity: p }}><Pill I={I} label={label} size={24} hot={hot} /></div>;
            })}
          </AbsoluteFill>
        )}

        {/* ── D: the proof — each action in the real interface ── */}
        {proof && (
          <AbsoluteFill style={{ opacity: pIn * (1 - pOut), transform: `translateY(${(1 - pIn) * 60 - pOut * 60}px)`, filter: `blur(${(1 - pIn) * 10 + pOut * 10}px)` }}>
            <div style={{ position: "absolute", left: 160, top: 540, transform: "translateY(-50%)", fontSize: 86, fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.02, color: INK }}>
              <div>{proof.l1}</div>
              <div style={{ backgroundImage: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", paddingBottom: 8 }}>{proof.l2}</div>
            </div>
            <div style={{ position: "absolute", left: 1290, top: 540, transform: "translate(-50%, -50%)" }}>
              <Framed pad={10} radius={24}><Crop name={proof.name} r={proof.r} w={proof.w} radius={14} /></Framed>
            </div>
          </AbsoluteFill>
        )}
        {/* A clean line sweeps each change in the proof montage. */}
        {t >= 26 && t < 32 && ((t - 26) % 1) > 0.86 && <div style={{ position: "absolute", left: 0, right: 0, top: 540 + (((t - 26) % 1) - 0.86) / 0.14 * 400 - 200, height: 1.5, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.9), transparent)" }} />}
        <Head t={t} a={32.0} b={33.5} l1="No switching apps." y={440} size={104} />

        {/* ── E: every action, right where you read ── */}
        {t >= 34 && t < 40.4 && (
          <AbsoluteFill style={{ perspective: 2200, opacity: 1 - thrOut, transform: `scale(${1 + thrOut * 0.08})`, filter: `blur(${thrOut * 12}px)` }}>
            <div style={{ position: "absolute", left: WX - 10, top: WY - 10, transform: `translateY(${(1 - thr) * 140}px) rotateX(${(1 - thr) * 18}deg) scale(${0.94 + thr * 0.06})`, transformOrigin: "50% 100%", opacity: c01(thr * 1.4) }}>
              <Framed pad={10} radius={26}><Crop name="thread" r={{ x: 0, y: 0, w: 1, h: 1 }} w={W} radius={16} /></Framed>
            </div>
            {LAND.map(([ai, px, py], k) => {
              const at = 35 + k * 0.25;
              const fly = seg(t, at - 0.35, at, smooth);
              const ring = seg(t, at, at + 0.4, soft);
              const q = onWin(px, py);
              const ang = (k / LAND.length) * Math.PI * 2;
              const sx = 960 + Math.cos(ang) * 1100, sy = 560 + Math.sin(ang) * 640;
              const [I, label] = ACTIONS[ai]!;
              return (
                <React.Fragment key={k}>
                  {fly > 0 && fly < 1 && <div style={{ position: "absolute", left: sx + (q.x - sx) * fly, top: sy + (q.y - sy) * fly, transform: `translate(-50%, -50%) scale(${1 - fly * 0.5})`, opacity: 1 - fly * 0.4 }}><Pill I={I} label={label} size={20} /></div>}
                  {ring > 0 && <div style={{ position: "absolute", left: q.x - 26, top: q.y - 26, width: 52, height: 52, borderRadius: 99, boxShadow: `0 0 0 2px rgba(255,140,120,${0.9 * (1 - seg(t, 38.6, 39.4))}), 0 0 24px rgba(255,120,110,${0.5 * (1 - seg(t, 38.6, 39.4))})`, transform: `scale(${0.4 + ring * 0.6})` }} />}
                </React.Fragment>
              );
            })}
          </AbsoluteFill>
        )}
        <Head t={t} a={37.0} b={39.6} l1="Every action, right where you read." size={66} y={128} />

        {/* ── F: the signature ── */}
        {t >= 40 && (
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 34, padding: "34px 64px", borderRadius: 999, ...glass(1.2), boxShadow: `${glass(1.2).boxShadow}, 0 0 ${60 + Math.exp(-Math.max(0, t - 44) * 3) * (t >= 44 ? 120 : 0)}px rgba(255,130,110,0.28)`, transform: `scale(${0.85 + sig * 0.15}) translateY(${(1 - sig) * 40 - 40}px)`, opacity: sig }}>
              <Emblem id="up" size={110} light={kf(t, [[40, 0.1], [42.5, 0.9]], soft)} color={seg(t, 40.6, 41.6, soft)} />
              <div style={{ width: 1.5, height: 92, background: "rgba(255,255,255,0.3)" }} />
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 30, fontWeight: 500, color: DIM, letterSpacing: "-0.01em" }}>cloudesk</div>
                <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: "-0.04em", color: INK, lineHeight: 1 }}>Mail</div>
              </div>
            </div>
            <div style={{ position: "absolute", top: 720, left: 0, right: 0, textAlign: "center", fontSize: 38, fontWeight: 600, letterSpacing: "-0.02em", color: INK, opacity: seg(t, 41.5, 42.3, soft), transform: `translateY(${(1 - seg(t, 41.5, 42.3, smooth)) * 16}px)` }}>
              All your mail. Every action. <span style={{ backgroundImage: GRAD, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>One place.</span>
            </div>
          </AbsoluteFill>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Act A's scattered inbox rows: they fly in on eighth notes, jitter on the beat, then stream to the hub. */
function GLYPH_CARDS(t: number, stream: (k: number) => number, freeze: boolean) {
  return SCATTER.map(([sx, sy, rot], k) => {
    const inn = seg(t, 0.4 + k * 0.18, 0.9 + k * 0.18, smooth);
    const s = stream(k);
    const fromX = 960 + sx! * (2 - inn), fromY = 560 + sy! * (2 - inn);
    const jit = !freeze && t > 2 && t < 5 ? Math.sin(t * 22 + k) * 2.5 : 0;
    const x = fromX + (960 - fromX) * s, y = fromY + (650 - fromY) * s;
    const dim = t >= 5 && t < 6 ? 0.35 : 1;
    return inn > 0 && s < 1 && (
      <div key={k} style={{ position: "absolute", left: x + jit, top: y, transform: `translate(-50%, -50%) rotate(${rot! * (1 - s)}deg) scale(${(0.8 + inn * 0.2) * (1 - s * 0.85)})`, opacity: inn * (1 - s * 0.6) * dim }}>
        <Framed pad={6} radius={18}><Crop name="inbox" r={rowR(k)} w={380} radius={12} /></Framed>
      </div>
    );
  });
}
