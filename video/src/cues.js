// The film's timing, in seconds — shared by the picture (src/film.tsx) and the
// soundtrack (music.mjs) so light, movement and sound land together.
export const FPS = 30;
export const DURATION = 82;

/** The five movements of the film. */
export const ACTS = {
  mark: [0, 18], // the unknown → the form: a line of light finds the emblem
  device: [18, 56.5], // the details: one display, the real product, close up
  array: [56.5, 64], // the experience: every module, emerging from the dark
  climax: [64, 72], // the defining moment
  signature: [72, 82], // the signature
};

/** What the display shows, and when it changes (each change is a soft click). */
export const SCREENS = [
  [20.6, "home-dashboard"],
  [24.0, "builder-overview"],
  [30.5, "pos-till"],
  [37.0, "home-dashboard"],
  [40.2, "finance-invoices"],
  [43.5, "workspace-mail-meeting"],
  [46.7, "calendar-week"],
  [50.0, "copilot-checks"],
];

/** Sound tied to picture: [time, sound]. */
export const CUES = [
  [1.5, "trace"], [5.2, "click"], [6.0, "click"], [7.0, "resonance"], [9.6, "resonance"],
  [13.0, "reveal"], [15.0, "tone"], [17.4, "air"],
  [18.7, "rim"], [19.6, "power"], [20.6, "tone"],
  ...SCREENS.slice(1).map(([t]) => [t, "click"]),
  [33.7, "slide"], [36.8, "slide"], [51.5, "resonance"],
  [56.5, "air"], ...Array.from({ length: 8 }, (_, k) => [57.0 + k * 0.16, "tick"]), [58.6, "tone"],
  [65.5, "main"], [66.0, "tone"],
  [72.4, "click"], [73.0, "power"], [76.4, "tone"], [77.2, "settle"], [78.6, "tone"],
];
/** When the soft pulse plays (seconds), and how strong it is. */
export const PULSE = { start: 22, double: 56.5, hush: 64, resume: 65.5, end: 72, bpm: 90 };

/** The harmony: the chord for each stretch (MIDI). */
export const HARMONY = [
  [0, [38, 45, 50, 53]], // D minor, open
  [13, [34, 46, 50, 53, 57]], // B♭maj7 — the emblem's name
  [20.6, [31, 43, 50, 53, 58]], // G minor — the product
  [30.5, [34, 46, 53, 57, 62]], // B♭add9
  [43.5, [29, 41, 48, 53, 57, 64]], // F maj7
  [50, [38, 45, 52, 53, 57]], // D minor add9 — tension
  [56.5, [36, 43, 50, 52, 55]], // C add9 — escalation
  [65.5, [38, 45, 50, 54, 57, 64]], // D major add9 — the defining moment
  [72.4, [38, 45, 50, 52, 57]], // D sus2 — the signature
];
/** Levels over time: pads, filter cut-off (Hz), drone, air — [[t, v], …]. */
export const LEVELS = {
  pads: [[0, 0], [0.5, 0], [6, 0.15], [12, 0.5], [18, 0.5], [22, 0.65], [56.5, 0.65], [63.5, 0.85], [64.2, 0.3], [65.5, 0.3], [66.2, 1.15], [70, 1.15], [74, 0.7], [79.5, 0.7], [81.8, 0.2]],
  cutoff: [[0, 350], [6, 350], [14, 1250], [56, 1250], [64, 1850], [65.5, 1850], [66.5, 3650], [70, 3650], [76, 1750]],
  drone: [[0, 0], [4, 0.7], [56, 0.7], [64, 1], [80, 1], [81.9, 0]],
  air: [[0, 0], [2, 1], [63.5, 1], [64, 0.4], [65.4, 0.4], [65.6, 1], [80, 1], [81.8, 0]],
};
