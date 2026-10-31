// The building blocks every scene shares, in the site's own look: SF Pro at a
// light weight with tight tracking, the logo gradient on the words that matter,
// the hero's violet/coral/sky mesh with its faint grid, and frosted glass —
// panels, pills, app windows in glass bezels and floating glass orbs.
import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export const C = {
  canvas: "#f7f6f3",
  ink: "#121216",
  muted: "rgba(18,18,22,0.56)",
  red: "#FF5A5F",
  amber: "#FDBA5A",
  coral: "#ff6a55",
  violet: "#7c5cff",
  sky: "#38bdf8",
  night: "#0b0a10",
  mint: "#d4f0e3",
  mintInk: "#1f7a55",
  lavender: "#e6e0fb",
  lavInk: "#5b4bb7",
  skyBg: "#d9e8fb",
  skyInk: "#2563a8",
  peach: "#fde3d4",
  peachInk: "#b4542d",
  butter: "#fbefcb",
  butterInk: "#8a6412",
  rose: "#fbdfe8",
  roseInk: "#a3355a",
};
export const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", Inter, "Helvetica Neue", Arial, sans-serif';
/** The logo gradient (mk-logo-gradient on the site). */
export const GRADIENT = "linear-gradient(100deg, #f5474e 0%, #ff6a55 25%, #f39a2e 50%, #ff6a55 75%, #f5474e 100%)";

export const ease = Easing.bezier(0.22, 1, 0.36, 1);
export const easeInOut = Easing.bezier(0.65, 0, 0.35, 1);
export const shot = (name: string) => staticFile(`shots/${name}.jpg`);
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const ramp = (f: number, a: number, b: number, e = ease) => interpolate(f, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: e });

/** A spring from 0 to 1 starting at `delay` frames. */
export function useRise(delay = 0, opts: { damping?: number; stiffness?: number; mass?: number } = {}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping: opts.damping ?? 18, stiffness: opts.stiffness ?? 120, mass: opts.mass ?? 0.9 } });
}
/** A bouncier spring for the playful bits. */
export const usePop = (delay = 0) => useRise(delay, { damping: 10, stiffness: 170, mass: 0.7 });

/* ───────────── Brand ───────────── */

/** The cloud "d": red stem and crown, amber side, dark base — drawn in as `draw` goes 0→1. */
export function CloudD({ size = 120, draw = 1, base = C.ink, glow = false, width = 28 }: { size?: number; draw?: number; base?: string; glow?: boolean; width?: number }) {
  const seg = (len: number, from: number, to: number) => {
    const p = clamp01((draw - from) / (to - from));
    return { strokeDasharray: len, strokeDashoffset: len * (1 - p) };
  };
  return (
    <svg viewBox="14 9 292 459" style={{ height: size, width: size * (292 / 459), overflow: "visible", filter: glow ? "drop-shadow(0 18px 40px rgba(255,90,95,0.35))" : undefined }} fill="none" strokeWidth={width} strokeLinecap="round">
      <path d="M28 387V90A67 67 0 0 1 95 23" stroke={C.red} style={seg(420, 0, 0.4)} />
      <path d="M95 23A67 67 0 0 1 161 102A100 100 0 0 1 238 282" stroke={C.amber} style={seg(480, 0.3, 0.72)} />
      <path d="M238 282A72 72 0 0 1 162 398A67 67 0 0 1 28 387" stroke={base} strokeOpacity={0.78} style={seg(420, 0.6, 1)} />
    </svg>
  );
}

