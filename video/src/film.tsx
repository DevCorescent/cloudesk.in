// The film. One continuous shot told on one clock (seconds): a line of light
// finds an edge, the edge becomes the Cloudesk emblem in brushed metal; the
// emblem becomes the boot mark of a dark glass display, and the camera glides
// across the real product — close up, one idea at a time — until every module
// emerges from the dark, converges, and the film resolves on the signature.
//
// Layout system (1920 × 1080): 160 px side margins, a title block centred at
// the top (headline cap line 132, supporting line 240), the display's screen
// at x 480–1440, y 330–930 (16:10, the screenshots' own ratio).
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ACTS, SCREENS } from "./cues.js";

export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Arial, sans-serif';
export const INK = "#f5f5f7";
export const GREY = "#86868b";
export const LABEL = "#6e6e73";
export const BG = "#030304";
export const SCREEN = { x: 480, y: 330, w: 960, h: 600 };
export const BEZEL = 16;
export const smooth = Easing.bezier(0.45, 0, 0.15, 1); // camera and objects
export const soft = Easing.bezier(0.25, 0.1, 0.25, 1); // type and light

const shot = (n: string) => staticFile(`shots/${n}.jpg`);
export const c01 = (v: number) => Math.max(0, Math.min(1, v));
/** 0 → 1 between seconds a and b. */
export const seg = (t: number, a: number, b: number, e = smooth) => interpolate(t, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });
/** Piecewise keyframes: [[time, value], …], eased between each pair. */
export function kf(t: number, keys: [number, number][], e = smooth) {
  if (t <= keys[0]![0]) return keys[0]![1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    const [t0, v0] = keys[i - 1]!;
    if (t <= t1) return v0 + (v1 - v0) * e((t - t0) / (t1 - t0 || 1));
  }
  return keys.at(-1)![1];
}
/** A point on the display's screen, from fractions of the screenshot. */
export const onScreen = (px: number, py: number, dx = 0) => ({ x: SCREEN.x + px * SCREEN.w + dx, y: SCREEN.y + py * SCREEN.h });

/* ───────────────────────── the emblem ───────────────────────── */

const PATHS = ["M28 387V90A67 67 0 0 1 95 23", "M95 23A67 67 0 0 1 161 102A100 100 0 0 1 238 282", "M238 282A72 72 0 0 1 162 398A67 67 0 0 1 28 387"];
const BRAND = ["#FF5A5F", "#FDBA5A", "#d9d9de"];
/**
 * The cloud "d" as an object: brushed silver strokes with depth beneath and a
 * key light that travels across them (`light` 0 → 1). `trace` draws a glint of
 * light along the edge; `reveal` fades in the full form; `color` brings in the
 * brand colours.
 */
