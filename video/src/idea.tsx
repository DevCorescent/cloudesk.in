// "What starts as an idea." — the Cloudesk launch film, in the style of a modern
// AI-product film: a glass prompt over warm light; huge glassy gradient words;
// a laptop and a phone; windows flying in 3D; sentences with real UI inline;
// a braces montage of windows; the logo. One clock, in seconds; every scene
// hands off into the next. Every interface piece is a real capture of Cloudesk
// (video/public/idea/ and video/public/shots/). Sound cues: src/idea-plan.js.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { CloudD, Wordmark } from "./kit";
import { Emblem, FONT, Handset, c01, kf, seg, smooth, soft } from "./film";
import { Hand, Spark } from "./launch";

const I = (n: string) => staticFile(`idea/${n}.jpg`);
const S = (n: string) => staticFile(`shots/${n}.jpg`);
const WHITE = "#f7f9ff";
type R = { x: number; y: number; w: number; h: number };
const FULL: R = { x: 0, y: 0, w: 1, h: 1 };

/* ───────── pieces ───────── */

/** A real piece of a 16:10 capture (fractions), at width w. */
function Shot({ src, r = FULL, w, radius = 14, style }: { src: string; r?: R; w: number; radius?: number; style?: React.CSSProperties }) {
  const iw = w / r.w;
  const h = (w * r.h * 10) / (r.w * 16);
  return (
    <div style={{ width: w, height: h, borderRadius: radius, overflow: "hidden", position: "relative", background: "#fff", ...style }}>
      <Img src={src} style={{ position: "absolute", width: iw, left: -r.x * iw, top: -r.y * iw * 0.625 }} />
    </div>
  );
}
/** A floating window: a thin dark bezel, a soft long shadow, a glass highlight on top. */
const Win = ({ children, radius = 18, dark = true }: { children: React.ReactNode; radius?: number; dark?: boolean }) => (
  <div style={{ position: "relative", padding: 6, borderRadius: radius + 6, background: dark ? "linear-gradient(180deg, #30343d, #15171c)" : "#fff", boxShadow: dark ? "0 50px 110px -30px rgba(0,0,0,0.75), inset 0 1px 0 rgba(255,255,255,0.18), 0 0 0 1px rgba(255,255,255,0.06)" : "0 40px 90px -30px rgba(20,30,60,0.35), 0 0 0 1px rgba(0,0,0,0.04)" }}>
    <div style={{ borderRadius: radius, overflow: "hidden" }}>{children}</div>
    <div style={{ position: "absolute", inset: 0, borderRadius: radius + 6, background: "linear-gradient(160deg, rgba(255,255,255,0.14), transparent 40%)", pointerEvents: "none" }} />
  </div>
);
/** A laptop, drawn: a dark bezel, the screen, a slim base with a lip. */
function Laptop({ w, children }: { w: number; children: React.ReactNode }) {
  const h = (w * 10) / 16;
  return (
    <div style={{ position: "relative", width: w * 1.16, height: h + 60 }}>
      <div style={{ position: "absolute", left: w * 0.08, top: 0, width: w + 32, borderRadius: 22, padding: "22px 16px 16px", background: "linear-gradient(180deg, #2a2d35, #111318)", boxShadow: "0 60px 120px -30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.14)" }}>
        <div style={{ position: "absolute", left: "50%", top: 8, width: 8, height: 8, marginLeft: -4, borderRadius: 99, background: "#0a0b0e", boxShadow: "inset 0 0 0 1.5px #2b2f38" }} />
        <div style={{ width: w, height: h, borderRadius: 10, overflow: "hidden", background: "#000" }}>{children}</div>
      </div>
      <div style={{ position: "absolute", left: 0, top: h + 38, width: w * 1.16, height: 18, borderRadius: "4px 4px 14px 14px", background: "linear-gradient(180deg, #4a4e58 0%, #2a2d35 35%, #1a1c22 100%)", boxShadow: "0 30px 50px -20px rgba(0,0,0,0.8)" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, width: w * 0.18, height: 6, marginLeft: -w * 0.09, borderRadius: "0 0 8px 8px", background: "#5a5e68" }} />
      </div>
    </div>
  );
}