/** "clou" + the cloud d + "esk". */
export function Wordmark({ size = 120, draw = 1, color = C.ink, letters = 1 }: { size?: number; draw?: number; color?: string; letters?: number }) {
  const l = clamp01(letters);
  return (
    <div style={{ display: "flex", alignItems: "center", fontFamily: FONT, fontSize: size, fontWeight: 500, letterSpacing: "-0.03em", color, lineHeight: 1 }}>
      <span style={{ opacity: l, transform: `translateX(${(1 - l) * 50}px)`, filter: `blur(${(1 - l) * 12}px)` }}>clou</span>
      <span style={{ margin: "0 0.01em 0 0.03em", transform: "translateY(0.06em)" }}><CloudD size={size * 1.1} draw={draw} base={color} /></span>
      <span style={{ opacity: l, transform: `translateX(${(1 - l) * -50}px)`, filter: `blur(${(1 - l) * 12}px)` }}>esk</span>
    </div>
  );
}

/* ───────────── Backgrounds ───────────── */

/** The hero mesh: soft violet, coral and sky light drifting, a faint grid, a whisper of grain. */
export function Backdrop({ dark = false, grid = true }: { dark?: boolean; grid?: boolean }) {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const blobs: [string, number][] = dark
    ? [["124,92,255", 0.55], ["255,106,85", 0.42], ["56,189,248", 0.3], ["253,186,90", 0.22]]
    : [["139,124,255", 0.34], ["255,148,112", 0.3], ["56,189,248", 0.22], ["253,186,90", 0.2]];
  const pos = [[14, 6], [88, 12], [52, 100], [8, 86]];
  const line = dark ? "rgba(255,255,255,0.05)" : "rgba(120,120,140,0.08)";
  return (
    <AbsoluteFill style={{ background: dark ? C.night : C.canvas, overflow: "hidden" }}>
      {blobs.map(([rgb, a], i) => {
        const [x, y] = pos[i]!;
        const dx = Math.sin(t * 0.35 + i * 1.7) * 7;
        const dy = Math.cos(t * 0.3 + i * 2.1) * 6;
        return <div key={i} style={{ position: "absolute", left: `${x! + dx - 35}%`, top: `${y! + dy - 35}%`, width: "70%", height: "70%", borderRadius: "50%", background: `radial-gradient(closest-side, rgba(${rgb},${a}), rgba(${rgb},0))` }} />;
      })}
      {grid && (
        <AbsoluteFill
          style={{
            backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
            backgroundSize: "72px 72px",
            backgroundPosition: `0 ${(frame * 0.4) % 72}px`,
            maskImage: "radial-gradient(80% 65% at 50% 35%, #000 20%, transparent 80%)",
            WebkitMaskImage: "radial-gradient(80% 65% at 50% 35%, #000 20%, transparent 80%)",
          }}
        />
      )}
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.04) 1px, transparent 1px)", backgroundSize: "3px 3px", opacity: dark ? 0.6 : 0.4 }} />
    </AbsoluteFill>
  );
}

