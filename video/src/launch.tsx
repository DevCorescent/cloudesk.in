// The Mail launch film — in the style of a modern SaaS product launch: light and
// dark scenes in turn; thin type that arrives one word at a time; real
// interface pieces floating with soft shadows and fast camera passes; embossed
// discs; a glass orb with a ribbon of light; a hand cursor and a click; a
// confetti burst; a sparkle that sweeps the frame; the logo.
//
// Every scene hands off into the next — a disc grows into the dark field, the
// orb stays put while the app blurs away beneath it, the grey fades to white
// under the flight, the dark field slides in with the thread — so there is
// never a hard cut. Every piece of interface is a real capture of Mail
// (video/public/mail/). Sound cues live in src/launch-plan.js.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Wordmark } from "./kit";
import { Emblem, FONT, c01, seg, smooth, soft } from "./film";

const src = (n: string) => staticFile(`mail/${n}.jpg`);
const INK = "#16191d";
const ACCENT = "#d9554f"; // the brand coral, deepened for type
const VIOLET = "#b44fd6"; // the AI accent
const LIGHT_BG = "#f6f7f7";
const DARK = "radial-gradient(60% 50% at 50% 45%, rgba(110,170,140,0.18), transparent 70%), radial-gradient(40% 40% at 80% 20%, rgba(217,85,79,0.12), transparent 70%), #262a30";
const GREY = "linear-gradient(90deg, #3a4048 0%, #6a7078 60%, #9aa0a6 100%)";

type R = { x: number; y: number; w: number; h: number };
/** A real piece of a captured screen (fractions of the 16:10 frame), at width w. */
function Crop({ name, r, w, radius = 14 }: { name: string; r: R; w: number; radius?: number }) {
  const iw = w / r.w;
  const h = (w * r.h * 10) / (r.w * 16);
  return (
    <div style={{ width: w, height: h, borderRadius: radius, overflow: "hidden", position: "relative", background: "#fff" }}>
      <Img src={src(name)} style={{ position: "absolute", width: iw, left: -r.x * iw, top: -r.y * iw * 0.625 }} />
    </div>
  );
}
/** A white floating card with a long, soft shadow. */
const Card = ({ children, pad = 0, radius = 18, dark = false }: { children: React.ReactNode; pad?: number; radius?: number; dark?: boolean }) => (
  <div style={{ padding: pad, borderRadius: radius, background: "#fff", boxShadow: dark ? "0 40px 90px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)" : "0 34px 70px -26px rgba(30,40,50,0.28), 0 2px 8px rgba(30,40,50,0.06)", overflow: "hidden" }}>{children}</div>
);

/** Words that glide in one at a time; earlier words fade lighter as the key word lands. */
function Words({ t, words, size = 120, y = 540, out, dark = false, x }: { t: number; words: { w: string; at: number; tone?: "ink" | "accent" | "violet" | "light" }[]; size?: number; y?: number; out?: number; dark?: boolean; x?: number }) {
  const o = out !== undefined ? seg(t, out, out + 0.35, smooth) : 0;
  if (t < words[0]!.at || o >= 1) return null;
  const last = words.filter((w) => t >= w.at).length - 1;
  return (
    <div style={{ position: "absolute", left: x ?? 0, right: x === undefined ? 0 : undefined, top: y, transform: `translateY(-50%) translateY(${-o * 60}px)`, display: "flex", justifyContent: x === undefined ? "center" : "flex-start", gap: size * 0.26, fontFamily: FONT, fontSize: size, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1.1, opacity: 1 - o, filter: `blur(${o * 10}px)` }}>
      {words.map((w, i) => {
        if (t < w.at) return null;
        const p = seg(t, w.at, w.at + 0.34, smooth);
        const tone = w.tone ?? "ink";
        const key = i === last || tone === "accent" || tone === "violet";
        const base = tone === "accent" ? ACCENT : tone === "violet" ? VIOLET : tone === "light" ? (dark ? "rgba(255,255,255,0.55)" : "#9aa3a8") : dark ? "#f2f3f5" : INK;
        const faded = !key && tone === "ink" ? (dark ? "rgba(255,255,255,0.55)" : "#8d979d") : base;
        return <span key={i} style={{ display: "inline-block", color: last > i ? faded : base, opacity: p, transform: `translateX(${(1 - p) * 60}px)`, filter: `blur(${(1 - p) * 10}px)` }}>{w.w}</span>;
      })}
    </div>
  );
}