/** A word in glassy, back-lit gradient glass — the hero typography of the film. */
function GlassWord({ text, size, p, weight = 600 }: { text: string; size: number; p: number; weight?: number }) {
  const common: React.CSSProperties = { fontFamily: FONT, fontSize: size, fontWeight: weight, letterSpacing: `${-0.035 + (1 - p) * 0.12}em`, lineHeight: 1, whiteSpace: "nowrap" };
  return (
    <div style={{ position: "relative", display: "inline-block", transform: `translateY(${(1 - p) * 50}px) scale(${0.92 + p * 0.08})`, opacity: c01(p * 1.4), filter: `blur(${(1 - p) * 14}px)` }}>
      <div style={{ ...common, position: "absolute", inset: 0, color: "#8fc4ff", filter: "blur(30px)", opacity: 0.85 }}>{text}</div>
      <div style={{ ...common, position: "absolute", inset: 0, color: "#ffffff", filter: "blur(6px)", opacity: 0.35 }}>{text}</div>
      <div style={{ ...common, position: "relative", backgroundImage: "linear-gradient(180deg, #ffffff 0%, #dff0ff 30%, #9ccaff 62%, #6c8dff 100%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{text}</div>
      <div style={{ ...common, position: "absolute", left: 0, right: 0, top: "100%", transform: "scaleY(-1)", backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.22), transparent 55%)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", opacity: 0.8 }}>{text}</div>
    </div>
  );
}

/** Plain words that glide in one by one (white, medium). */
function Line({ t, words, at, step = 0.25, size = 88, y = 540, x, out, color = WHITE, weight = 500, align = "center" }: { t: number; words: string[]; at: number; step?: number; size?: number; y?: number; x?: number; out?: number; color?: string; weight?: number; align?: "center" | "left" }) {
  const o = out !== undefined ? seg(t, out, out + 0.4, smooth) : 0;
  if (t < at || o >= 1) return null;
  return (
    <div style={{ position: "absolute", left: x ?? 0, right: x === undefined ? 0 : undefined, top: y, transform: `translateY(-50%) translateY(${-o * 40}px)`, display: "flex", justifyContent: align === "center" ? "center" : "flex-start", gap: size * 0.28, fontFamily: FONT, fontSize: size, fontWeight: weight, letterSpacing: "-0.025em", color, opacity: 1 - o, filter: `blur(${o * 10}px)`, whiteSpace: "nowrap" }}>
      {words.map((w, i) => {
        const p = seg(t, at + i * step, at + i * step + 0.4, smooth);
        return <span key={i} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 28}px)`, filter: `blur(${(1 - p) * 8}px)` }}>{w}</span>;
      })}
    </div>
  );
}

/** A glass panel (the prompt UI). */
const glass: React.CSSProperties = { background: "linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0.08))", backdropFilter: "blur(24px) saturate(160%)", WebkitBackdropFilter: "blur(24px) saturate(160%)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 0 0 1px rgba(255,255,255,0.22), 0 40px 80px -30px rgba(0,0,0,0.45)" };
const Chip = ({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) => (
  <div style={{ display: "inline-flex", alignItems: "center", gap: 10, height: 44, padding: "0 18px 0 14px", borderRadius: 999, ...glass, fontFamily: FONT, fontSize: 19, fontWeight: 500, color: WHITE, whiteSpace: "nowrap" }}>{icon}{children}</div>
);
const Round = ({ children, size = 44 }: { children: React.ReactNode; size?: number }) => (
  <div style={{ width: size, height: size, borderRadius: 99, ...glass, display: "grid", placeItems: "center", color: WHITE, fontFamily: FONT, fontSize: size * 0.5, fontWeight: 300 }}>{children}</div>
);

/* ───────── backdrops ───────── */

const Navy = () => <AbsoluteFill style={{ background: "radial-gradient(80% 70% at 50% 60%, #0f1740 0%, #080c24 60%, #05081a 100%)" }} />;
/** Warm light: the site's own sunlit photo, soft, with slow light through blinds. */
function Warm({ t }: { t: number }) {
  return (
    <AbsoluteFill style={{ overflow: "hidden", background: "#d8c7b2" }}>
      <Img src={I("photo-wood")} style={{ position: "absolute", left: "50%", top: "50%", width: "118%", transform: `translate(-50%, -50%) translate(${Math.sin(t * 0.2) * 14}px, ${Math.cos(t * 0.17) * 10}px) scale(${1 + (t - 2) * 0.004})`, filter: "blur(9px) saturate(0.9) brightness(1.08)" }} />
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(250,236,214,0.35), rgba(120,90,60,0.35))" }} />
      <AbsoluteFill style={{ background: `repeating-linear-gradient(-28deg, transparent 0 140px, rgba(255,246,225,0.22) 140px 215px, transparent 215px 300px)`, transform: `translateX(${(t - 2) * 18}px)`, mixBlendMode: "screen", filter: "blur(14px)" }} />
      <AbsoluteFill style={{ background: "radial-gradient(60% 50% at 30% 20%, rgba(255,240,210,0.35), transparent 70%)" }} />
    </AbsoluteFill>
  );
}
/** The aurora: deep violet and indigo light with a band of sky. */
function Aurora({ t, glow = 1 }: { t: number; glow?: number }) {
  return (
    <AbsoluteFill style={{ background: "#0a0920", overflow: "hidden" }}>
      {([["#5b3df5", 25, 70, 1300, 0.9], ["#2a3bff", 70, 35, 1200, 0.8], ["#b04dff", 45, 25, 900, 0.6], ["#3fb6ff", 85, 80, 800, 0.45], ["#ff6a55", 10, 15, 500, 0.25]] as const).map(([c, x, y, s, a], i) => (
        <div key={i} style={{ position: "absolute", left: `calc(${x}% - ${s / 2}px)`, top: `calc(${y}% - ${s / 2}px)`, width: s, height: s, borderRadius: "50%", background: c, opacity: a * glow, filter: "blur(120px)", transform: `translate(${Math.sin(t * 0.3 + i) * 60}px, ${Math.cos(t * 0.25 + i * 2) * 40}px)` }} />
      ))}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(10,9,32,0.5) 0%, transparent 35%, transparent 65%, rgba(10,9,32,0.6) 100%)" }} />
    </AbsoluteFill>
  );
}
/** The blue studio: a deep blue sky fading to a bright horizon. */
const Blue = ({ t }: { t: number }) => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg, #0c1f5c 0%, #1f4fbf 40%, #6ea9ff 72%, #d9ecff 100%)", overflow: "hidden" }}>
    <div style={{ position: "absolute", left: "50%", top: "78%", width: 2200, height: 700, marginLeft: -1100, marginTop: -350, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,255,255,0.55), transparent)", transform: `translateX(${Math.sin(t * 0.2) * 40}px)` }} />
  </AbsoluteFill>
);
/** A storm over fields: dark, moody, a faint horizon and a thin grid. */
const Storm = ({ grid = 0 }: { grid?: number }) => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg, #2a2f33 0%, #4a5257 45%, #6b7378 70%, #3b4245 100%)", overflow: "hidden" }}>
    <div style={{ position: "absolute", left: "50%", top: "62%", width: 2400, height: 500, marginLeft: -1200, marginTop: -250, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(220,230,235,0.35), transparent)" }} />
    <AbsoluteFill style={{ background: "radial-gradient(40% 60% at 20% 30%, rgba(0,0,0,0.35), transparent 70%), radial-gradient(40% 60% at 85% 70%, rgba(0,0,0,0.3), transparent 70%)" }} />
    {grid > 0 && <AbsoluteFill style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.45) 1.5px, transparent 1.5px), linear-gradient(90deg, rgba(255,255,255,0.45) 1.5px, transparent 1.5px)", backgroundSize: "480px 270px", backgroundPosition: "240px 135px", opacity: grid * 0.8 }} />}
  </AbsoluteFill>
);

/* real crops */
const PICKER_CARDS: R[] = [0.298, 0.496, 0.693].flatMap((x) => [0.315, 0.657].map((y) => ({ x, y, w: 0.184, h: 0.322 })));
const PUBLISH: R = { x: 0.872, y: 0.006, w: 0.12, h: 0.04 }; // Preview · Publish, from the builder's top bar
const ASSISTANT: R = { x: 0.205, y: 0.685, w: 0.41, h: 0.29 }; // the builder's AI assistant
const CODE: R = { x: 0.15, y: 0.11, w: 0.655, h: 0.64 }; // the IDE's editor
const SITES = ["kiln-hero", "sonic-hero", "casa-hero", "noir-hero"];
const MODULES = ["crm-deals", "home-dashboard", "inventory-home", "hrms-payroll"];
const INDUSTRIES = ["Streetwear", "Handmade", "Plants", "Electronics", "Furniture", "Skincare"];

const Logo = () => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: FONT, fontSize: 28, fontWeight: 600, color: WHITE, letterSpacing: "-0.02em", textShadow: "0 1px 12px rgba(0,0,0,0.35)", filter: "drop-shadow(0 1px 6px rgba(0,0,0,0.3))" }}><CloudD size={30} base="#fff" width={34} />cloudesk</div>
);

/* ───────── the film ───────── */

export const Idea: React.FC = () => {
  const t = useCurrentFrame() / 60;
  const type = (text: string, at: number, cps = 16) => text.slice(0, Math.max(0, Math.floor((t - at) * cps)));
  const caret = (visible: boolean) => <span style={{ opacity: visible && t % 1 < 0.5 ? 1 : 0 }}>|</span>;

  /* backdrop blends */
  const warm = seg(t, 2.0, 2.8, soft) * (1 - seg(t, 7.5, 7.9, smooth));
  const aurora1 = seg(t, 7.5, 7.9, smooth) * (1 - seg(t, 12.2, 12.8, smooth));
  const blueA = seg(t, 12.2, 12.8, smooth) * (1 - seg(t, 36.1, 36.6, smooth));
  const stormA = seg(t, 36.1, 36.6, smooth) * (1 - seg(t, 39.8, 40.2, smooth));
  const blueB = seg(t, 39.8, 40.2, smooth) * (1 - seg(t, 47.2, 47.7, smooth));
  const stormB = seg(t, 47.2, 47.7, smooth) * (1 - seg(t, 51.4, 51.9, smooth));
  const aurora2 = seg(t, 51.4, 51.9, smooth) * (1 - seg(t, 53.1, 53.5, smooth));
  const navyEnd = seg(t, 53.1, 53.5, smooth);
  const fade = 1 - seg(t, 55.3, 56, soft);

  /* A — the mark */
  const markIn = seg(t, 0.3, 1.4, smooth), markOut = seg(t, 2.0, 2.5, smooth);
  /* B — the prompt */
  const panel = seg(t, 2.6, 3.3, smooth), panelOut = seg(t, 7.4, 7.8, smooth);
  const idea = type("I have an idea", 6.0, 12);
  /* C/D */
  const ideaP = seg(t, 7.85, 8.7, smooth) * (1 - seg(t, 9.9, 10.3, smooth));
  const wmP = seg(t, 10.2, 11.0, smooth) * (1 - seg(t, 12.0, 12.4, smooth));
  /* E — devices */
  const lapIn = seg(t, 12.4, 13.3, smooth), phoneIn = seg(t, 14.2, 15.0, smooth), devOut = seg(t, 15.9, 16.3, smooth);
  /* F — ready */
  const readyIn = seg(t, 16.2, 16.9, smooth), readyOut = seg(t, 18.3, 18.7, smooth);
  /* G — the prompt types */
  const barIn = seg(t, 18.6, 19.1, smooth);
  const prompt = type("A cosy café with specialty coffee and fresh bakes", 19.0, 15);
  const sendPress = t >= 21.6 && t < 21.75;
  const collapse = seg(t, 22.0, 22.6, smooth), loadOut = seg(t, 23.4, 23.8, smooth);
  /* H — builder + code */
  const bIn = seg(t, 23.6, 24.4, smooth), bOut = seg(t, 26.1, 26.5, smooth);
  const ideIn = seg(t, 24.6, 25.2, smooth);
  const codeReveal = seg(t, 25.0, 26.0, (x) => x);
  /* I/J — cards, templates, sites */
  const cardIn = (k: number) => seg(t, 26.4 + k * 0.12, 26.9 + k * 0.12, smooth);
  const toTemplate = seg(t, 27.4, 27.9, smooth);
  const cardsOut = seg(t, 28.4, 28.8, smooth);
  const sitesIn = seg(t, 28.6, 29.2, smooth), sitesPan = seg(t, 29.0, 31.0, smooth), sitesOut = seg(t, 30.8, 31.2, smooth);
  /* K — a site on the laptop */
  const lap2 = seg(t, 31.0, 31.8, smooth) * (1 - seg(t, 33.1, 33.5, smooth));
  /* L — Beautifully designed / ready to launch */
  const bd = seg(t, 33.4, 34.0, smooth), bdOut = seg(t, 34.6, 34.9, smooth);
  const rtl = seg(t, 34.9, 35.5, smooth), rtlOut = seg(t, 36.0, 36.4, smooth);
  /* M — the assistant in the dark */
  const asIn = seg(t, 36.4, 37.1, smooth), asOut = seg(t, 39.6, 40.0, smooth);
  const chipHot = seg(t, 37.9, 38.1, soft);
  /* N — in any industry */
  const anyP = seg(t, 40.0, 40.8, smooth) * (1 - seg(t, 41.7, 42.0, smooth));
  /* O — What starts as / an idea */
  const anIdea = seg(t, 42.9, 43.8, smooth) * (1 - seg(t, 44.3, 44.7, smooth));
  const winUp = seg(t, 43.6, 44.4, smooth);
  /* P — the store, the hover */
  const lap3 = seg(t, 44.6, 45.3, smooth), pan = seg(t, 45.6, 46.4, smooth), storeOut = seg(t, 47.0, 47.4, smooth);
  /* Q — braces */
  const braces = seg(t, 47.9, 48.3, smooth), rowIn = (k: number) => seg(t, 48.2 + k * 0.14, 48.8 + k * 0.14, smooth);
  const dashUp = seg(t, 49.4, 50.0, smooth), rowOut = seg(t, 50.1, 50.4, smooth);
  /* R/S/T */
  const gridP = seg(t, 50.4, 51.0, soft) * (1 - seg(t, 51.4, 51.8));
  const endMark = seg(t, 53.4, 54.0, smooth), endWord = seg(t, 54.1, 54.8, smooth);

  return (
    <AbsoluteFill style={{ fontFamily: FONT, overflow: "hidden", background: "#05081a", opacity: fade }}>
      {/* ── the fields ── */}
      <Navy />
      {warm > 0 && <AbsoluteFill style={{ opacity: warm }}><Warm t={t} /></AbsoluteFill>}
      {aurora1 > 0 && <AbsoluteFill style={{ opacity: aurora1 }}><Aurora t={t} /></AbsoluteFill>}
      {blueA > 0 && <AbsoluteFill style={{ opacity: blueA }}><Blue t={t} /></AbsoluteFill>}
      {stormA > 0 && <AbsoluteFill style={{ opacity: stormA }}><Storm /></AbsoluteFill>}
      {blueB > 0 && <AbsoluteFill style={{ opacity: blueB }}><Blue t={t} /></AbsoluteFill>}
      {stormB > 0 && <AbsoluteFill style={{ opacity: stormB }}><Storm grid={gridP} /></AbsoluteFill>}
      {aurora2 > 0 && <AbsoluteFill style={{ opacity: aurora2 }}><Aurora t={t} glow={0.8} /></AbsoluteFill>}
      {navyEnd > 0 && <AbsoluteFill style={{ opacity: navyEnd }}><Navy /></AbsoluteFill>}

      {/* A — the mark floats in, with a glint */}
      {t < 2.6 && (
        <div style={{ position: "absolute", left: 960, top: 540, transform: `translate(-50%, -50%) translateY(${(1 - markIn) * 120 - markOut * 60}px) scale(${0.6 + markIn * 0.4 + markOut * 0.3})`, opacity: markIn * (1 - markOut), filter: `blur(${(1 - markIn) * 10 + markOut * 10}px)` }}>
          <Emblem id="i0" size={110} light={kf(t, [[0.3, 0.1], [1.6, 0.9]], soft)} />
          <div style={{ position: "absolute", left: 58, top: -6, transform: `scale(${seg(t, 0.9, 1.1, soft) * (1 - seg(t, 1.6, 1.9))}) rotate(${t * 60}deg)` }}><Spark size={28} color="#9cc9ff" /></div>
        </div>
      )}

      {/* B — the glass prompt over warm light */}
      {t >= 2.6 && t < 7.9 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: panel * (1 - panelOut), transform: `scale(${0.96 + panel * 0.04 + panelOut * 0.06})`, filter: `blur(${panelOut * 12}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 48, fontWeight: 600, color: WHITE, letterSpacing: "-0.03em", textShadow: "0 2px 30px rgba(0,0,0,0.25)", opacity: seg(t, 2.7, 3.2, smooth), transform: `translateY(${(1 - seg(t, 2.7, 3.2, smooth)) * 20}px)` }}>Build something with <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><CloudD size={44} base="#fff" width={34} />cloudesk</span></div>
          <div style={{ marginTop: 12, fontSize: 22, fontWeight: 400, color: "rgba(255,255,255,0.85)", textShadow: "0 1px 20px rgba(0,0,0,0.25)", opacity: seg(t, 3.0, 3.5, smooth) }}>Describe your business. Cloudesk builds your website, your store and the software to run it.</div>
          <div style={{ marginTop: 34, width: 980, borderRadius: 28, padding: "26px 28px 20px", ...glass, opacity: seg(t, 3.1, 3.7, smooth), transform: `translateY(${(1 - seg(t, 3.1, 3.7, smooth)) * 30}px)` }}>
            <div style={{ height: 70, fontSize: 26, fontWeight: 400, color: idea ? WHITE : "rgba(255,255,255,0.6)" }}>{idea || "Ask Cloudesk to create…"}{idea && caret(t < 7.4)}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
              <div style={{ transform: `scale(${seg(t, 3.5, 3.8, soft)})` }}><Round>+</Round></div>
              <div style={{ transform: `scale(${seg(t, 3.75, 4.05, soft)})`, transformOrigin: "0 50%" }}><Chip icon={<span style={{ width: 10, height: 10, borderRadius: 99, background: "#ff6a55" }} />}>Online store</Chip></div>
              <div style={{ transform: `scale(${seg(t, 4.0, 4.3, soft)})`, transformOrigin: "0 50%" }}><Chip>Website</Chip></div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}><Round>⌁</Round><Round>↑</Round></div>
            </div>
          </div>
        </AbsoluteFill>
      )}

      {/* C — "idea" in glass; D — the wordmark */}
      {ideaP > 0 && <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}><GlassWord text="idea" size={360} p={ideaP} /></AbsoluteFill>}
      {wmP > 0 && <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: wmP, transform: `scale(${0.96 + wmP * 0.04})`, filter: `blur(${(1 - wmP) * 8}px)` }}><Wordmark size={150} color={WHITE} /></AbsoluteFill>}

      {/* E — the laptop and the phone */}
      {t >= 12.4 && t < 16.4 && (
        <AbsoluteFill style={{ opacity: 1 - devOut, transform: `scale(${1 + devOut * 0.06})`, filter: `blur(${devOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 960 - 1160 * 0.58, top: 260 + (1 - lapIn) * 120, transform: `translateX(${phoneIn * -140}px) scale(${0.92 + lapIn * 0.08})`, opacity: lapIn, filter: `blur(${(1 - lapIn) * 10}px)` }}>
            <Laptop w={1000}><Img src={I("launch-start")} style={{ width: "100%", display: "block" }} /></Laptop>
          </div>
          <div style={{ position: "absolute", left: 1330, top: 250, perspective: 1600, opacity: phoneIn, transform: `translateY(${(1 - phoneIn) * 200}px)` }}>
            <div style={{ transform: `rotateY(${-22 + phoneIn * 6}deg) rotateZ(${8 - phoneIn * 4}deg)` }}><Handset src={S("store-sf-phone")} power={1} lit={1} /></div>
          </div>
        </AbsoluteFill>
      )}

      {/* F — ready to launch: the real final step, its checks ticking */}
      {t >= 16.2 && t < 18.8 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", perspective: 2200, opacity: readyIn * (1 - readyOut), filter: `blur(${(1 - readyIn) * 10 + readyOut * 10}px)` }}>
          <div style={{ transform: `rotateY(${(1 - readyIn) * 18}deg) rotateX(${(1 - readyIn) * 6}deg) translateY(${(1 - readyIn) * 60}px) scale(${0.9 + readyIn * 0.1})` }}>
            <Win><div style={{ position: "relative" }}>
              <Shot src={I("launch-ready")} r={{ x: 0.22, y: 0.07, w: 0.56, h: 0.53 }} w={1080} radius={0} />
              {[0.462, 0.543, 0.623, 0.717].map((y, k) => {
                const p = seg(t, 16.9 + k * 0.3, 17.2 + k * 0.3, soft);
                return <div key={k} style={{ position: "absolute", left: 1080 * 0.265 - 14, top: (1080 * 0.53 * 0.625 / 0.56) * y - 14, width: 28, height: 28, borderRadius: 99, background: "#1f7a55", display: "grid", placeItems: "center", transform: `scale(${p})`, boxShadow: "0 6px 16px -4px rgba(31,122,85,0.6)" }}><svg width={16} height={16} viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" /></svg></div>;
              })}
            </div></Win>
          </div>
        </AbsoluteFill>
      )}

      {/* G — the prompt bar types; send; it collapses into a loader */}
      {t >= 18.6 && t < 23.8 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: barIn * (1 - loadOut) }}>
          <div style={{ width: 1100 - collapse * 500, borderRadius: 30, padding: collapse > 0.5 ? "22px 28px" : "26px 30px 20px", ...glass, transform: `translateY(${(1 - barIn) * 40}px) scale(${0.96 + barIn * 0.04})`, overflow: "hidden" }}>
            {collapse < 0.5 ? (
              <>
                <div style={{ fontSize: 28, fontWeight: 400, color: WHITE, minHeight: 44 }}>{prompt}{caret(t < 21.5)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18 }}>
                  <Round>+</Round><Chip icon={<span style={{ width: 10, height: 10, borderRadius: 99, background: "#ff6a55" }} />}>Online store</Chip>
                  <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}><Round>⌁</Round><div style={{ transform: `scale(${sendPress ? 0.88 : 1})`, boxShadow: t >= 21.6 ? "0 0 0 6px rgba(255,255,255,0.25)" : "none", borderRadius: 99 }}><Round>↑</Round></div></div>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 18, justifyContent: "center", color: WHITE, fontSize: 22 }}>
                <CloudD size={40} base="#fff" width={34} />
                <span>Building your store</span>
                <span style={{ display: "inline-flex", gap: 6 }}>{[0, 1, 2].map((i) => <span key={i} style={{ width: 8, height: 8, borderRadius: 99, background: "#fff", opacity: 0.35 + 0.65 * Math.max(0, Math.sin(t * 7 - i)) }} />)}</span>
              </div>
            )}
          </div>
          {t >= 20.6 && t < 22.4 && <Hand x={interpolate(t, [20.6, 21.4], [1500, 1456], { extrapolateRight: "clamp", easing: smooth })} y={interpolate(t, [20.6, 21.4], [900, 640], { extrapolateRight: "clamp", easing: smooth })} press={sendPress ? 1 : 0} />}
        </AbsoluteFill>
      )}

      {/* H — the builder flies in; the code appears line by line */}
      {t >= 23.6 && t < 26.6 && (
        <AbsoluteFill style={{ perspective: 2400, opacity: 1 - bOut, filter: `blur(${bOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 180, top: 200, transformOrigin: "0 50%", transform: `translateX(${(1 - bIn) * -400 - ideIn * 220}px) rotateY(${18 - bIn * 10}deg) scale(${0.9 + bIn * 0.1})`, opacity: bIn, filter: `blur(${(1 - bIn) * 10}px)` }}>
            <Win><Shot src={I("builder-ai")} w={1240} radius={0} /></Win>
          </div>
          <div style={{ position: "absolute", left: 980, top: 300, transformOrigin: "100% 50%", transform: `translateX(${(1 - ideIn) * 500}px) rotateY(-14deg)`, opacity: ideIn }}>
            <Win><div style={{ position: "relative" }}>
              <Shot src={I("ide")} r={CODE} w={900} radius={0} />
              <div style={{ position: "absolute", left: 0, right: 0, top: `${8 + codeReveal * 60}%`, bottom: 0, background: "#fff" }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: `${8 + codeReveal * 60}%`, height: 2, background: "rgba(80,120,255,0.8)", boxShadow: "0 0 10px rgba(80,120,255,0.6)" }} />
            </div></Win>
          </div>
        </AbsoluteFill>
      )}

      {/* I — blue cards pop into a grid and become the real templates */}
      {t >= 26.4 && t < 28.9 && (
        <AbsoluteFill style={{ opacity: 1 - cardsOut, transform: `scale(${1 + cardsOut * 0.08})`, filter: `blur(${cardsOut * 10}px)` }}>
          {PICKER_CARDS.map((r, k) => {
            const col = Math.floor(k / 2), row = k % 2;
            const p = cardIn(k);
            const x = 340 + col * 430, y = 210 + row * 350;
            return (
              <div key={k} style={{ position: "absolute", left: x, top: y, width: 380, height: 300, borderRadius: 22, overflow: "hidden", transform: `translateY(${(1 - p) * 60}px) scale(${0.8 + p * 0.2})`, opacity: p, boxShadow: "0 40px 80px -30px rgba(0,20,80,0.6), inset 0 1px 0 rgba(255,255,255,0.35)", background: "linear-gradient(160deg, #2f66e0, #1b3fa8)" }}>
                <div style={{ position: "absolute", inset: 0, opacity: toTemplate }}><Shot src={I("picker")} r={r} w={380} radius={0} style={{ height: 300 }} /></div>
              </div>
            );
          })}
        </AbsoluteFill>
      )}

      {/* J — four finished storefronts in a 3D row, the camera panning along */}
      {t >= 28.6 && t < 31.3 && (
        <AbsoluteFill style={{ perspective: 2600, opacity: sitesIn * (1 - sitesOut), filter: `blur(${(1 - sitesIn) * 10 + sitesOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 0, top: 160, display: "flex", gap: 40, transform: `translateX(${160 - sitesPan * 1500}px) rotateY(-12deg)`, transformStyle: "preserve-3d" }}>
            {SITES.map((s, k) => <div key={s} style={{ transform: `translateY(${(1 - seg(t, 28.7 + k * 0.2, 29.3 + k * 0.2, smooth)) * 80}px)` }}><Win><Shot src={I(s)} w={1000} radius={0} /></Win></div>)}
          </div>
        </AbsoluteFill>
      )}

      {/* K — one site on the laptop */}
      {lap2 > 0 && (
        <div style={{ position: "absolute", left: 960 - 1160 * 0.55, top: 240, transform: `translateY(${(1 - lap2) * 80}px) scale(${0.94 + lap2 * 0.06})`, opacity: lap2, filter: `blur(${(1 - lap2) * 8}px)` }}>
          <Laptop w={1100}><Img src={I("sonic-hero")} style={{ width: "100%", display: "block", transform: `translateY(${-(t - 31) * 6}px)` }} /></Laptop>
        </div>
      )}

      {/* L — "Beautifully [laptop] designed" · "ready [UI] to launch" */}
      {bd > 0 && bdOut < 1 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: bd * (1 - bdOut), filter: `blur(${bdOut * 10}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 40, fontSize: 84, fontWeight: 500, letterSpacing: "-0.025em", color: WHITE }}>
            <span style={{ opacity: seg(t, 33.4, 33.8, smooth), transform: `translateX(${(1 - seg(t, 33.4, 33.8, smooth)) * -40}px)` }}>Beautifully</span>
            <div style={{ transform: `scale(${seg(t, 33.7, 34.1, soft)})`, width: 420 }}><Laptop w={360}><Img src={I("kiln-hero")} style={{ width: "100%", display: "block" }} /></Laptop></div>
            <span style={{ opacity: seg(t, 33.95, 34.35, smooth), transform: `translateX(${(1 - seg(t, 33.95, 34.35, smooth)) * 40}px)` }}>designed</span>
          </div>
        </AbsoluteFill>
      )}
      {rtl > 0 && rtlOut < 1 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: rtl * (1 - rtlOut), filter: `blur(${rtlOut * 10}px)` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 36, fontSize: 84, fontWeight: 500, letterSpacing: "-0.025em", color: WHITE }}>
            <span style={{ opacity: seg(t, 34.9, 35.3, smooth) }}>ready</span>
            <div style={{ transform: `scale(${seg(t, 35.15, 35.55, soft)})` }}><div style={{ padding: 6, borderRadius: 999, background: "#fff", boxShadow: "0 20px 50px -20px rgba(0,0,0,0.5)" }}><Shot src={I("builder-ai")} r={PUBLISH} w={420} radius={999} /></div></div>
            <span style={{ opacity: seg(t, 35.5, 35.9, smooth) }}>to launch</span>
          </div>
          {t >= 35.4 && <Hand x={interpolate(t, [35.4, 35.9], [1300, 1120], { extrapolateRight: "clamp", easing: smooth })} y={interpolate(t, [35.4, 35.9], [760, 575], { extrapolateRight: "clamp", easing: smooth })} press={0} />}
        </AbsoluteFill>
      )}

      {/* M — the assistant, close, in the dark; a click on "Make it more premium" */}
      {t >= 36.4 && t < 40.2 && (
        <AbsoluteFill style={{ perspective: 2200, opacity: asIn * (1 - asOut), filter: `blur(${(1 - asIn) * 10 + asOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 200, top: 120, transform: `translateX(${(1 - asIn) * 300}px) rotateY(-8deg) scale(${1.25 + (t - 36.4) * 0.02})`, transformOrigin: "40% 80%" }}>
            <Win><div style={{ position: "relative" }}>
              <Shot src={I("builder-ai")} w={1500} radius={0} />
              <div style={{ position: "absolute", left: 1500 * 0.214, top: 1500 * 0.625 * 0.745, width: 1500 * 0.085, height: 1500 * 0.625 * 0.024, borderRadius: 99, boxShadow: `0 0 0 2px rgba(255,106,85,${chipHot * 0.95}), 0 0 24px rgba(255,106,85,${chipHot * 0.5})` }} />
            </div></Win>
          </div>
          {t >= 37.2 && <Hand x={interpolate(t, [37.2, 37.85], [1700, 200 + 1500 * 0.26 * 1.25 + 60], { extrapolateRight: "clamp", easing: smooth })} y={interpolate(t, [37.2, 37.85], [1000, 120 + 1500 * 0.625 * 0.757 * 1.25 - 30], { extrapolateRight: "clamp", easing: smooth })} press={t >= 37.9 && t < 38.05 ? 1 : 0} />}
        </AbsoluteFill>
      )}

      {/* N — in any industry: the six real template categories */}
      {anyP > 0 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: anyP }}>
          <div style={{ position: "absolute", left: 960 - 60, top: 300, transform: `translate(-50%, -50%) scale(${seg(t, 40.0, 40.5, soft)}) rotate(${(t - 40) * 40}deg)` }}><Spark size={120} color="#8fc4ff" /></div>
          <Line t={t} words={["in", "any", "industry."]} at={40.3} step={0.2} size={100} y={560} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 700, display: "flex", justifyContent: "center", gap: 14 }}>
            {INDUSTRIES.map((n, k) => <div key={n} style={{ transform: `scale(${seg(t, 40.9 + k * 0.12, 41.2 + k * 0.12, soft)})` }}><Chip>{n}</Chip></div>)}
          </div>
        </AbsoluteFill>
      )}

      {/* O — "What starts as" · "an idea", the app rising beneath it */}
      <Line t={t} words={["What", "starts", "as"]} at={42.0} step={0.25} size={92} y={420} out={42.7} />
      {anIdea > 0 && <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 110 }}><GlassWord text="an idea" size={340} p={anIdea} /></AbsoluteFill>}
      {winUp > 0 && t < 44.9 && (
        <div style={{ position: "absolute", left: 160, top: 640 + (1 - winUp) * 500, opacity: winUp * (1 - seg(t, 44.4, 44.8)), perspective: 2000 }}>
          <div style={{ transform: "rotateX(14deg)", transformOrigin: "50% 0" }}><Win><Shot src={I("builder-ai")} w={1600} radius={0} /></Win></div>
        </div>
      )}

      {/* P — the storefront on the laptop; the camera pushes in; a hover on the real button */}
      {t >= 44.6 && t < 47.6 && (
        <AbsoluteFill style={{ opacity: lap3 * (1 - storeOut), transformOrigin: "84% 22%", transform: `scale(${1 + pan * 1.4})`, filter: `blur(${(1 - lap3) * 8 + storeOut * 10}px)` }}>
          <div style={{ position: "absolute", left: 960 - 1160 * 0.55, top: 230, transform: `translateY(${(1 - lap3) * 80}px)` }}>
            <Laptop w={1100}><Img src={S("store-sf-home")} style={{ width: "100%", display: "block" }} /></Laptop>
          </div>
          {t >= 46.0 && <div style={{ position: "absolute", left: 960 - 1160 * 0.55 + 1100 * 0.08 + 16 + 1100 * 0.836 - 52, top: 230 + 22 + 1100 * 0.625 * 0.1 - 16, width: 104, height: 32, borderRadius: 99, boxShadow: `0 0 0 1px rgba(255,255,255,${seg(t, 46.45, 46.6) * 0.95})` }} />}
        </AbsoluteFill>
      )}
      {t >= 46.0 && t < 47.3 && <Hand x={interpolate(t, [46.0, 46.45], [1400, 985], { extrapolateRight: "clamp", easing: smooth })} y={interpolate(t, [46.0, 46.45], [820, 445], { extrapolateRight: "clamp", easing: smooth })} press={t >= 46.5 && t < 46.62 ? 1 : 0} />}

      {/* Q — the braces montage: real module windows in a row; the dashboard comes forward */}
      {t >= 47.6 && t < 50.6 && (
        <AbsoluteFill style={{ perspective: 2400, opacity: 1 - rowOut, filter: `blur(${rowOut * 10}px)` }}>
          {["{", "}"].map((b, k) => <div key={b} style={{ position: "absolute", left: k ? 1740 : 180, top: 500, transform: `translate(-50%, -50%) scale(${braces}) translateX(${dashUp * (k ? 500 : -500)}px)`, fontSize: 330, fontWeight: 200, color: WHITE, opacity: braces * (1 - dashUp) }}>{b}</div>)}
          <div style={{ position: "absolute", left: 960, top: 540, transform: "translate(-50%, -50%)", display: "flex", gap: 24, transformStyle: "preserve-3d" }}>
            {MODULES.map((m, k) => {
              const p = rowIn(k);
              const center = k === 1;
              const grow = center ? dashUp : 0;
              return <div key={m} style={{ transform: `translateY(${(1 - p) * 60}px) translateZ(${grow * 700}px) translateX(${(k - 1.5) * -20 * dashUp}px)`, opacity: p * (center ? 1 : 1 - dashUp * 0.85), filter: center ? "none" : `blur(${dashUp * 6}px)` }}><Win><Shot src={S(m)} w={360} radius={0} /></Win></div>;
            })}
          </div>
        </AbsoluteFill>
      )}

      {/* R — More about what's next */}
      <Line t={t} words={["More", "about", "what's", "next"]} at={50.4} step={0.18} size={72} weight={400} out={51.3} />

      {/* S — What will you create today? */}
      <Line t={t} words={["What", "will", "you", "create", "today?"]} at={51.9} step={0.18} size={96} out={53.0} />

      {/* T — the mark, then the name */}
      {t >= 53.4 && (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <div style={{ transform: `scale(${0.5 + endMark * 0.5}) translateX(${endWord * 0}px)`, opacity: endMark, filter: `blur(${(1 - endMark) * 8}px)` }}><Emblem id="iend" size={120} light={kf(t, [[53.4, 0.1], [55, 0.9]], soft)} color={1} /></div>
            <div style={{ fontSize: 120, fontWeight: 600, letterSpacing: "-0.035em", color: WHITE, opacity: endWord, transform: `translateX(${(1 - endWord) * -30}px)`, filter: `blur(${(1 - endWord) * 8}px)`, width: endWord > 0 ? "auto" : 0, overflow: "hidden" }}>cloudesk</div>
          </div>
        </AbsoluteFill>
      )}

      {/* the small logo, top left, like a studio credit */}
      <div style={{ position: "absolute", left: 60, top: 44, opacity: seg(t, 0.8, 1.6) * 0.9 * (1 - seg(t, 53.2, 53.6)) }}><Logo /></div>
    </AbsoluteFill>
  );
};
