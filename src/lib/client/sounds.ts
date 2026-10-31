// Notification tunes, made in the browser with the Web Audio API — no audio
// files, so nothing to license or download. Each tune is a few "strikes" of a
// timbre (bell, glass, marimba, pad, pluck), through a soft room reverb and a
// gentle limiter, tuned to sound calm and corporate rather than gamey.
//
// Browsers only allow sound after the person has interacted with the page, so
// the engine unlocks itself on the first click or key press.

type Timbre = "bell" | "glass" | "marimba" | "pad" | "pluck";
type Strike = { at: number; f: number; timbre: Timbre; gain?: number; dur?: number };
export type Tune = { id: string; name: string; mood: string; strikes: Strike[] };

const N: Record<string, number> = { G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760 };

export const TUNES: Tune[] = [
  { id: "aurora", name: "Aurora", mood: "Two rising glass notes — bright, friendly", strikes: [{ at: 0, f: N.A5!, timbre: "glass" }, { at: 0.12, f: N.E6!, timbre: "glass", gain: 0.9 }] },
  { id: "crystal", name: "Crystal", mood: "A quick glass arpeggio — crisp and clear", strikes: [{ at: 0, f: N.C6!, timbre: "glass", gain: 0.8 }, { at: 0.07, f: N.E6!, timbre: "glass", gain: 0.75 }, { at: 0.14, f: N.G6!, timbre: "glass", gain: 0.7 }] },
  { id: "pulse", name: "Pulse", mood: "A soft double marimba tap — subtle", strikes: [{ at: 0, f: N.G5!, timbre: "marimba", gain: 0.8 }, { at: 0.13, f: N.G5!, timbre: "marimba", gain: 0.55 }] },
  { id: "executive", name: "Executive", mood: "A warm two-tone bell — confident", strikes: [{ at: 0, f: N.D5!, timbre: "bell", gain: 0.85 }, { at: 0.16, f: N.A5!, timbre: "bell", gain: 0.75 }] },
  { id: "reception", name: "Reception", mood: "A gentle ding-dong — like a front desk", strikes: [{ at: 0, f: N.E5!, timbre: "bell", gain: 0.9, dur: 1.6 }, { at: 0.32, f: N.C5!, timbre: "bell", gain: 0.85, dur: 1.8 }] },
  { id: "halo", name: "Halo", mood: "A soft chord that swells — calm", strikes: [{ at: 0, f: N.C5!, timbre: "pad", gain: 0.5 }, { at: 0, f: N.E5!, timbre: "pad", gain: 0.42 }, { at: 0, f: N.G5!, timbre: "pad", gain: 0.38 }, { at: 0.1, f: N.C6!, timbre: "bell", gain: 0.45 }] },
  { id: "cascade", name: "Cascade", mood: "Three falling marimba notes — light", strikes: [{ at: 0, f: N.E6!, timbre: "marimba", gain: 0.7 }, { at: 0.09, f: N.C6!, timbre: "marimba", gain: 0.7 }, { at: 0.18, f: N.A5!, timbre: "marimba", gain: 0.75 }] },
  { id: "momentum", name: "Momentum", mood: "A quick rising run — something's done", strikes: [{ at: 0, f: N.G4!, timbre: "pluck", gain: 0.6 }, { at: 0.06, f: N.C5!, timbre: "pluck", gain: 0.6 }, { at: 0.12, f: N.E5!, timbre: "pluck", gain: 0.65 }, { at: 0.18, f: N.G5!, timbre: "bell", gain: 0.6 }] },
  { id: "lumen", name: "Lumen", mood: "One soft bell with a long tail — minimal", strikes: [{ at: 0, f: N.C6!, timbre: "bell", gain: 0.7, dur: 2.2 }] },
  { id: "ping", name: "Ping", mood: "A single short ping — barely there", strikes: [{ at: 0, f: N.A6!, timbre: "glass", gain: 0.55, dur: 0.6 }] },
  { id: "beacon", name: "Beacon", mood: "Insistent, for urgent things", strikes: [0, 0.16, 0.32, 0.62, 0.78, 0.94].map((at, i) => ({ at, f: i % 2 ? N.E6! : N.A5!, timbre: "marimba" as const, gain: 0.95 })) },
  { id: "signal", name: "Signal", mood: "A bright triad, twice — hard to miss", strikes: [0, 0.08, 0.16, 0.5, 0.58, 0.66].map((at, i) => ({ at, f: [N.C6!, N.E6!, N.G6!][i % 3]!, timbre: "bell" as const, gain: 0.8 })) },
];
export const tuneById = (id: string) => TUNES.find((t) => t.id === id);

