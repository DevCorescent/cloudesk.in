// The Mail film's timing, in seconds — shared by the picture (src/mail.tsx) and
// the soundtrack (`node music.mjs mail`), so light, interaction and sound land together.
export const FPS = 30;
export const DURATION = 57;

/** What the display shows, and when it changes. All are real frames of Mail (video/public/mail/). */
export const SCREENS = [
  [6.6, "inbox"],
  [18.0, "reply"],
  [26.6, "thread"],
  [31.5, "phishing"],
  [36.3, "meeting"],
  [41.0, "inbox"],
  [41.9, "thread"],
  [42.8, "reply"],
  [43.6, "meeting"],
  [44.6, "inbox"],
];

/** Sound tied to picture: [time, sound]. Not every movement makes a sound. */
export const CUES = [
  [1.2, "trace"], [2.2, "settle"], [3.0, "rim"], [3.9, "notify"],
  [6.6, "power"],
  [12.6, "tick"], [14.2, "tick"],
  [18.0, "slide"], [21.2, "click"], [23.6, "tone"],
  [26.6, "reveal"],
  [31.5, "resonance"],
  [36.3, "click"], [36.7, "tone"],
  [39.8, "air"], [43.4, "main"], [44.5, "tone"],
  [46.8, "click"], [47.4, "power"], [50.2, "tone"], [51.0, "settle"], [52.6, "tone"],
];
/** The soft pulse: arrives with composing, doubles with intelligence, rests before the signature. */
export const PULSE = { start: 18, double: 26.6, hush: 46.4, resume: 999, end: 46.4, bpm: 90 };

export const HARMONY = [
  [0, [38, 45, 50, 53]], // D minor, open — the signal
  [6.6, [34, 46, 50, 53, 57]], // B♭maj7 — the interface
  [18, [31, 43, 50, 53, 58]], // G minor — composing
  [26.6, [27, 39, 46, 50, 55]], // E♭maj7 — intelligence
  [36.3, [29, 41, 48, 53, 57, 64]], // F maj7
  [41, [38, 45, 52, 53, 57]], // D minor add9 — gathering
  [43.4, [34, 46, 53, 57, 60, 65]], // B♭maj9 — the crescendo
  [46.8, [38, 45, 50, 52, 57]], // D sus2 — the signature
];
export const LEVELS = {
  pads: [[0, 0], [1, 0], [4, 0.2], [6.6, 0.45], [18, 0.55], [26.6, 0.7], [41, 0.8], [43.4, 1.15], [46.4, 0.9], [47, 0.5], [54, 0.5], [56.5, 0.08]],
  cutoff: [[0, 300], [6.6, 800], [18, 1000], [26.6, 1400], [41, 1800], [43.4, 3400], [46.4, 2600], [50, 1400], [56, 800]],
  drone: [[0, 0], [3, 0.6], [40, 0.8], [46.4, 1], [55, 0.8], [56.8, 0]],
  air: [[0, 0], [1.5, 1], [55, 1], [56.8, 0]],
};