/** A floating glass sphere — frosted, with a rim light and a coloured core. */
export function Orb({ x, y, size, tint = "255,106,85", delay = 0, drift = 1 }: { x: number; y: number; size: number; tint?: string; delay?: number; drift?: number }) {
  const frame = useCurrentFrame();
  const p = usePop(delay);
  const fy = Math.sin((frame + delay * 7) / 38) * 18 * drift;
  const fx = Math.cos((frame + delay * 5) / 46) * 12 * drift;
  return (
    <div
      style={{
        position: "absolute",
        left: x - size / 2 + fx,
        top: y - size / 2 + fy,
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 30% 25%, rgba(255,255,255,0.95), rgba(255,255,255,0.25) 22%, rgba(${tint},0.45) 60%, rgba(${tint},0.85) 100%)`,
        boxShadow: `inset -${size * 0.06}px -${size * 0.08}px ${size * 0.18}px rgba(${tint},0.6), inset ${size * 0.04}px ${size * 0.05}px ${size * 0.1}px rgba(255,255,255,0.8), 0 ${size * 0.25}px ${size * 0.5}px -${size * 0.15}px rgba(${tint},0.55)`,
        opacity: clamp01(p * 1.3),
        transform: `scale(${p})`,
      }}
    />
  );
}

/* ───────────── Type ───────────── */

type Part = string | { text: string; gradient?: boolean; color?: string; weight?: number };

/**
 * A headline in the site's style (light weight, tight tracking). Each word rises
 * out of a mask with a soft spring; gradient words carry the logo gradient, sweeping.
 */
export function Headline({ parts, delay = 0, size = 96, weight = 360, color = C.ink, align = "center", stagger = 3, maxWidth, lineHeight = 1.06, style }: { parts: Part[]; delay?: number; size?: number; weight?: number; color?: string; align?: "center" | "left"; stagger?: number; maxWidth?: number; lineHeight?: number; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const words: { w: string; g: boolean; c?: string; wt?: number }[] = [];
  for (const p of parts) {
    const o = typeof p === "string" ? { text: p } : p;
    for (const w of o.text.split(" ").filter(Boolean)) words.push({ w, g: "gradient" in o && !!o.gradient, c: "color" in o ? o.color : undefined, wt: "weight" in o ? o.weight : undefined });
  }
  return (
    <div style={{ fontFamily: FONT, fontSize: size, fontWeight: weight, letterSpacing: "-0.045em", lineHeight, color, textAlign: align, display: "flex", flexWrap: "wrap", justifyContent: align === "center" ? "center" : "flex-start", columnGap: size * 0.24, maxWidth, ...style }}>
      {words.map((o, i) => {
        const p = spring({ frame: frame - delay - i * stagger, fps, config: { damping: 22, stiffness: 120, mass: 0.9 } });
        return (
          <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: size * 0.14, marginBottom: -size * 0.14, paddingRight: size * 0.05, marginRight: -size * 0.05 }}>
            <span
              style={{
                display: "inline-block",
                transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 6}deg)`,
                transformOrigin: "0% 100%",
                opacity: clamp01(p * 2),
                color: o.c,
                fontWeight: o.wt,
                ...(o.g ? { backgroundImage: GRADIENT, backgroundSize: "200% 100%", backgroundPosition: `${(frame * 1.4) % 200}% 0`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" } : {}),
              }}
            >
              {o.w}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** The hero's "New" pill: a dark tag and a line of text, in glass. */
export function Kicker({ tag, children, delay = 0, dark = false }: { tag?: string; children: React.ReactNode; delay?: number; dark?: boolean }) {
  const p = useRise(delay, { damping: 16, stiffness: 140 });
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        padding: tag ? "8px 22px 8px 8px" : "10px 22px",
        borderRadius: 999,
        fontFamily: FONT,
        fontSize: 22,
        fontWeight: 450,
        letterSpacing: "-0.01em",
        color: dark ? "rgba(255,255,255,0.8)" : "rgba(18,18,22,0.68)",
        background: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.55)",
        backdropFilter: "blur(20px) saturate(180%)",
        boxShadow: dark ? "inset 0 0 0 1px rgba(255,255,255,0.14)" : "inset 0 0 0 1px rgba(255,255,255,0.9), 0 0 0 1px rgba(18,18,22,0.06), 0 12px 30px -16px rgba(30,20,70,0.3)",
        opacity: clamp01(p * 1.5),
        transform: `translateY(${(1 - p) * 20}px) scale(${0.92 + p * 0.08})`,
      }}
    >
      {tag && <span style={{ padding: "5px 12px", borderRadius: 999, fontSize: 15, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: dark ? C.ink : "#fff", background: dark ? "#fff" : C.ink }}>{tag}</span>}
      {children}
    </div>
  );
}

/** A line of supporting text that fades up. */
export function Sub({ children, delay = 0, size = 30, color = C.muted, style }: { children: React.ReactNode; delay?: number; size?: number; color?: string; style?: React.CSSProperties }) {
  const p = useRise(delay, { damping: 20 });
  return <div style={{ fontFamily: FONT, fontSize: size, fontWeight: 380, letterSpacing: "-0.015em", lineHeight: 1.4, color, opacity: p, transform: `translateY(${(1 - p) * 18}px)`, filter: `blur(${(1 - p) * 6}px)`, ...style }}>{children}</div>;
}