// ── Purposes and settings ───────────────────────────────────────────────────

export const PURPOSES = [
  { id: "chatMessage", label: "Chat — new message", hint: "In channels you follow, when you're not looking at that conversation", def: "pulse" },
  { id: "chatMention", label: "Chat — you're mentioned", hint: "@you, @everyone and replies in your threads", def: "aurora" },
  { id: "chatDirect", label: "Chat — direct message", hint: "One-to-one and group chats", def: "crystal" },
  { id: "chatUrgent", label: "Chat — urgent message", hint: "Plays even in Do not disturb and quiet hours", def: "beacon" },
  { id: "mail", label: "Mail — new email", hint: "New mail in your inboxes, follow-ups and emails given to you", def: "executive" },
  { id: "calendar", label: "Calendar — meetings", hint: "Meeting reminders, invites found and changes", def: "reception" },
  { id: "approvals", label: "Approvals & tasks", hint: "Approvals asked of you or answered, tasks given to you, leave, signatures", def: "momentum" },
  { id: "general", label: "Everything else", hint: "Other notifications in the bell", def: "ping" },
] as const;
export type Purpose = (typeof PURPOSES)[number]["id"];

export type SoundSettings = {
  on: boolean;
  volume: number;
  tunes: Record<Purpose, string>;
  /** Mute everything except urgent while your chat status is Do not disturb. */
  respectDnd: boolean;
  /** Only play when Cloudesk isn't the window you're looking at. */
  backgroundOnly: boolean;
  quiet: { on: boolean; from: string; to: string };
};

export const DEFAULT_SOUNDS: SoundSettings = {
  on: true,
  volume: 0.7,
  tunes: Object.fromEntries(PURPOSES.map((p) => [p.id, p.def])) as Record<Purpose, string>,
  respectDnd: true,
  backgroundOnly: false,
  quiet: { on: false, from: "21:00", to: "08:00" },
};

const KEY = (userId: string) => `cc-sounds:${userId}`;

export function loadSounds(userId: string): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return DEFAULT_SOUNDS;
    const v = JSON.parse(raw) as Partial<SoundSettings>;
    return { ...DEFAULT_SOUNDS, ...v, tunes: { ...DEFAULT_SOUNDS.tunes, ...(v.tunes ?? {}) }, quiet: { ...DEFAULT_SOUNDS.quiet, ...(v.quiet ?? {}) } };
  } catch {
    return DEFAULT_SOUNDS;
  }
}

export function saveSounds(userId: string, s: SoundSettings) {
  try {
    localStorage.setItem(KEY(userId), JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("cc-sounds-changed"));
  } catch {
    /* private mode: settings last for this visit */
  }
}

/** Inside quiet hours (handles ranges over midnight, e.g. 21:00–08:00). */
export function inQuietHours(q: SoundSettings["quiet"], now = new Date()) {
  if (!q.on) return false;
  const m = (s: string) => {
    const [h, mi] = s.split(":").map(Number);
    return (h ?? 0) * 60 + (mi ?? 0);
  };
  const t = now.getHours() * 60 + now.getMinutes();
  const a = m(q.from);
  const b = m(q.to);
  return a === b ? false : a < b ? t >= a && t < b : t >= a || t < b;
}

// ── The engine ──────────────────────────────────────────────────────────────

type Engine = { ctx: AudioContext; out: GainNode; wet: GainNode };
let engine: Engine | null = null;

function impulse(ctx: AudioContext, seconds = 1.4, decay = 3.2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}

