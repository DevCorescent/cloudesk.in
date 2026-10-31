// The Mail film — one continuous shot on one clock (seconds), in the same
// materials and layout system as the Cloudesk film: the dark glass display,
// the title block at the top, the camera gliding into the real interface.
//
// Every frame on the screen is a real capture of Mail (video/public/mail/, the
// marketing captures from scripts/marketing/capture-mail.spec.ts and
// capture-workspace.spec.ts). Nothing in the interface is
// drawn or faked; the film only moves the camera, the light and the screen.
import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { SCREENS } from "./cues-mail.js";
import { BEZEL, BG, Display, Emblem, FONT, GREY, INK, SCREEN, TitleBlock, c01, kf, onScreen, seg, soft } from "./film";

const frameSrc = (n: string) => staticFile(`mail/${n}.jpg`);
const C = { x: 960, y: 540 };
/** Where the first inbox row sits in the screenshot (fractions) — the notification card is that row. */
const ROW = { x: 0.3275, y: 0.193, w: 0.2625, h: 0.09 };

/** A real piece of the interface, cut from a frame: the first inbox row. */
function RowCard({ w }: { w: number }) {
  const h = (w * (ROW.h * 1800)) / (ROW.w * 2880);
  const iw = w / ROW.w;
  return (
    <div style={{ width: w, height: h, borderRadius: w * 0.025, overflow: "hidden", position: "relative", background: "#fff", boxShadow: "0 0 0 1px rgba(255,255,255,0.08), 0 30px 80px -20px rgba(0,0,0,0.9), 0 0 60px rgba(160,170,200,0.12)" }}>
      <Img src={frameSrc("inbox")} style={{ position: "absolute", width: iw, left: -ROW.x * iw, top: -ROW.y * iw * 0.625 }} />
    </div>
  );
}