/* ───────────── Glass ───────────── */

const glassLight: React.CSSProperties = {
  background: "linear-gradient(145deg, rgba(255,255,255,0.72), rgba(255,255,255,0.42))",
  backdropFilter: "blur(28px) saturate(180%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), inset 0 0 0 1px rgba(255,255,255,0.55), 0 0 0 1px rgba(18,18,22,0.06), 0 40px 80px -36px rgba(30,20,70,0.42)",
};
const glassDark: React.CSSProperties = {
  background: "linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.05))",
  backdropFilter: "blur(28px) saturate(160%)",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), inset 0 0 0 1px rgba(255,255,255,0.12), 0 40px 80px -30px rgba(0,0,0,0.6)",
};
export const glass = (dark = false): React.CSSProperties => (dark ? glassDark : glassLight);

/** A frosted panel that springs in. Absolutely positioned. */
export function Glass({ children, style, delay = 0, from = "bottom", dark = false, radius = 28 }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number; from?: "bottom" | "left" | "right" | "pop"; dark?: boolean; radius?: number }) {
  const pop = usePop(delay);
  const rise = useRise(delay, { damping: 17, stiffness: 120 });
  const p = from === "pop" ? pop : rise;
  const dx = from === "left" ? -70 : from === "right" ? 70 : 0;
  const dy = from === "bottom" ? 50 : 0;
  const s = from === "pop" ? 0.6 + p * 0.4 : 0.94 + p * 0.06;
  return (
    <div style={{ position: "absolute", borderRadius: radius, fontFamily: FONT, color: dark ? "#fff" : C.ink, ...glass(dark), opacity: clamp01(p * 1.5), transform: `translate(${(1 - p) * dx}px, ${(1 - p) * dy}px) scale(${s})`, ...style }}>
      {children}
    </div>
  );
}