export function Emblem({ size, light = 0.5, trace = -1, reveal = 1, color = 0, id }: { size: number; light?: number; trace?: number; reveal?: number; color?: number; id: string }) {
  const lx = -300 + light * 900;
  return (
    <svg viewBox="-7 4 280 480" style={{ width: size * (280 / 480), height: size, overflow: "visible" }} fill="none" strokeLinecap="round">
      <defs>
        <linearGradient id={`metal-${id}`} gradientUnits="userSpaceOnUse" x1={lx - 220} y1={0} x2={lx + 220} y2={480}>
          <stop offset="0" stopColor="#3a3a3f" />
          <stop offset="0.42" stopColor="#8d8d93" />
          <stop offset="0.5" stopColor="#f2f2f5" />
          <stop offset="0.58" stopColor="#8d8d93" />
          <stop offset="1" stopColor="#2e2e33" />
        </linearGradient>
        <filter id={`glow-${id}`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
      </defs>
      {/* Depth: the stroke's body, stepping back. */}
      <g opacity={reveal}>
        {[6, 5, 4, 3, 2, 1].map((k) => (
          <g key={k} transform={`translate(${k * 0.9} ${k * 1.3})`}>
            {PATHS.map((d, i) => <path key={i} d={d} stroke={`rgb(${14 + k * 3},${14 + k * 3},${17 + k * 3})`} strokeWidth={30} />)}
          </g>
        ))}
        {PATHS.map((d, i) => <path key={i} d={d} stroke={`url(#metal-${id})`} strokeWidth={30} />)}
        {/* A fine bevel highlight along the top edge. */}
        {PATHS.map((d, i) => <path key={`b${i}`} d={d} stroke="rgba(255,255,255,0.35)" strokeWidth={1.4} transform="translate(-1.2 -1.6)" />)}
        {color > 0 && PATHS.map((d, i) => <path key={`c${i}`} d={d} stroke={BRAND[i]} strokeWidth={30} opacity={color * (i === 2 ? 0.55 : 0.92)} />)}
      </g>
      {/* The first light: a faint trace of the edge, and the glint that draws it. */}
      {trace >= 0 && (
        <>
          {PATHS.map((d, i) => {
            const p = c01(trace * 3 - i);
            return <path key={`t${i}`} d={d} pathLength={1} stroke="rgba(235,235,240,0.55)" strokeWidth={1.6} strokeDasharray="1 1" strokeDashoffset={1 - p} />;
          })}
          {PATHS.map((d, i) => {
            const p = trace * 3 - i;
            if (p <= 0 || p >= 1.05) return null;
            return (
              <g key={`g${i}`}>
                <path d={d} pathLength={1} stroke="#fff" strokeWidth={10} strokeDasharray="0.05 1" strokeDashoffset={0.05 - p} filter={`url(#glow-${id})`} opacity={0.9} />
                <path d={d} pathLength={1} stroke="#fff" strokeWidth={2.5} strokeDasharray="0.04 1" strokeDashoffset={0.04 - p} />
              </g>
            );
          })}
        </>
      )}
    </svg>
  );
}

/* ───────────────────────── the display ───────────────────────── */

/**
 * A dark glass display: an anodised frame with a soft rim highlight, a black
 * glass bezel, the screen (a stack of crossfading screenshots) and a glare that
 * moves with the light. `power` turns the screen on; `lit` brings the body out
 * of the dark.
 */
export function Display({ layers, power, lit, glare, children, w = SCREEN.w, rim = 0.5 }: { layers: { src: string; o: number }[]; power: number; lit: number; glare: number; children?: React.ReactNode; w?: number; rim?: number }) {
  const h = (w * 10) / 16;
  const R = w * 0.03;
  return (
    <div style={{ position: "relative", width: w + 2 * BEZEL, height: h + 2 * BEZEL, borderRadius: R + BEZEL, background: "linear-gradient(180deg, #2a2a2e, #0d0d10 40%, #08080a)", boxShadow: `inset 0 0 0 1px rgba(255,255,255,${0.05 + lit * 0.12}), 0 50px 120px -30px rgba(0,0,0,0.9)`, opacity: c01(lit * 1.4) }}>
      {/* Rim light along the top edge, travelling with the light. */}
      <div style={{ position: "absolute", left: R, right: R, top: 0, height: 1.5, background: `linear-gradient(90deg, transparent ${rim * 100 - 35}%, rgba(255,255,255,${0.75 * lit}) ${rim * 100}%, transparent ${rim * 100 + 35}%)` }} />
      <div style={{ position: "absolute", inset: BEZEL, borderRadius: R, overflow: "hidden", background: "#000" }}>
        {layers.map((l, i) => l.o > 0.001 && <Img key={i} src={l.src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: l.o, filter: `brightness(${0.06 + power * 0.88}) saturate(${0.75 + power * 0.15})` }} />)}
        {children}
        {/* The glass: a faint diagonal glare that slides as the light moves. */}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(115deg, transparent ${glare * 100 - 22}%, rgba(255,255,255,0.07) ${glare * 100}%, transparent ${glare * 100 + 22}%)` }} />
        <div style={{ position: "absolute", inset: 0, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.04)" }} />
      </div>
    </div>
  );
}

/** A phone in the same materials. */
export function Handset({ src, power, lit }: { src: string; power: number; lit: number }) {
  const w = 300, h = 650;
  return (
    <div style={{ width: w, height: h, borderRadius: 54, padding: 11, background: "linear-gradient(180deg, #2c2c30, #0b0b0d)", boxShadow: `inset 0 0 0 1px rgba(255,255,255,${0.06 + lit * 0.14}), 0 40px 90px -20px rgba(0,0,0,0.9)`, opacity: c01(lit * 1.4) }}>
      <div style={{ position: "relative", width: "100%", height: "100%", borderRadius: 44, overflow: "hidden", background: "#000" }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0", filter: `brightness(${0.06 + power * 0.88})` }} />
        <div style={{ position: "absolute", top: 12, left: "50%", width: 92, height: 26, marginLeft: -46, borderRadius: 99, background: "#000" }} />
      </div>
    </div>
  );
}

/* ───────────────────────── type ───────────────────────── */

/** The title block: one headline, one supporting line, in the same place every time. */
export function TitleBlock({ t, a, b, h1, sub, sub2 }: { t: number; a: number; b: number; h1: string; sub?: string; sub2?: boolean }) {
  const i = seg(t, a, a + 0.9, soft);
  const j = seg(t, a + 0.45, a + 1.35, soft);
  const o = seg(t, b - 0.6, b, soft);
  if (i <= 0 || o >= 1) return null;
  const line = (p: number): React.CSSProperties => ({ opacity: p * (1 - o), transform: `translateY(${(1 - p) * 10}px)`, filter: `blur(${(1 - p) * 6 + o * 6}px)` });
  return (
    <div style={{ position: "absolute", left: 160, right: 160, top: 132, textAlign: "center", fontFamily: FONT }}>
      <div style={{ fontSize: 80, fontWeight: 600, letterSpacing: "-0.028em", lineHeight: 1.05, color: INK, ...line(i) }}>{h1}</div>
      {sub && <div style={{ marginTop: sub2 ? 0 : 22, fontSize: sub2 ? 80 : 30, fontWeight: sub2 ? 600 : 400, letterSpacing: sub2 ? "-0.028em" : "-0.005em", lineHeight: sub2 ? 1.05 : 1.3, color: GREY, ...line(j) }}>{sub}</div>}
    </div>
  );
}

/* ───────────────────────── the film ───────────────────────── */

const ARRAY: [string, number][] = [["crm-deals", -3], ["hrms-payroll", -2], ["inventory-home", -1], ["projects-board", 1], ["accounting-pl", 2], ["notes-editor", 3], ["chat-channel", -4], ["store-products", 4]];

export const Film: React.FC = () => {
  const f = useCurrentFrame();
  const t = f / 30;

  /* — Act I: the mark — */
  const inMark = t < ACTS.mark[1] + 0.6;
  const trace = seg(t, 1.5, 6.2, (x) => x);
  const markReveal = seg(t, 5.6, 9.2, soft);
  const markLight = kf(t, [[6.5, 0], [10.5, 1], [14, 0.62]], soft);
  const markCam = { s: kf(t, [[0, 3.1], [5.5, 2.6], [10.5, 1.1], [13, 1.0]]), cx: kf(t, [[0, 900], [5.5, 960], [10.5, 960]]), cy: kf(t, [[0, 330], [5.5, 380], [10.5, 470]]), ry: kf(t, [[0, -34], [11, -10], [14, 0]]) };
  const markLift = seg(t, 12.6, 14.2);
  const wordmark = seg(t, 13.1, 14.3, soft);
  const wordOut = seg(t, 16.6, 17.4, soft);
  const toScreen = seg(t, 17.0, 18.6); // the emblem shrinks into the display's screen
  const emblemSize = interpolate(toScreen, [0, 1], [300, 92]);
  const emblemY = interpolate(toScreen, [0, 1], [interpolate(markLift, [0, 1], [470, 380]), SCREEN.y + SCREEN.h / 2]);

  /* — The display, from 18 s to the signature — */
  const dev = t >= ACTS.device[0] - 0.4 && t < ACTS.signature[1];
  const lit = seg(t, 18.0, 19.6, soft) * (1 - seg(t, 74.0, 75.8, soft));
  const power = seg(t, 19.5, 20.4, soft) * (1 - seg(t, 72.0, 72.7, soft) * 0.92);
  const boot = seg(t, 18.4, 18.9) * (1 - seg(t, 20.3, 20.8)); // the emblem as boot mark
  // Screen layers crossfade at each change.
  const layers = SCREENS.map(([at, src], i) => {
    const next = SCREENS[i + 1]?.[0];
    const o = seg(t, at, at + 0.7, soft) * (next !== undefined ? 1 - seg(t, next, next + 0.7, soft) : 1);
    return { src: shot(src), o };
  });
  // After the AI beat the screen returns to the dashboard for the array and the climax.
  const homeAgain = seg(t, 56.0, 56.8, soft);
  layers.forEach((l, i) => { if (i === layers.length - 1) l.o *= 1 - homeAgain; });
  layers.push({ src: shot("home-dashboard"), o: homeAgain });
  // The device's own pose.
  const ry = kf(t, [[18, 26], [22, 3], [33.4, 3], [34.4, -7], [36.5, -7], [37.5, 0], [56.5, 0], [60, -6], [64, 4], [66.5, 0]]);
  const rx = kf(t, [[18, 8], [22, 2], [56, 2], [66.5, 0]]);
  const dx = kf(t, [[33.4, 0], [34.4, -170], [36.6, -170], [37.4, 0]]);
  const devScale = kf(t, [[18, 0.94], [22, 1], [64, 1], [65.6, 0.92], [72, 0.92], [73, 1]]);
  // The camera over the stage: macro close-ups of the real product.
  const P = (px: number, py: number, off = 0) => onScreen(px, py, off);
  const C = { x: 960, y: 540 };
  const camKeys: [number, number, number, number][] = [
    // [time, scale, cx, cy] — each feature: a close-up of the real screen, then back to the full display for its headline.
    [18, 1, C.x, C.y], [24.2, 1, C.x, C.y],
    [25.2, 1.9, P(0.5, 0.33).x, P(0.5, 0.33).y], [27.0, 1.95, P(0.52, 0.34).x, P(0.52, 0.34).y], [28.1, 1, C.x, C.y],
    [30.6, 1, C.x, C.y], [31.6, 1.75, P(0.82, 0.62).x, P(0.82, 0.62).y], [33.2, 1.78, P(0.82, 0.6).x, P(0.82, 0.6).y], [34.3, 1, C.x + 60, C.y], [36.6, 1, C.x + 60, C.y], [37.3, 1, C.x, C.y],
    [38.2, 2.3, P(0.27, 0.27).x, P(0.27, 0.27).y], [39.8, 2.34, P(0.28, 0.27).x, P(0.28, 0.27).y], [40.7, 1, C.x, C.y], [43.5, 1, C.x, C.y],
    [44.5, 1.85, P(0.68, 0.32).x, P(0.68, 0.32).y], [46.2, 1.88, P(0.68, 0.33).x, P(0.68, 0.33).y], [47.1, 1, C.x, C.y], [50.0, 1, C.x, C.y],
    [51.0, 2.2, P(0.67, 0.27).x, P(0.67, 0.27).y], [53.2, 2.24, P(0.67, 0.27).x, P(0.67, 0.27).y], [54.2, 1, C.x, C.y], [56.5, 1, C.x, C.y],
    [59.5, 0.56, 960, 560], [63.4, 0.58, 960, 560], [65.4, 1, C.x, C.y], [76, 1, C.x, C.y],
  ];

  const cs = kf(t, camKeys.map((k) => [k[0], k[1]]));
  const ccx = kf(t, camKeys.map((k) => [k[0], k[2]]));
  const ccy = kf(t, camKeys.map((k) => [k[0], k[3]]));
  const camRy = kf(t, [[56.5, 0], [59, 9], [63.5, -7], [65.5, 0]]);
  const zoomed = c01((cs - 1) / 0.6);
  // The light that moves across the scene.
  const glare = kf(t, [[18, -0.2], [22, 1.2], [56, 0.3], [64, 0.2], [67, 1.2]], soft);
  const rim = kf(t, [[18, 0], [21, 1], [64, 0], [67.5, 1]], soft);
  // The array: every module emerging from the dark, then converging.
  const arrIn = (k: number) => seg(t, 57.0 + k * 0.16, 58.4 + k * 0.16, soft);
  const converge = seg(t, 63.6, 65.4);
  // The climax light.
  const bloom = seg(t, 65.4, 66.6, soft) * (1 - seg(t, 71.4, 72.6, soft));
  // The phone during "sell".
  const phone = seg(t, 33.6, 34.7) * (1 - seg(t, 36.6, 37.3));
  // The AI highlight, on the screen.
  const flag = seg(t, 51.4, 52.2, soft) * (1 - seg(t, 55.9, 56.4));

  /* — Act V: the signature — */
  const sigEmblem = seg(t, 72.8, 73.6, soft);
  const sigUp = seg(t, 74.2, 76.2);
  const sigColor = seg(t, 76.2, 77.4, soft);
  const lock = seg(t, 77.0, 78.0); // the emblem settles into the wordmark
  const letters = seg(t, 77.4, 78.6, soft);
  const fadeAll = 1 - seg(t, 80.6, 81.9, soft);

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, overflow: "hidden" }}>
      {/* A barely-there pool of light the product sits in. */}
      <AbsoluteFill style={{ background: "radial-gradient(60% 55% at 50% 58%, rgba(70,72,82,0.28), transparent 70%)", opacity: c01(markReveal * 0.6 + lit * 0.6) * fadeAll }} />

      {/* ACT I — a line of light finds the emblem; the camera pulls back to reveal its form. */}
      {inMark && (
        <AbsoluteFill style={{ opacity: 1 - seg(t, 18.4, 18.9) }}>
          <AbsoluteFill style={{ transformOrigin: "0 0", transform: `perspective(2400px) translate(960px, 540px) scale(${markCam.s}) translate(${-markCam.cx}px, ${-markCam.cy}px)` }}>
            <div style={{ position: "absolute", left: 960, top: emblemY, transform: `translate(-50%, -50%) perspective(1600px) rotateY(${markCam.ry * (1 - toScreen)}deg)`, filter: `drop-shadow(0 30px 40px rgba(0,0,0,0.8))` }}>
              <Emblem id="mark" size={emblemSize} trace={t < 9 ? trace : -1} reveal={markReveal} light={markLight} />
            </div>
          </AbsoluteFill>
          <div style={{ position: "absolute", left: 0, right: 0, top: 640, textAlign: "center", fontSize: 96, fontWeight: 500, letterSpacing: "-0.03em", color: INK, opacity: wordmark * (1 - wordOut), filter: `blur(${(1 - wordmark) * 8}px)`, transform: `translateY(${(1 - wordmark) * 12}px)` }}>cloudesk</div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 780, textAlign: "center", fontSize: 30, fontWeight: 400, color: GREY, opacity: seg(t, 15.0, 15.9, soft) * (1 - wordOut) }}>One workspace for everything you run.</div>
        </AbsoluteFill>
      )}

      {/* THE DISPLAY — and everything after it. */}
      {dev && (
        <AbsoluteFill style={{ opacity: fadeAll }}>
          <AbsoluteFill style={{ transformOrigin: "0 0", transform: `perspective(2600px) translate(960px, 540px) scale(${cs}) rotateY(${camRy}deg) translate(${-ccx}px, ${-ccy}px)` }}>
            {/* The climax bloom: soft white light behind the display. */}
            <div style={{ position: "absolute", left: 960 - 900, top: 630 - 520, width: 1800, height: 1040, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(230,232,240,0.22), transparent)", opacity: bloom + power * 0.35 }} />
            {/* The array, on an arc around the display. */}
            {t >= 56.8 && t < 66 && ARRAY.map(([src, k], i) => {
              const a = arrIn(i) * (1 - converge);
              const ang = k * 15;
              return (
                <div key={src} style={{ position: "absolute", left: SCREEN.x - BEZEL, top: SCREEN.y - BEZEL, transformStyle: "preserve-3d", transform: `translateZ(-2600px) rotateY(${ang * (1 - converge)}deg) translateZ(${2600 - (1 - a) * 300}px)`, opacity: a }}>
                  <Display layers={[{ src: shot(src), o: 1 }]} power={0.85 * a} lit={a} glare={0.5} rim={0.5} />
                </div>
              );
            })}
            {/* The floor reflection. */}
            <div style={{ position: "absolute", left: SCREEN.x - BEZEL + dx, top: SCREEN.y + SCREEN.h + BEZEL * 2 + 6, transform: `scaleY(-1) perspective(2000px) rotateY(${ry}deg) scale(${devScale})`, transformOrigin: "50% 0", opacity: 0.14 * lit * (1 - zoomed), WebkitMaskImage: "linear-gradient(to top, #000, transparent 38%)", maskImage: "linear-gradient(to top, #000, transparent 38%)" }}>
              <Display layers={layers} power={power} lit={lit} glare={glare} rim={rim} />
            </div>
            {/* The display. */}
            <div style={{ position: "absolute", left: SCREEN.x - BEZEL + dx, top: SCREEN.y - BEZEL, transform: `perspective(2000px) rotateY(${ry}deg) rotateX(${rx}deg) scale(${devScale})` }}>
              <Display layers={layers} power={power} lit={lit} glare={glare} rim={rim}>
                {/* The boot mark: the emblem, now on the screen. */}
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: boot + sigEmblem * (1 - seg(t, 74.0, 74.2)) }}><Emblem id="boot" size={92} light={0.55} /></div>
                {/* The duplicate bill Copilot found, outlined where it sits on the screen. */}
                <div style={{ position: "absolute", left: `${35.4}%`, top: `${22.2}%`, width: `${62.8}%`, height: `${7.4}%`, borderRadius: 8, boxShadow: `0 0 0 1.5px rgba(255,90,95,${0.95 * flag}), 0 0 24px rgba(255,90,95,${0.35 * flag})` }} />
              </Display>
            </div>
            {/* The phone, beside the display while selling. */}
            {phone > 0 && (
              <div style={{ position: "absolute", left: 1440 - 70, top: 340, transform: `translateX(${(1 - phone) * 260}px) perspective(1600px) rotateY(${-12 + phone * 4}deg)`, opacity: phone }}>
                <Handset src={shot("store-sf-phone")} power={phone} lit={phone} />
              </div>
            )}
          </AbsoluteFill>
          {/* Keep the title block clear of the product when the camera is close. */}
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(3,3,4,0.96) 0%, rgba(3,3,4,0.86) 22%, transparent 34%)", opacity: 0.35 + zoomed * 0.65 }} />
        </AbsoluteFill>
      )}

      {/* The title blocks, one idea at a time. */}
      <TitleBlock t={t} a={27.8} b={30.4} h1="Built from a sentence." sub="Your website and online store, in minutes." />
      <TitleBlock t={t} a={34.3} b={36.9} h1="Sell anywhere." sub="UPI, cards and GST invoices — built in." />
      <TitleBlock t={t} a={40.6} b={43.4} h1="Every number, live." sub="Invoicing, accounting and payments, together." />
      <TitleBlock t={t} a={47.0} b={49.9} h1="Your whole team, in sync." sub="Mail, calendar, chat and notes." />
      <TitleBlock t={t} a={54.0} b={56.4} h1="It notices what you'd miss." sub="Copilot flags a duplicate bill before it's paid." />
      <TitleBlock t={t} a={58.6} b={63.4} h1="30+ modules. One login." sub="Switch on only what you need." />
      <TitleBlock t={t} a={66.0} b={71.6} h1="Your entire business." sub="Beautifully run." sub2 />

      {/* ACT V — the signature. */}
      {t >= 74.0 && (
        <AbsoluteFill style={{ opacity: fadeAll }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 430, display: "flex", justifyContent: "center", alignItems: "center", fontSize: 150, fontWeight: 500, letterSpacing: "-0.03em", color: INK, lineHeight: 1 }}>
            <span style={{ opacity: letters, transform: `translateX(${(1 - letters) * 18}px)`, filter: `blur(${(1 - letters) * 8}px)` }}>clou</span>
            <span style={{ display: "inline-block", width: 112, height: 165, position: "relative", margin: "0 2px 0 6px", transform: "translateY(10px)" }}>
              {/* The emblem: from the screen's centre, up to the stage, then into its place in the name. */}
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${(1 - lock) * -34}px, ${interpolate(sigUp, [0, 1], [115, -60]) * (1 - lock)}px) scale(${interpolate(sigUp, [0, 1], [0.557, 1.6]) * (1 - lock) + lock})`, filter: `drop-shadow(0 20px 30px rgba(0,0,0,0.8))` }}>
                <Emblem id="sig" size={165} light={kf(t, [[74, 0.2], [77, 0.9]], soft)} color={sigColor} />
              </div>
            </span>
            <span style={{ opacity: letters, transform: `translateX(${(1 - letters) * -18}px)`, filter: `blur(${(1 - letters) * 8}px)` }}>esk</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 690, textAlign: "center", fontSize: 34, fontWeight: 500, letterSpacing: "-0.01em", color: INK, opacity: seg(t, 78.6, 79.4, soft) }}>Start free.</div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 746, textAlign: "center", fontSize: 18, fontWeight: 500, letterSpacing: "0.12em", color: LABEL, textTransform: "uppercase", opacity: seg(t, 79.0, 79.8, soft) }}>30-day free trial · No card needed</div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