export const MailFilm: React.FC = () => {
  const t = useCurrentFrame() / 30;

  /* — Scene 01: the signal — */
  const point = seg(t, 1.0, 1.8, soft) * (1 - seg(t, 2.6, 3.3, soft));
  const ring = seg(t, 2.0, 3.4, (x) => x);
  const lit = seg(t, 2.6, 4.4, soft) * (1 - seg(t, 48.2, 49.8, soft));
  const card = seg(t, 3.9, 4.5, soft); // the notification arrives
  const land = seg(t, 5.8, 6.8); // …and becomes the first row of the inbox
  const power = seg(t, 6.3, 7.0, soft) * (1 - seg(t, 46.8, 47.3, soft) * 0.92);

  /* — The screen — */
  const layers = SCREENS.map(([at, src], i) => {
    const next = SCREENS[i + 1]?.[0];
    const fade = 0.55;
    const o = seg(t, at, at + fade, soft) * (next !== undefined ? 1 - seg(t, next, next + fade, soft) : 1);
    return { src: frameSrc(src), o };
  });

  /* — The camera: wide for each headline, close for each detail — */
  const P = (px: number, py: number) => onScreen(px, py);
  const keys: [number, number, number, number][] = [
    // [time, scale, cx, cy]
    [0, 1.06, C.x, C.y], [6.0, 1.0, C.x, C.y], [9.6, 1.0, C.x, C.y],
    // 03 — the inbox: the category tabs, the views, the search box.
    [11.0, 2.2, P(0.46, 0.21).x, P(0.46, 0.21).y], [12.3, 2.24, P(0.47, 0.21).x, P(0.47, 0.21).y],
    [13.0, 2.0, P(0.245, 0.5).x, P(0.245, 0.5).y], [14.0, 2.04, P(0.245, 0.52).x, P(0.245, 0.52).y],
    [14.6, 2.3, P(0.46, 0.19).x, P(0.46, 0.19).y], [15.2, 2.32, P(0.47, 0.19).x, P(0.47, 0.19).y], [15.9, 1, C.x, C.y], [17.9, 1, C.x, C.y],
    // 04 — composing: the reply's recipients, then Send (with its schedule menu) and Remind me.
    [18.9, 1.9, P(0.79, 0.68).x, P(0.79, 0.68).y], [20.5, 1.94, P(0.8, 0.68).x, P(0.8, 0.68).y],
    [21.3, 2.1, P(0.74, 0.8).x, P(0.74, 0.8).y], [23.7, 2.14, P(0.75, 0.8).x, P(0.75, 0.8).y], [24.6, 1, C.x, C.y], [26.6, 1, C.x, C.y],
    // 05 — intelligence and safety: the AI row, the warning, the meeting.
    [27.4, 2.3, P(0.74, 0.35).x, P(0.74, 0.35).y], [28.7, 2.34, P(0.76, 0.35).x, P(0.76, 0.35).y], [29.4, 1, C.x, C.y], [31.6, 1, C.x, C.y],
    [32.4, 2.05, P(0.79, 0.4).x, P(0.79, 0.4).y], [33.6, 2.08, P(0.79, 0.4).x, P(0.79, 0.4).y], [34.2, 1, C.x, C.y], [36.4, 1, C.x, C.y],
    [37.2, 2.05, P(0.79, 0.43).x, P(0.79, 0.43).y], [38.4, 2.08, P(0.79, 0.43).x, P(0.79, 0.43).y], [39.0, 1, C.x, C.y],
    // 06 — the crescendo: the camera draws back and turns slowly around the whole.
    [41.0, 1, C.x, C.y], [46.6, 0.9, C.x, C.y + 10], [56, 0.9, C.x, C.y + 10],
  ];
  const cs = kf(t, keys.map((k) => [k[0], k[1]]));
  const ccx = kf(t, keys.map((k) => [k[0], k[2]]));
  const ccy = kf(t, keys.map((k) => [k[0], k[3]]));
  const ry = kf(t, [[2.6, 18], [6.6, 3], [40.8, 3], [43.4, -9], [46.4, 0]]);
  const rx = kf(t, [[2.6, 6], [6.6, 2], [46.4, 0]]);
  const glare = kf(t, [[2.6, -0.2], [7, 1.2], [41, 0.1], [45, 1.2]], soft);
  const rim = kf(t, [[2.6, 0], [5, 1], [41, 0], [44.5, 1]], soft);
  const bloom = seg(t, 43.2, 44.2, soft) * (1 - seg(t, 46.4, 47.4, soft));
  const zoomed = c01((cs - 1) / 0.6);

  /* — Scene 07: the signature — */
  const sigEmblem = seg(t, 47.4, 48.0, soft);
  const sigUp = seg(t, 48.4, 50.4);
  const sigColor = seg(t, 50.2, 51.4, soft);
  const lock = seg(t, 51.0, 52.0);
  const letters = seg(t, 51.4, 52.6, soft);
  const fadeAll = 1 - seg(t, 55.2, 56.5, soft);

  const cardW = interpolate(land, [0, 1], [700, ROW.w * SCREEN.w]);
  const rowAt = onScreen(ROW.x + ROW.w / 2, ROW.y + ROW.h / 2);
  const cardX = interpolate(land, [0, 1], [960, rowAt.x]);
  const cardY = interpolate(land, [0, 1], [560, rowAt.y]);

  return (
    <AbsoluteFill style={{ background: BG, fontFamily: FONT, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: "radial-gradient(60% 55% at 50% 58%, rgba(70,72,82,0.28), transparent 70%)", opacity: lit * 0.8 * fadeAll }} />

      {/* The point of light and its pulse. */}
      <div style={{ position: "absolute", left: 960 - 5, top: 560 - 5, width: 10, height: 10, borderRadius: 99, background: "#fff", boxShadow: "0 0 30px 10px rgba(255,255,255,0.45)", opacity: point }} />
      {ring > 0 && ring < 1 && <div style={{ position: "absolute", left: 960 - 400, top: 560 - 400, width: 800, height: 800, borderRadius: "50%", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)", opacity: (1 - ring) * 0.6, transform: `scale(${0.05 + ring})` }} />}

      {/* The display and everything on it. */}
      {t < 50.5 && (
        <AbsoluteFill style={{ opacity: fadeAll }}>
          <AbsoluteFill style={{ transformOrigin: "0 0", transform: `perspective(2600px) translate(960px, 540px) scale(${cs}) translate(${-ccx}px, ${-ccy}px)` }}>
            <div style={{ position: "absolute", left: 960 - 900, top: 630 - 520, width: 1800, height: 1040, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(230,232,240,0.2), transparent)", opacity: bloom + power * 0.3 }} />
            {/* Floor reflection. */}
            <div style={{ position: "absolute", left: SCREEN.x - BEZEL, top: SCREEN.y + SCREEN.h + BEZEL * 2 + 6, transform: `scaleY(-1) perspective(2000px) rotateY(${ry}deg)`, transformOrigin: "50% 0", opacity: 0.14 * lit * (1 - zoomed), WebkitMaskImage: "linear-gradient(to top, #000, transparent 38%)", maskImage: "linear-gradient(to top, #000, transparent 38%)" }}>
              <Display layers={layers} power={power} lit={lit} glare={glare} rim={rim} />
            </div>
            <div style={{ position: "absolute", left: SCREEN.x - BEZEL, top: SCREEN.y - BEZEL, transform: `perspective(2000px) rotateY(${ry}deg) rotateX(${rx}deg)` }}>
              <Display layers={layers} power={power} lit={lit} glare={glare} rim={rim}>
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", opacity: sigEmblem * (1 - seg(t, 48.4, 48.6)) }}><Emblem id="mboot" size={92} light={0.55} /></div>
              </Display>
            </div>
          </AbsoluteFill>
          {/* The notification — the first inbox row, arriving, then settling into its place. */}
          {card > 0 && land < 1 && (
            <div style={{ position: "absolute", left: cardX, top: cardY, transform: `translate(-50%, -50%) translateY(${(1 - card) * -24}px) scale(${0.96 + card * 0.04})`, opacity: card * (1 - seg(t, 6.5, 6.8)), filter: `blur(${(1 - card) * 6}px)` }}>
              <RowCard w={cardW} />
            </div>
          )}
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(3,3,4,0.96) 0%, rgba(3,3,4,0.86) 22%, transparent 34%)", opacity: 0.35 * (1 - zoomed) }} />
        </AbsoluteFill>
      )}

      <TitleBlock t={t} a={4.6} b={6.3} h1="Every message matters." />
      <TitleBlock t={t} a={7.3} b={9.7} h1="A clearer way to communicate." />
      <TitleBlock t={t} a={15.9} b={18.0} h1="Everything in its place." sub="Smart categories, views and search." />
      <TitleBlock t={t} a={24.6} b={26.6} h1="Thoughtfully composed." sub="Schedule the send. Get reminded if there's no reply." />
      <TitleBlock t={t} a={29.4} b={31.6} h1="Less effort. More clarity." sub="Summarise a thread, or draft a reply in your tone." />
      <TitleBlock t={t} a={34.2} b={36.4} h1="Suspicious mail, called out." sub="Look-alike senders and failed checks are flagged." />
      <TitleBlock t={t} a={39.0} b={41.0} h1="Built for your workflow." sub="Meeting invites, straight into your calendar." />
      <TitleBlock t={t} a={44.4} b={46.6} h1="Communication, refined." />

      {/* Scene 07 — the signature. */}
      {t >= 48.4 && (
        <AbsoluteFill style={{ opacity: fadeAll }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 400, display: "flex", justifyContent: "center", alignItems: "center", fontSize: 120, fontWeight: 500, letterSpacing: "-0.03em", color: INK, lineHeight: 1 }}>
            <span style={{ opacity: letters, transform: `translateX(${(1 - letters) * 16}px)`, filter: `blur(${(1 - letters) * 8}px)` }}>clou</span>
            <span style={{ display: "inline-block", width: 90, height: 132, position: "relative", margin: "0 2px 0 5px", transform: "translateY(8px)" }}>
              <div style={{ position: "absolute", left: "50%", top: "50%", transform: `translate(-50%, -50%) translate(${(1 - lock) * -27}px, ${interpolate(sigUp, [0, 1], [158, -40]) * (1 - lock)}px) scale(${interpolate(sigUp, [0, 1], [0.697, 1.7]) * (1 - lock) + lock})`, filter: "drop-shadow(0 20px 30px rgba(0,0,0,0.8))" }}>
                <Emblem id="msig" size={132} light={kf(t, [[48.4, 0.2], [51.4, 0.9]], soft)} color={sigColor} />
              </div>
            </span>
            <span style={{ opacity: letters, transform: `translateX(${(1 - letters) * -16}px)`, filter: `blur(${(1 - letters) * 8}px)` }}>esk</span>
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 610, textAlign: "center", fontSize: 72, fontWeight: 600, letterSpacing: "-0.028em", color: INK, opacity: seg(t, 52.6, 53.5, soft), filter: `blur(${(1 - seg(t, 52.6, 53.5, soft)) * 6}px)` }}>
            Mail. <span style={{ color: GREY }}>Reimagined.</span>
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