/** The four-pointed sparkle. */
export const Spark = ({ size, color = VIOLET }: { size: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
    <defs><linearGradient id={`sp${size | 0}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#d96bff" /><stop offset="1" stopColor={color} /></linearGradient></defs>
    <path d="M50 0 C54 38 62 46 100 50 C62 54 54 62 50 100 C46 62 38 54 0 50 C38 46 46 38 50 0 Z" fill={`url(#sp${size | 0})`} />
  </svg>
);

/** The glass orb, in the brand's colours. */
const Orb = ({ size }: { size: number }) => (
  <div style={{ width: size, height: size, borderRadius: "50%", background: "radial-gradient(circle at 34% 28%, #ffffff 0%, rgba(255,255,255,0.65) 14%, rgba(255,160,140,0.55) 38%, #b8434b 78%, #5a1f2c 100%)", boxShadow: `inset -${size * 0.08}px -${size * 0.1}px ${size * 0.2}px rgba(60,10,20,0.45), inset ${size * 0.05}px ${size * 0.06}px ${size * 0.12}px rgba(255,255,255,0.7), 0 ${size * 0.18}px ${size * 0.4}px -${size * 0.1}px rgba(40,10,20,0.5)` }} />
);

/** A hand pointer; it squashes on a press. */
export function Hand({ x, y, press }: { x: number; y: number; press: number }) {
  return (
    <div style={{ position: "absolute", left: x - 14, top: y - 4, transform: `scale(${1 - press * 0.12})`, filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.3))" }}>
      <svg width={46} height={52} viewBox="0 0 24 27">
        <path d="M9 2.5a1.6 1.6 0 0 1 3.2 0V11l.1-1.4a1.6 1.6 0 0 1 3.2.2V12l.2-.9a1.6 1.6 0 0 1 3.1.6v1.4l.2-.4a1.5 1.5 0 0 1 2.8.9v4.6c0 3.9-2.9 7-6.8 7h-1.8c-2 0-3.8-.9-5-2.5L3.4 16.6a1.6 1.6 0 0 1 2.4-2.1L9 17.4V2.5z" fill="#fff" stroke="#16191d" strokeWidth={1.3} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
const Ripple = ({ x, y, t, at }: { x: number; y: number; t: number; at: number }) => {
  const p = (t - at) / 0.5;
  if (p < 0 || p > 1) return null;
  return <div style={{ position: "absolute", left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: 99, border: "2px solid rgba(217,85,79,0.8)", opacity: 1 - p, transform: `scale(${0.3 + p})` }} />;
};

/* real pieces (fractions of each screenshot) */
const ROWS: R[] = [[145, 212], [213, 299], [300, 367]].map(([a, b]) => ({ x: 0.3275, y: a! / 750, w: 0.2625, h: (b! - a!) / 750 }));
const REPLY: R = { x: 0.611, y: 0.631, w: 0.368, h: 0.292 };
const MEETING: R = { x: 0.608, y: 0.33, w: 0.375, h: 0.205 };
const SEARCH: R = { x: 0.35, y: 0.108, w: 0.24, h: 0.04 };

/* the app in scene F, and where its search field (the orb's seat) sits inside it */
const APP_W = 1280, APP_H = 800;
const SEAT = { x: 0.47 * APP_W, y: 0.129 * APP_H };
/* where the orb is on screen when the flight begins */
const TAKEOFF = { x: 560, y: 400 };

export const Launch: React.FC = () => {
  const t = useCurrentFrame() / 30;

  /* ── backgrounds, as continuous blends — never a switch ── */
  const darkDisc = seg(t, 8.35, 8.95, smooth); // the dark field grows out of the centre
  const darkHold = 1 - seg(t, 13.7, 14.2, smooth); // …and dissolves under the flight
  const grey = seg(t, 13.5, 14.1, smooth) * (1 - seg(t, 14.7, 15.3, smooth));
  const darkSlide = seg(t, 26.2, 26.85, smooth); // the dark field slides in with the thread
  const wipe = seg(t, 35.6, 36.3, smooth);

  /* B — floating cards and a fast pass */
  const cardIn = (k: number) => seg(t, 2.0 + k * 0.3, 2.6 + k * 0.3, smooth);
  const pass = seg(t, 3.4, 4.6, (x) => x);

  /* D — discs ripple out from the centre, smallest first */
  const discIn = (i: number) => seg(t, 6.0 + i * 0.14, 6.5 + i * 0.14, soft);
  const discZoom = interpolate(t, [6, 9], [1, 1.6], { extrapolateRight: "clamp" });
  const discsOut = seg(t, 8.5, 8.95);

  /* E — dark: pieces fly in */
  const e1 = seg(t, 8.8, 9.3, smooth), e1o = seg(t, 9.6, 9.95, smooth);
  const e2 = seg(t, 9.8, 10.3, smooth), e2o = seg(t, 10.6, 10.95, smooth);
  const e3 = seg(t, 10.8, 11.25, smooth), e3o = seg(t, 11.6, 11.95, smooth);

  /* F — the app tilts in; the camera pushes in on the search field, anchored on the orb's seat */
  const app = seg(t, 11.8, 12.5, smooth);
  const push = seg(t, 12.6, 13.8, smooth);
  const seatX = interpolate(push, [0, 1], [960 - APP_W / 2 + SEAT.x, TAKEOFF.x]);
  const seatY = interpolate(push, [0, 1], [540 - APP_H / 2 + SEAT.y, TAKEOFF.y]);
  const appScale = interpolate(push, [0, 1], [0.9 + app * 0.1, 1.9]);
  const appOut = seg(t, 13.8, 14.3, smooth);
  const orbPop = seg(t, 13.25, 13.55, soft);

  /* G — the flight: the orb leaves its seat and exits right, trailing light */
  const fly = seg(t, 13.8, 14.9, (x) => x * x * (3 - 2 * x) * 0.4 + x * 0.6);
  const flyX = TAKEOFF.x + fly * 1700, flyY = TAKEOFF.y + fly * 40;

  /* H — it re-enters on the arc; "From ten tabs to one inbox." */
  const arc = seg(t, 14.9, 17.6, smooth);

  /* I — Reply · Schedule · Remind */
  const comp = seg(t, 19.8, 20.5, smooth);
  const W = 960, CH = (W * REPLY.h * 10) / (REPLY.w * 16), CX = 960 - W / 2, CY = 600 - CH / 2 + 60;
  const at = (rx: number, ry: number) => ({ x: CX + rx * W, y: CY + ry * CH });
  const send = at(0.09, 0.945), arrow = at(0.185, 0.945), remind = at(0.3, 0.945);
  const hx = interpolate(t, [20.2, 21.0, 22.0, 22.5, 23.0, 23.4, 24.2], [1500, send.x, send.x, arrow.x, arrow.x, remind.x, remind.x + 40], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: smooth });
  const hy = interpolate(t, [20.2, 21.0, 22.0, 22.5, 23.0, 23.4, 24.2], [1100, send.y, send.y, arrow.y, arrow.y, remind.y, remind.y + 30], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: smooth });
  const pressAt = [21.2, 22.6, 23.5];
  const press = pressAt.some((p) => t >= p && t < p + 0.12) ? 1 : 0;
  const compOut = seg(t, 24.2, 24.7, smooth);

  /* J — the check and confetti */
  const check = seg(t, 24.4, 24.8, smooth);
  const confOut = seg(t, 25.8, 26.5);

  /* K — dark: the thread slides in with the field; Summarise */
  const thr = seg(t, 26.3, 27.05, smooth);
  const TW = 1500, TH = TW * 0.625;
  const summ = { x: 200 + 0.665 * TW, y: 300 + 0.348 * TH };
  const thrOut = seg(t, 30.0, 30.45, smooth);

  /* L/M — the sparkle, then the words; N — the wipe, the logo */
  const spark = seg(t, 30.4, 31.3, (x) => x * x);
  const logo = seg(t, 36.4, 37.1, smooth);

  return (
    <AbsoluteFill style={{ fontFamily: FONT, overflow: "hidden", background: LIGHT_BG }}>
      {/* ── the fields ── */}
      <AbsoluteFill style={{ background: "radial-gradient(90% 80% at 50% 45%, #ffffff 0%, #f3f5f5 60%, #e9eded 100%)" }} />
      {darkDisc > 0 && darkHold > 0 && (
        <div style={{ position: "absolute", left: 960 - 1400, top: 540 - 1400, width: 2800, height: 2800, borderRadius: "50%", background: DARK, transform: `scale(${darkDisc})`, opacity: darkHold }} />
      )}
      {grey > 0 && <AbsoluteFill style={{ background: GREY, opacity: grey }} />}
      {darkSlide > 0 && <AbsoluteFill style={{ background: DARK, clipPath: `inset(0 0 0 ${(1 - darkSlide) * 100}%)` }} />}

      {/* A — Too many inboxes. */}
      <Words t={t} words={[{ w: "Too", at: 0.3 }, { w: "many", at: 0.8 }, { w: "inboxes.", at: 1.3 }]} out={1.9} />

      {/* B — real inbox rows float in; the camera passes close */}
      {t >= 2 && t < 4.9 && (
        <AbsoluteFill style={{ opacity: 1 - seg(t, 4.5, 4.9) }}>
          {ROWS.map((r, k) => {
            const p = cardIn(k);
            const z = [1, 0.92, 0.84][k]!;
            return <div key={k} style={{ position: "absolute", left: 620 - k * 70 + (1 - p) * 700, top: 330 + k * 150 + (1 - p) * 120, transform: `scale(${z})`, opacity: p, filter: `blur(${(1 - p) * 14 + (k === 2 ? 2 : 0)}px)` }}><Card><Crop name="inbox" r={r} w={760} /></Card></div>;
          })}
          {pass > 0 && pass < 1 && (
            <div style={{ position: "absolute", left: interpolate(pass, [0, 1], [1700, -1900]), top: 280, transform: "rotate(-8deg) scale(2.6)", transformOrigin: "0 0", filter: `blur(${6 + Math.sin(pass * Math.PI) * 10}px)` }}><Card><Crop name="inbox" r={ROWS[1]!} w={760} /></Card></div>
          )}
        </AbsoluteFill>
      )}
      <Words t={t} words={[{ w: "tabs.", at: 4.9, tone: "accent" }]} out={5.6} />

      {/* D — Too little time, on embossed discs that ripple outward; the smallest grows on into the dark */}
      {t >= 6 && t < 9 && (
        <AbsoluteFill style={{ transform: `scale(${discZoom})` }}>
          {[880, 640, 400].map((d, i) => {
            const p = discIn(2 - i);
            return <div key={d} style={{ position: "absolute", left: 960 - d / 2 + Math.sin(t * 0.8 + i) * 10, top: 540 - d / 2, width: d, height: d, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #ffffff, #eef1f1 70%)", boxShadow: "24px 28px 60px rgba(60,70,80,0.18), -18px -18px 50px rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.8)", transform: `rotate(${t * (10 + i * 6)}deg) scale(${0.4 + p * 0.6})`, opacity: p * (1 - discsOut) }} />;
          })}
        </AbsoluteFill>
      )}
      <Words t={t} words={[{ w: "Too", at: 6.6, tone: "light" }, { w: "little", at: 6.9, tone: "light" }, { w: "time.", at: 7.4 }]} out={8.3} />

      {/* E — dark: real pieces sweep in */}
      {t >= 8.8 && t < 11.95 && (
        <AbsoluteFill>
          <div style={{ position: "absolute", left: 960, top: 520, transform: `translate(-50%, -50%) translateX(${(1 - e1) * -900 + e1o * 600}px) rotate(${(1 - e1) * -6}deg)`, opacity: e1 * (1 - e1o), filter: `blur(${(1 - e1) * 18 + e1o * 18}px)` }}><Card dark><Crop name="meeting" r={MEETING} w={880} /></Card></div>
          <div style={{ position: "absolute", left: 960, top: 540, perspective: 1600, transform: `translate(-50%, -50%) translateY(${(1 - e2) * 500 - e2o * 400}px)`, opacity: e2 * (1 - e2o), filter: `blur(${(1 - e2) * 16 + e2o * 16}px)` }}>
            <div style={{ transform: "rotateX(14deg) rotateY(-16deg)" }}><Card dark><Crop name="reply" r={REPLY} w={820} /></Card></div>
          </div>
          <div style={{ position: "absolute", left: 960, top: 540, transform: `translate(-50%, -50%) scale(${0.8 + e3 * 0.2})`, opacity: e3 * (1 - e3o), filter: `blur(${(1 - e3) * 12 + e3o * 12}px)` }}>
            <div style={{ padding: 10, borderRadius: 999, background: "rgba(255,255,255,0.12)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2), 0 0 60px rgba(150,200,180,0.25)" }}><Crop name="inbox" r={SEARCH} w={1100} radius={999} /></div>
          </div>
        </AbsoluteFill>
      )}

      {/* F — the app tilts in; the push is anchored on the search field, so the orb never moves when the app leaves */}
      {t >= 11.8 && t < 14.3 && (
        <AbsoluteFill style={{ perspective: 2200 }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: APP_W, transformOrigin: `${SEAT.x}px ${SEAT.y}px`, transform: `translate(${seatX - SEAT.x}px, ${seatY - SEAT.y}px) scale(${appScale}) rotateY(${(1 - app) * -24 - 10 * (1 - push)}deg) rotateX(${8 * (1 - push)}deg)`, opacity: app * (1 - appOut), filter: `blur(${(1 - app) * 8 + appOut * 16}px)` }}>
            <Card dark radius={20}><Crop name="inbox" r={{ x: 0, y: 0, w: 1, h: 1 }} w={APP_W} /></Card>
          </div>
        </AbsoluteFill>
      )}
      {/* The orb: it pops into its seat, then takes off from exactly there. */}
      {t >= 13.25 && t < 14.95 && (() => {
        const size = t < 13.8 ? 44 * appScale * orbPop : 72 + 12 * fly;
        const x = t < 13.8 ? seatX : flyX, y = t < 13.8 ? seatY : flyY;
        return <div style={{ position: "absolute", left: x - size / 2, top: y - size / 2 }}><Orb size={size} /></div>;
      })()}

      {/* G — the ribbon of light behind the flight */}
      {fly > 0 && fly < 1 && (
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <defs><linearGradient id="rib" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset="0.5" stopColor="#fff" stopOpacity="0.8" /><stop offset="1" stopColor="#cfe0ff" stopOpacity="0.25" /></linearGradient></defs>
          <path d={`M ${TAKEOFF.x} ${TAKEOFF.y} Q ${TAKEOFF.x + (flyX - TAKEOFF.x) * 0.5} ${TAKEOFF.y - 60} ${flyX} ${flyY}`} stroke="url(#rib)" strokeWidth={64} strokeLinecap="round" fill="none" opacity={0.9 * grey} style={{ filter: "blur(7px)" }} />
          <line x1={0} y1={330} x2={1100 * fly + 300} y2={360} stroke="rgba(255,255,255,0.7)" strokeWidth={1.5} opacity={grey} />
          <line x1={0} y1={580} x2={1400 * fly} y2={600} stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} opacity={grey} />
          <circle cx={1100 * fly + 300} cy={360} r={5} fill="#fff" opacity={grey} />
          <circle cx={1400 * fly} cy={600} r={4} fill="#fdba5a" opacity={grey} />
        </svg>
      )}

      {/* H — From ten tabs to one inbox. */}
      {t >= 14.9 && t < 19.9 && (
        <AbsoluteFill style={{ opacity: 1 - seg(t, 19.5, 19.9) }}>
          <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
            <path d="M -100 300 C 500 120, 1100 180, 1200 520" stroke="#cfe0ff" strokeWidth={46} strokeLinecap="round" fill="none" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - Math.min(1, arc * 1.06)} opacity={0.75 * (1 - seg(t, 17.6, 18.4))} style={{ filter: "blur(2px)" }} />
          </svg>
          {(() => {
            // The orb rides the ribbon, settles in the centre as the emblem badge, then shrinks to a dot before "one inbox."
            const p = arc;
            const bx = (1 - p) ** 3 * -100 + 3 * (1 - p) ** 2 * p * 500 + 3 * (1 - p) * p ** 2 * 1100 + p ** 3 * 1200;
            const by = (1 - p) ** 3 * 300 + 3 * (1 - p) ** 2 * p * 120 + 3 * (1 - p) * p ** 2 * 180 + p ** 3 * 520;
            const settle = seg(t, 17.4, 18.0, smooth);
            const x = bx + (960 - bx) * settle, y = by + (540 - by) * settle;
            const s = 60 + settle * 100;
            const shrink = seg(t, 18.2, 18.7, smooth);
            const fx = x + (709 - x) * shrink, fy = y + (540 - y) * shrink, fs = s - shrink * 126;
            return (
              <div style={{ position: "absolute", left: fx - fs / 2, top: fy - fs / 2, width: fs, height: fs }}>
                <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #fff, rgba(255,255,255,0.55) 35%, rgba(240,240,245,0.9))", boxShadow: "0 20px 40px -14px rgba(30,40,50,0.35), inset 0 0 0 1px rgba(255,255,255,0.9)", opacity: settle * (1 - shrink) }} />
                <div style={{ position: "absolute", inset: 0, opacity: 1 - settle + shrink }}><Orb size={fs} /></div>
                {settle > 0.3 && shrink < 0.8 && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: c01((settle - 0.3) * 2) * (1 - shrink) }}><Emblem id="lb" size={fs * 0.55} color={1} light={0.6} /></div>}
              </div>
            );
          })()}
          <Words t={t} words={[{ w: "From", at: 15.0, tone: "light" }, { w: "ten", at: 15.3, tone: "light" }, { w: "tabs", at: 15.6, tone: "light" }]} y={620} size={104} out={16.4} />
          <Words t={t} words={[{ w: "to", at: 16.6 }]} y={700} size={104} out={17.3} x={1160} />
          <Words t={t} words={[{ w: "one inbox.", at: 18.4 }]} size={110} x={748} />
        </AbsoluteFill>
      )}

      {/* I — Reply · Schedule · Remind, on the real composer */}
      {t >= 19.8 && t < 24.8 && (
        <AbsoluteFill style={{ opacity: 1 - compOut }}>
          <div style={{ position: "absolute", left: CX, top: CY, transform: `translateY(${(1 - comp) * 80 + compOut * 50}px) scale(${1 - compOut * 0.04})`, opacity: comp, filter: `blur(${(1 - comp) * 10 + compOut * 10}px)` }}>
            <Card radius={20}><Crop name="reply" r={REPLY} w={W} radius={0} /></Card>
          </div>
          {pressAt.map((p, i) => t >= p && <div key={i} style={{ position: "absolute", left: [send, arrow, remind][i]!.x - 60, top: [send, arrow, remind][i]!.y - 26, width: 120, height: 52, borderRadius: 99, boxShadow: `0 0 0 2px rgba(217,85,79,${0.85 * (1 - seg(t, p + 0.5, p + 0.9))}), 0 0 30px rgba(217,85,79,${0.35 * (1 - seg(t, p + 0.5, p + 0.9))})` }} />)}
          {pressAt.map((p, i) => <Ripple key={`r${i}`} x={[send, arrow, remind][i]!.x} y={[send, arrow, remind][i]!.y} t={t} at={p} />)}
          {t >= 20.2 && <Hand x={hx} y={hy} press={press} />}
          <Words t={t} words={[{ w: "Reply", at: 20.2, tone: "light" }]} y={CY - 110} size={110} out={21.9} />
          <Words t={t} words={[{ w: "Schedule", at: 22.0, tone: "light" }]} y={CY - 110} size={110} out={22.9} />
          <Words t={t} words={[{ w: "Remind", at: 23.0, tone: "light" }]} y={CY - 110} size={110} out={24.1} />
        </AbsoluteFill>
      )}

      {/* J — the check, and confetti */}
      {t >= 24.4 && t < 26.6 && (
        <AbsoluteFill>
          {Array.from({ length: 34 }, (_, i) => {
            const a = (i / 34) * Math.PI * 2 + (i % 3) * 0.4;
            const sp = 500 + (i % 5) * 160;
            const k = Math.max(0, t - 24.45);
            const x = 960 + Math.cos(a) * sp * k, y = 500 + Math.sin(a) * sp * k * 0.8 + 380 * k * k;
            const near = i % 4 === 0;
            const col = ["#1f3a33", ACCENT, "#2f8f6a", "#cfe0ff", "#16191d"][i % 5];
            return <div key={i} style={{ position: "absolute", left: x, top: y, width: near ? 46 : 24, height: near ? 30 : 15, borderRadius: 3, background: col, transform: `rotateX(${k * 540 + i * 30}deg) rotateY(${k * 360 + i * 20}deg) rotate(${i * 25}deg)`, filter: near ? "blur(3px)" : undefined, opacity: k > 0 ? 1 - confOut : 0 }} />;
          })}
          <div style={{ position: "absolute", left: 960 - 70, top: 470 - 70, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle at 35% 30%, #4fb78c, #1f7a55)", boxShadow: "0 24px 50px -16px rgba(31,122,85,0.6)", display: "grid", placeItems: "center", transform: `scale(${check}) translateX(${-darkSlide * 500}px)`, opacity: 1 - darkSlide }}>
            <svg width={70} height={70} viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={24} strokeDashoffset={24 * (1 - seg(t, 24.6, 24.95))} /></svg>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 590, textAlign: "center", fontSize: 44, fontWeight: 400, color: "#3c4247", opacity: seg(t, 24.7, 25.0) * (1 - darkSlide), transform: `translateX(${-darkSlide * 500}px)` }}>Reply scheduled</div>
        </AbsoluteFill>
      )}

      {/* K — dark: the real thread slides in with the field; Smart replies */}
      {t >= 26.3 && t < 30.5 && (
        <AbsoluteFill style={{ perspective: 2400, opacity: 1 - thrOut, transform: `scale(${1 + thrOut * 0.06})`, filter: `blur(${thrOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 200, top: 300, transformOrigin: "0 0", transform: `translateX(${(1 - thr) * 900}px) rotateY(${-16 + thr * 4}deg) rotateX(6deg) translateX(${-(t - 26.4) * 20}px)`, opacity: thr }}>
            <Card dark radius={22}><div style={{ position: "relative" }}><Crop name="thread" r={{ x: 0, y: 0, w: 1, h: 1 }} w={TW} />
              {t >= 27.9 && <div style={{ position: "absolute", left: 0.638 * TW - 6, top: 0.333 * TH - 4, width: 0.072 * TW + 12, height: 0.03 * TH + 8, borderRadius: 99, boxShadow: `0 0 0 2px rgba(217,85,79,0.9), 0 0 28px rgba(217,85,79,0.4)` }} />}
            </div></Card>
          </div>
          {t >= 27.3 && <Hand x={interpolate(t, [27.3, 27.85], [1700, summ.x - 30], { extrapolateRight: "clamp", easing: smooth })} y={interpolate(t, [27.3, 27.85], [1100, summ.y + 40], { extrapolateRight: "clamp", easing: smooth })} press={t >= 27.9 && t < 28.02 ? 1 : 0} />}
          <Words t={t} words={[{ w: "Smart", at: 27.2, tone: "accent" }, { w: "replies.", at: 29.0, tone: "accent" }]} y={200} size={104} dark x={1180} />
        </AbsoluteFill>
      )}

      {/* L — the sparkle sweeps the frame */}
      {t >= 30.4 && t < 31.6 && (
        <div style={{ position: "absolute", left: 960, top: 540, transform: `translate(-50%, -50%) scale(${0.2 + spark * 24}) rotate(${spark * 40}deg)`, opacity: 1 - seg(t, 31.2, 31.6) }}><Spark size={120} /></div>
      )}

      {/* M — AI-powered. Unified Mail. */}
      <Words t={t} words={[{ w: "AI-powered", at: 31.6, tone: "violet" }]} size={108} dark out={33.2} />
      {t >= 31.6 && t < 33.3 && <div style={{ position: "absolute", left: 1290, top: 520, transform: `translate(-50%, -50%) scale(${seg(t, 31.9, 32.2, smooth)}) rotate(${(t - 31.6) * 30}deg)` }}><Spark size={56} /></div>}
      <Words t={t} words={[{ w: "Unified", at: 33.4 }, { w: "Mail", at: 33.75, tone: "violet" }]} size={108} dark out={35.5} />
      {t >= 33.75 && t < 35.6 && <div style={{ position: "absolute", left: 1320, top: 520, transform: `translate(-50%, -50%) scale(${seg(t, 34.0, 34.3, smooth)}) rotate(${(t - 33.7) * 30}deg)` }}><Spark size={52} /></div>}

      {/* N/O — a violet wipe to white, then the logo */}
      {t >= 35.6 && (
        <AbsoluteFill>
          <AbsoluteFill style={{ background: LIGHT_BG, clipPath: `inset(0 ${100 - c01((wipe * 2600 - 400) / 1920) * 100}% 0 0)` }} />
          <div style={{ position: "absolute", left: wipe * 2600 - 900 - 300, top: -400, width: 1800, height: 1900, borderRadius: "50%", background: "radial-gradient(closest-side, #d96bff, #b44fd6 45%, rgba(180,79,214,0))", opacity: 1 - seg(t, 36.0, 36.5) }} />
          <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: logo, transform: `scale(${0.94 + logo * 0.06})` }}>
            <Wordmark size={130} color={INK} />
          </AbsoluteFill>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