/** A glass pill with an icon, popping in with a little bounce and bobbing. */
export function Chip({ icon, children, delay = 0, x, y, size = 26, float = true, dark = false, style }: { icon?: React.ReactNode; children: React.ReactNode; delay?: number; x?: number; y?: number; size?: number; float?: boolean; dark?: boolean; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const p = usePop(delay);
  const bob = float ? Math.sin((frame - delay) / 20) * 6 : 0;
  return (
    <div
      style={{
        position: x !== undefined ? "absolute" : "relative",
        left: x,
        top: y,
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.45,
        padding: `${size * 0.42}px ${size * 0.8}px ${size * 0.42}px ${icon ? size * 0.42 : size * 0.8}px`,
        borderRadius: 999,
        fontFamily: FONT,
        fontSize: size,
        fontWeight: 500,
        letterSpacing: "-0.015em",
        whiteSpace: "nowrap",
        color: dark ? "#fff" : C.ink,
        ...glass(dark),
        opacity: clamp01(p * 1.6),
        transform: `translateY(${(1 - p) * 30 + bob}px) scale(${0.5 + p * 0.5}) rotate(${(1 - p) * -8}deg)`,
        ...style,
      }}
    >
      {icon && <span style={{ width: size * 1.55, height: size * 1.55, borderRadius: 999, display: "grid", placeItems: "center", background: dark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.9)", boxShadow: "0 0 0 1px rgba(18,18,22,0.06)" }}>{icon}</span>}
      {children}
    </div>
  );
}

/* ───────────── Devices ───────────── */

/** An app window in a frosted glass bezel: tilts up in 3D and settles, with an optional slow zoom. */
export function Window({ src, width = 1240, delay = 0, tilt = 14, title = "Cloudesk", zoom, children, style, dark = false }: { src: string; width?: number; delay?: number; tilt?: number; title?: string; zoom?: { from: number; to: number; x: number; y: number; start?: number; end?: number }; children?: React.ReactNode; style?: React.CSSProperties; dark?: boolean }) {
  const frame = useCurrentFrame();
  const p = useRise(delay, { damping: 22, stiffness: 70 });
  const h = width * (1800 / 2880);
  const z = zoom ? interpolate(frame, [zoom.start ?? delay + 10, zoom.end ?? delay + 160], [zoom.from, zoom.to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut }) : 1;
  return (
    <div style={{ perspective: 2400, ...style }}>
      <div
        style={{
          width: width + 24,
          padding: 12,
          borderRadius: 30,
          ...glass(dark),
          opacity: clamp01(p * 1.4),
          transform: `translateY(${(1 - p) * 140}px) rotateX(${(1 - p) * tilt}deg) scale(${0.9 + p * 0.1})`,
          transformOrigin: "50% 100%",
        }}
      >
        <div style={{ borderRadius: 20, overflow: "hidden", background: "#fff", boxShadow: "0 0 0 1px rgba(18,18,22,0.08)" }}>
          <div style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 14px", borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(250,249,247,0.96)" }}>
            {["#ff5f57", "#febc2e", "#28c840"].map((c) => <span key={c} style={{ width: 11, height: 11, borderRadius: 99, background: c }} />)}
            <span style={{ margin: "0 auto", fontFamily: FONT, fontSize: 14, fontWeight: 450, color: "rgba(0,0,0,0.45)", background: "rgba(0,0,0,0.045)", padding: "4px 18px", borderRadius: 99 }}>{title}</span>
          </div>
          <div style={{ position: "relative", height: h, overflow: "hidden" }}>
            {/* Overlays zoom with the screen so they stay on what they point at. */}
            <div style={{ position: "absolute", inset: 0, transform: zoom ? `scale(${z})` : undefined, transformOrigin: zoom ? `${zoom.x}% ${zoom.y}%` : undefined }}>
              <Img src={src} style={{ width: "100%", display: "block" }} />
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A phone with a screen. */
export function Phone({ src, width = 360, delay = 0, style }: { src: string; width?: number; delay?: number; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const p = useRise(delay, { damping: 18, stiffness: 80 });
  const h = width * (874 / 402);
  const bob = Math.sin((frame - delay) / 30) * 8;
  return (
    <div style={{ width, height: h, borderRadius: width * 0.16, background: "#0b0b0c", padding: width * 0.035, boxShadow: "0 60px 110px -30px rgba(20,10,40,0.6), inset 0 0 0 2px rgba(255,255,255,0.1)", opacity: clamp01(p * 1.4), transform: `translateY(${(1 - p) * 160 + bob}px) rotate(${(1 - p) * 8 - 2}deg)`, ...style }}>
      <div style={{ width: "100%", height: "100%", borderRadius: width * 0.13, overflow: "hidden", position: "relative", background: "#fff" }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 0%" }} />
        <div style={{ position: "absolute", top: width * 0.03, left: "50%", width: width * 0.3, height: width * 0.085, marginLeft: -width * 0.15, borderRadius: 99, background: "#0b0b0c" }} />
      </div>
    </div>
  );
}

/* ───────────── Motion details ───────────── */

/** A cursor gliding through points, squashing on each click with a ripple. */
export function Cursor({ path, clicks = [] }: { path: { f: number; x: number; y: number }[]; clicks?: number[] }) {
  const frame = useCurrentFrame();
  const fs = path.map((p) => p.f);
  const x = interpolate(frame, fs, path.map((p) => p.x), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut });
  const y = interpolate(frame, fs, path.map((p) => p.y), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut });
  const vis = interpolate(frame, [fs[0]!, fs[0]! + 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const press = clicks.some((c) => frame >= c && frame < c + 5);
  return (
    <>
      {clicks.map((c) => {
        const t = frame - c;
        if (t < 0 || t > 26) return null;
        return <div key={c} style={{ position: "absolute", left: x - 34, top: y - 34, width: 68, height: 68, borderRadius: 99, background: "rgba(255,106,85,0.18)", border: "2px solid rgba(255,106,85,0.9)", opacity: 1 - t / 26, transform: `scale(${0.3 + t / 13})` }} />;
      })}
      <svg width={44} height={44} viewBox="0 0 24 24" style={{ position: "absolute", left: x - 6, top: y - 4, opacity: vis, transform: `scale(${press ? 0.82 : 1})`, filter: "drop-shadow(0 8px 12px rgba(0,0,0,0.35))" }}>
        <path d="M5 3l14 8-6.5 1.5L9.5 19z" fill="#121216" stroke="#fff" strokeWidth={1.5} strokeLinejoin="round" />
      </svg>
    </>
  );
}

/** A number counting up to `to`, formatted the Indian way. */
export function Count({ to, delay = 0, dur = 40, prefix = "", suffix = "", decimals = 0 }: { to: number; delay?: number; dur?: number; prefix?: string; suffix?: string; decimals?: number }) {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [delay, delay + dur], [0, to], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });
  return <>{prefix}{v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

/** A glowing ring that pulses around a spot. */
export function Pulse({ x, y, w, h, delay = 0, color = C.coral, radius = 18 }: { x: number; y: number; w: number; h: number; delay?: number; color?: string; radius?: number }) {
  const frame = useCurrentFrame();
  const p = usePop(delay);
  const beat = 0.5 + 0.5 * Math.sin((frame - delay) / 6);
  return <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: radius, border: `3px solid ${color}`, boxShadow: `0 0 ${18 + beat * 22}px ${color}`, opacity: p * (0.75 + beat * 0.25), transform: `scale(${1.2 - p * 0.2})` }} />;
}

/** A burst of brand-coloured confetti from a point. */
export function Confetti({ x, y, at, count = 28 }: { x: number; y: number; at: number; count?: number }) {
  const frame = useCurrentFrame();
  const t = (frame - at) / 30;
  if (t < 0 || t > 1.6) return null;
  const cols = [C.red, C.amber, C.coral, C.violet, C.sky, "#34c759"];
  return (
    <>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 3) * 0.3;
        const v = 380 + (i % 5) * 90;
        const px = x + Math.cos(a) * v * t;
        const py = y + Math.sin(a) * v * t + 560 * t * t;
        const s = i % 2 ? 14 : 10;
        return <div key={i} style={{ position: "absolute", left: px, top: py, width: s, height: i % 3 ? s * 0.5 : s, borderRadius: i % 3 ? 3 : 99, background: cols[i % cols.length], opacity: 1 - t / 1.6, transform: `rotate(${t * 720 + i * 40}deg)` }} />;
      })}
    </>
  );
}

