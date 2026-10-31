// "What starts as an idea." — the Cloudesk launch film, in the style of a modern
// AI-product film: a glass prompt over warm light, huge glassy words, devices,
// windows flying in 3D, sentences with real UI inline, a braces montage, the
// logo. 120 BPM: one beat 0.5 s, one bar 2 s. Times in seconds. Shared by the
// picture (src/idea.tsx) and the soundtrack (music-idea.mjs).
export const FPS = 60;
export const BPM = 120;
export const BARS = 28;
export const DURATION = 56;

/** The sections, by bar, and how the music plays them. */
export const SECTIONS = [
  { from: 0, to: 3, kind: "hook" }, // the mark; the prompt over warm light
  { from: 3, to: 5, kind: "break" }, // "idea" — pads swell, stillness
  { from: 5, to: 8, kind: "groove" }, // the wordmark; laptop and phone
  { from: 8, to: 9, kind: "lift" }, // ready to launch — the checks
  { from: 9, to: 16, kind: "drive" }, // typing, the builder, the code, the templates, the sites
  { from: 16, to: 18, kind: "peak" }, // "Beautifully designed" · "ready to launch"
  { from: 18, to: 20, kind: "groove" }, // the assistant, in the dark
  { from: 20, to: 21, kind: "lift" }, // "in any industry"
  { from: 21, to: 23, kind: "peak" }, // "What starts as an idea"
  { from: 23, to: 25, kind: "drive" }, // the braces montage
  { from: 25, to: 26, kind: "break" }, // "More about what's next"
  { from: 26, to: 28, kind: "outro" }, // "What will you create today?" · the logo
];
export const SILENCE = [[7.55, 7.85], [42.6, 42.9]];

const run = (t0, n, step, kind) => Array.from({ length: n }, (_, k) => [t0 + k * step, kind]);
/** Sound tied to picture: [time, sound]. */
export const CUES = [
  // A — the mark
  [0.5, "orb"], [0.9, "glow"],
  // B — warm light; the glass prompt; "I have an idea"
  [2.2, "whoosh"], [2.7, "swish"], [3.1, "swish"], [3.5, "pop"], [3.75, "pop"], [4.0, "pop"], ...run(6.0, 9, 0.14, "tick"),
  // C/D — "idea"; the wordmark
  [7.85, "impact"], [7.9, "shimmer"], [10.2, "swish"], [10.35, "glow"],
  // E — the laptop, the phone
  [12.4, "whoosh"], [13.0, "hit-soft"], [14.2, "swish"], [14.6, "glow"],
  // F — ready to launch: the checks
  [16.2, "whoosh"], ...run(16.9, 4, 0.3, "tick"), [18.1, "ding"],
  // G — the prompt types; the send; the loader
  [18.6, "whoosh"], ...run(19.0, 12, 0.16, "tick"), [21.6, "click"], [22.1, "glide"], [22.3, "orb"],
  // H — the builder; the code
  [23.6, "whoosh"], [24.6, "swish"], ...run(25.0, 8, 0.1, "tick"),
  // I/J — the cards; the templates; the sites
  ...run(26.4, 6, 0.12, "pop"), [27.4, "whoosh"], [28.6, "whoosh"], [29.3, "swish"], [29.9, "swish"], [30.5, "swish"], [31.0, "hit-soft"],
  // L — "Beautifully designed" · "ready to launch"
  [33.4, "swish"], [33.7, "pop"], [33.95, "swish"], [34.9, "swish"], [35.15, "swish"], [35.4, "glow"], [35.5, "swish"],
  // M — the assistant
  [36.4, "whoosh"], [37.4, "swish"], [37.9, "click"], [38.2, "glow"],
  // N — "in any industry"
  [40.0, "impact"], [40.1, "shimmer"], [40.4, "swish"], ...run(40.9, 6, 0.12, "pop"),
  // O — "What starts as" · "an idea"
  [42.0, "swish"], [42.25, "swish"], [42.5, "swish"], [42.9, "impact"], [43.0, "shimmer"], [43.6, "whoosh"],
  // P — the store; the hover
  [44.6, "whoosh"], [45.6, "glide"], [46.5, "click"],
  // Q/R — the storm; the braces; the windows; "More about what's next"
  [47.4, "whoosh"], [47.9, "pop"], [48.05, "pop"], ...run(48.2, 4, 0.14, "swish"), [49.4, "hit-soft"], ...run(50.4, 4, 0.18, "swish"),
  // S/T — "What will you create today?"; the logo
  [51.6, "whoosh"], ...run(51.9, 4, 0.18, "swish"), [53.3, "hit-soft"], [53.5, "orb"], [54.1, "swish"], [54.2, "shimmer"],
];
