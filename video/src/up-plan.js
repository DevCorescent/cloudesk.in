// "All your mail. Every action. One place." — the upbeat Mail film's plan, shared
// by the picture (src/mail-up.tsx) and the soundtrack (music-up.mjs). 120 BPM:
// one beat = 0.5 s = 15 frames, one bar = 2 s. Times below are in seconds.
export const FPS = 30;
export const BPM = 120;
export const BARS = 23; // 46 s, plus a 2 s tail
export const DURATION = 48;

/** The sections, by bar, and how the music plays them. */
export const SECTIONS = [
  { from: 0, to: 3, kind: "hook" }, // scattered inboxes; providers flash on the beat; a pause
  { from: 3, to: 5, kind: "drive" }, // everything streams into one hub
  { from: 5, to: 6, kind: "break" }, // "All your mail. One place." — stillness
  { from: 6, to: 9, kind: "groove" }, // the unified inbox
  { from: 9, to: 10, kind: "lift" }, // "Every action."
  { from: 10, to: 16, kind: "drive" }, // actions burst on the beat, then the proof montage
  { from: 16, to: 17, kind: "break" }, // a breath before the payoff
  { from: 17, to: 20, kind: "peak" }, // every action, right where you read
  { from: 20, to: 23, kind: "outro" }, // the signature
];

/** Silences: the music stops for these windows (the pauses). */
export const SILENCE = [[5.5, 6.0], [33.5, 34.0], [39.5, 40.0]];

/** Sound tied to picture: [time, sound]. */
export const CUES = [
  ...[2, 2.5, 3, 3.5, 4, 4.5].map((t) => [t, "pop"]),
  [5.0, "hit-soft"], [6.0, "impact"], [9.0, "hit"], [9.5, "hit"],
  [12.0, "whoosh"], ...[14, 14.5, 15, 15.5].map((t) => [t, "tick"]), [16.6, "whoosh"],
  [18.0, "impact"], ...Array.from({ length: 12 }, (_, k) => [20 + k * 0.5, "pop"]),
  ...[26, 27, 28, 29, 30, 31].map((t) => [t, "swish"]), [32.0, "hit-soft"],
  [34.0, "impact"], ...Array.from({ length: 8 }, (_, k) => [35 + k * 0.25, "tick"]), [37.0, "hit"],
  [40.0, "impact"], [41.5, "shimmer"], [44.0, "hit"],
];