/** Three dots bouncing — the AI is thinking. */
export function Typing({ color = C.lavInk }: { color?: string }) {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", height: 30 }}>
      {[0, 1, 2].map((i) => {
        const b = Math.max(0, Math.sin(frame / 4 - i));
        return <span key={i} style={{ width: 12, height: 12, borderRadius: 99, background: color, opacity: 0.4 + 0.6 * b, transform: `translateY(${-b * 8}px)` }} />;
      })}
    </span>
  );
}

/* ───────────── Cinematic pieces ───────────── */

/** The dark opener backdrop: a slow ring of coral and violet light swirling on near-black. */
export function Cinema({ intensity = 1 }: { intensity?: number }) {
  const frame = useCurrentFrame();
  const r = frame * 0.25;
  return (
    <AbsoluteFill style={{ background: C.night, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: "50%", top: "55%", width: 2200, height: 1300, marginLeft: -1100, marginTop: -650, borderRadius: "50%", background: "radial-gradient(closest-side, transparent 52%, rgba(255,90,95,0.55) 66%, rgba(124,92,255,0.55) 78%, transparent 92%)", filter: "blur(70px)", opacity: 0.85 * intensity, transform: `rotate(${r}deg) scale(${1 + Math.sin(frame / 50) * 0.04})` }} />
      <div style={{ position: "absolute", left: "62%", top: "70%", width: 1100, height: 700, marginLeft: -550, marginTop: -350, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(214,72,190,0.55), transparent)", filter: "blur(80px)", opacity: 0.7 * intensity, transform: `translate(${Math.sin(frame / 40) * 60}px, ${Math.cos(frame / 46) * 40}px)` }} />
      <div style={{ position: "absolute", left: "22%", top: "18%", width: 900, height: 600, marginLeft: -450, marginTop: -300, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(253,186,90,0.28), transparent)", filter: "blur(80px)", opacity: intensity }} />
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)", backgroundSize: "3px 3px" }} />
    </AbsoluteFill>
  );
}

/** Soft, saturated pastel light — the backdrop behind floating interface cards. */
export function Soft() {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const blobs: [string, number, number, number][] = [["249,168,212", 12, 18, 0.75], ["147,197,253", 86, 22, 0.7], ["196,181,253", 30, 92, 0.7], ["253,186,140", 82, 88, 0.6], ["255,255,255", 50, 50, 0.9]];
  return (
    <AbsoluteFill style={{ background: "#f6f3f8", overflow: "hidden" }}>
      {blobs.map(([rgb, x, y, a], i) => (
        <div key={i} style={{ position: "absolute", left: `${x + Math.sin(t * 0.3 + i * 1.7) * 6 - 40}%`, top: `${y + Math.cos(t * 0.27 + i) * 6 - 40}%`, width: "80%", height: "80%", borderRadius: "50%", background: `radial-gradient(closest-side, rgba(${rgb},${a}), rgba(${rgb},0))` }} />
      ))}
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.035) 1px, transparent 1px)", backgroundSize: "3px 3px", opacity: 0.5 }} />
    </AbsoluteFill>
  );
}