function getEngine(): Engine | null {
  if (typeof window === "undefined") return null;
  if (engine) return engine;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  // dry + a little room → soft limiter → out
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -14;
  limiter.knee.value = 12;
  limiter.ratio.value = 4;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  const out = ctx.createGain();
  const room = ctx.createConvolver();
  room.buffer = impulse(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 9000;
  out.connect(tone);
  tone.connect(limiter);
  tone.connect(room);
  room.connect(wet);
  wet.connect(limiter);
  limiter.connect(ctx.destination);
  engine = { ctx, out, wet };
  return engine;
}

/** Call from a click/keypress handler (done automatically on the first one). */
export function unlockSounds() {
  const e = getEngine();
  if (e && e.ctx.state === "suspended") void e.ctx.resume();
}

if (typeof window !== "undefined") {
  const once = () => {
    unlockSounds();
    window.removeEventListener("pointerdown", once);
    window.removeEventListener("keydown", once);
  };
  window.addEventListener("pointerdown", once);
  window.addEventListener("keydown", once);
}

function voice(e: Engine, s: Strike, t0: number, vol: number) {
  const { ctx } = e;
  const g = ctx.createGain();
  g.connect(e.out);
  const peak = 0.28 * vol * (s.gain ?? 1);
  const osc = (type: OscillatorType, f: number, amp: number, decay: number, attack = 0.004, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    const a = ctx.createGain();
    a.gain.setValueAtTime(0.0001, t0);
    a.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * amp), t0 + attack);
    a.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
    o.connect(a);
    a.connect(g);
    o.start(t0);
    o.stop(t0 + attack + decay + 0.05);
  };
  const d = s.dur ?? 1.2;
  switch (s.timbre) {
    case "bell": // a warm bell: harmonic-ish partials, the upper ones dying first
      [[1, 1, d], [2, 0.42, d * 0.6], [3, 0.2, d * 0.4], [4.16, 0.1, d * 0.28], [5.43, 0.05, d * 0.2]].forEach(([r, a, dec]) => osc("sine", s.f * r!, a!, dec!, 0.003));
      break;
    case "glass": // a struck glass bar: inharmonic partials, quick and bright
      [[1, 1, d * 0.8], [2.76, 0.3, d * 0.35], [5.4, 0.12, d * 0.18], [8.93, 0.05, d * 0.1]].forEach(([r, a, dec]) => osc("sine", s.f * r!, a!, dec!, 0.002));
      break;
    case "marimba": // wooden: fundamental plus a short 4th harmonic
      osc("sine", s.f, 1, Math.min(d, 0.55), 0.002);
      osc("sine", s.f * 4, 0.12, 0.06, 0.001);
      osc("triangle", s.f * 2, 0.08, 0.12, 0.002);
      break;
    case "pluck":
      osc("triangle", s.f, 1, Math.min(d, 0.35), 0.002);
      osc("sine", s.f * 2, 0.25, 0.15, 0.002);
      break;
    case "pad": { // a slow swell of detuned saws through a soft filter
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(900, t0);
      f.frequency.linearRampToValueAtTime(2400, t0 + 0.35);
      f.connect(g);
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = s.f;
        o.detune.value = det;
        const a = ctx.createGain();
        a.gain.setValueAtTime(0.0001, t0);
        a.gain.exponentialRampToValueAtTime(peak * 0.22, t0 + 0.18);
        a.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
        o.connect(a);
        a.connect(f);
        o.start(t0);
        o.stop(t0 + 1.2);
      }
      break;
    }
  }
}

/** Plays a tune now. Returns false when the browser hasn't allowed sound yet. */
export function playTune(id: string, volume = 0.7) {
  const tune = tuneById(id);
  const e = getEngine();
  if (!tune || !e || volume <= 0) return false;
  if (e.ctx.state === "suspended") {
    void e.ctx.resume();
    if (e.ctx.state === "suspended") return false;
  }
  const t0 = e.ctx.currentTime + 0.02;
  for (const s of tune.strikes) voice(e, s, t0 + s.at, Math.min(1, Math.max(0, volume)));
  return true;
}

/**
 * One tab plays, not every open tab: the first to claim this sound (by key)
 * within a couple of seconds wins.
 */
export function claim(key: string) {
  try {
    const k = `cc-sound-claim:${key}`;
    const prev = Number(localStorage.getItem(k) ?? 0);
    if (Date.now() - prev < 4000) return false;
    localStorage.setItem(k, String(Date.now()));
    // Tidy old claims now and then.
    if (Math.random() < 0.05) for (const x of Object.keys(localStorage)) if (x.startsWith("cc-sound-claim:") && Date.now() - Number(localStorage.getItem(x)) > 60_000) localStorage.removeItem(x);
    return true;
  } catch {
    return true;
  }
}
