// The Mail launch film, shot for shot in the style of a modern SaaS product
// launch: light and dark scenes in turn, one word at a time, real interface
// pieces floating with soft shadows, a glass orb with a ribbon of light, a
// click, a confetti burst, a sparkle, the logo. 120 BPM (beat 0.5 s, bar 2 s).
// Shared by the picture (src/launch.tsx) and the soundtrack (music-launch.mjs).
export const FPS = 30;
export const BPM = 120;
export const BARS = 19; // 38 s
export const DURATION = 39;

export const SECTIONS = [
  { from: 0, to: 3, kind: "hook" }, // "Too many inboxes." — light, plucky
  { from: 3, to: 4, kind: "break" }, // "Too little time." — the discs
  { from: 4, to: 7, kind: "drive" }, // dark: the interface floats in, the orb
  { from: 7, to: 10, kind: "groove" }, // light: "From ten tabs to one inbox."
  { from: 10, to: 13, kind: "drive" }, // Reply · Schedule · Remind, the check and confetti
  { from: 13, to: 15, kind: "drive" }, // dark: smart replies
  { from: 15, to: 18, kind: "peak" }, // the sparkle; "AI-powered"; "Unified Mail"
  { from: 18, to: 19, kind: "outro" }, // the logo
];
export const SILENCE = [[5.6, 6.0], [30.0, 30.4]];

/** Sound tied to picture: [time, sound]. Every word glides in with a swish; every card, click, ripple, wipe and burst has its own cue. */
export const CUES = [
  // A — words
  [0.3, "swish"], [0.8, "swish"], [1.3, "swish"],
  // B — cards float in, the fast pass, "tabs."
  [2.0, "swish"], [2.3, "swish"], [2.6, "swish"], [3.5, "whoosh"], [4.9, "swish"],
  // D — the discs ripple out, the words
  [6.0, "pop"], [6.14, "pop"], [6.28, "pop"], [6.6, "swish"], [6.9, "swish"], [7.4, "swish"],
  // the circle wipe into the dark
  [8.35, "whoosh"], [8.9, "hit-soft"],
  // E — pieces sweep in; the search pill glows
  [8.8, "swish"], [9.8, "swish"], [10.8, "glow"],
  // F — the app tilts in, the push, the orb pops into its seat
  [11.8, "whoosh"], [12.6, "glide"], [13.3, "orb"],
  // G/H — take-off, re-entry, the words, the badge, the dot
  [13.8, "whoosh"], [14.9, "swish"], [15.0, "swish"], [15.3, "swish"], [15.6, "swish"], [16.6, "swish"],
  [17.5, "hit-soft"], [17.6, "shimmer"], [18.4, "orb"], [18.45, "swish"],
  // I — the composer, the words, the clicks
  [19.9, "whoosh"], [20.2, "swish"], [21.2, "click"], [22.0, "swish"], [22.6, "click"], [23.0, "swish"], [23.5, "click"],
  // J — the check, the burst
  [24.45, "ding"], [24.5, "burst"],
  // K — the dark slides in with the thread; Smart replies; Summarise
  [26.3, "whoosh"], [27.2, "swish"], [27.9, "click"], [29.0, "swish"],
  // L/M — the sparkle, the words
  [30.4, "impact"], [30.5, "shimmer"], [31.6, "swish"], [31.9, "glow"], [33.4, "swish"], [33.75, "swish"], [34.0, "glow"],
  // N/O — the wipe, the logo
  [35.6, "whoosh"], [36.4, "hit-soft"], [36.5, "shimmer"],
];