type Key = { f: number; s?: number; cx?: number; cy?: number; rx?: number; ry?: number };
/**
 * A camera over the scene: glides between keyframes — zooming onto a point
 * (cx, cy in scene pixels) and tilting in 3D — with a smooth ease between each.
 */
export function Camera({ keys, children }: { keys: Key[]; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const fs = keys.map((k) => k.f);
  const v = (name: keyof Omit<Key, "f">, d: number) => (keys.length < 2 ? keys[0]?.[name] ?? d : interpolate(frame, fs, keys.map((k) => k[name] ?? d), { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeInOut }));
  const s = v("s", 1), cx = v("cx", 960), cy = v("cy", 540), rx = v("rx", 0), ry = v("ry", 0);
  return (
    <AbsoluteFill style={{ transformOrigin: "0 0", transform: `perspective(2600px) translate(960px, 540px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s}) translate(${-cx}px, ${-cy}px)` }}>
      {children}
    </AbsoluteFill>
  );
}

/** A thin line of light that grows out from its centre, with a bright glint travelling along it. */
export function Streak({ x, y, w, delay = 0, color = "255,140,120" }: { x: number; y: number; w: number; delay?: number; color?: string }) {
  const frame = useCurrentFrame();
  const g = ramp(frame, delay, delay + 26);
  const glint = ((frame - delay) / 40) % 1;
  return (
    <div style={{ position: "absolute", left: x - (w * g) / 2, top: y, width: w * g, height: 2, background: `linear-gradient(90deg, transparent, rgba(${color},0.9) 30%, rgba(255,255,255,0.95) 50%, rgba(${color},0.9) 70%, transparent)`, boxShadow: `0 0 18px 2px rgba(${color},0.6)` }}>
      {g > 0.9 && <div style={{ position: "absolute", top: -3, left: `${glint * 100}%`, width: 80, height: 8, marginLeft: -40, borderRadius: 9, background: "rgba(255,255,255,0.9)", filter: "blur(4px)" }} />}
    </div>
  );
}
