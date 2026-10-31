// The film's soundscape — original, synthesised from scratch (no samples, no
// licences needed). Ambient first, thriller second, energetic third: a deep
// drone, airy evolving pads that change harmony with each movement, distant
// metallic resonances, delicate high tones, reversed swells into the reveals,
// a soft pulse that arrives late and grows, near-silence before the main
// moment, and precise clicks on every movement of the product — all placed
// from the cue sheet in src/cues.js.
//   node music.mjs        → public/music.wav       (the Cloudesk film, src/cues.js)
//   node music.mjs mail   → public/music-mail.wav  (the Mail film, src/cues-mail.js)
import { writeFileSync } from "node:fs";

const WHICH = process.argv[2] ?? "film";
const SHEET = await import(WHICH === "mail" ? "./src/cues-mail.js" : "./src/cues.js");
const { CUES, DURATION, PULSE, HARMONY, LEVELS } = SHEET;
const OUT = WHICH === "mail" ? "public/music-mail.wav" : "public/music.wav";
/** Linear keyframes [[t, v], …]. */
const env = (keys, t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [a, va] = keys[i - 1], [b, vb] = keys[i]; return va + (vb - va) * ((t - a) / (b - a || 1)); }
  return keys.at(-1)[1];
};

const SR = 48000;
const SECONDS = DURATION;
const N = Math.ceil(SECONDS * SR);
const DL = new Float32Array(N), DR = new Float32Array(N);
const WL = new Float32Array(N), WR = new Float32Array(N);

let seed = 90210;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const idx = (t) => Math.floor(t * SR);
const add = (L, R, i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };
const ramp = (t, a, b) => Math.max(0, Math.min(1, (t - a) / (b - a)));
const sstep = (x) => x * x * (3 - 2 * x);

function svf() {
  let low = 0, band = 0;
  return (x, fc, q = 0.7) => {
    const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR);
    low += f * band;
    band += f * (x - low - q * band);
    return low;
  };
}

/* ── harmony: the chord for each stretch of the film (MIDI), from the cue sheet ── */
const chordAt = (t) => { let c = HARMONY[0][1]; for (const [at, ch] of HARMONY) if (t >= at) c = ch; return c; };

/* ── the bed: drone + pads with slow crossfades between chords ── */
function bed() {
  const voices = 6;
  const ph = Array.from({ length: voices }, () => [Math.random(), Math.random(), Math.random()]);
  const cur = new Array(voices).fill(0);
  const fl = svf(), fr = svf(), dl = svf(), dr = svf();
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const ch = chordAt(t);
    let l = 0, r = 0, dlv = 0;
    for (let v = 0; v < voices; v++) {
      const target = ch[v] !== undefined ? hz(ch[v]) : 0;
      cur[v] += (target - cur[v]) * 0.00004; // glide slowly into the next chord
      const f = cur[v];
      if (f < 1) continue;
      const p = ph[v];
      p[0] = (p[0] + (f * 0.998) / SR) % 1;
      p[1] = (p[1] + (f * 1.002) / SR) % 1;
      p[2] = (p[2] + f / SR) % 1;
      const tri = (x) => 1 - 4 * Math.abs(x - 0.5);
      l += tri(p[0]) * 0.6 + (2 * p[2] - 1) * 0.25;
      r += tri(p[1]) * 0.6 + (2 * p[2] - 1) * 0.25;
      if (v === 0) dlv = Math.sin(2 * Math.PI * p[2]);
    }
    // How present the pads are, and how open, through the film.
    const env_ = env(LEVELS.pads, t);
    const cutoff = env(LEVELS.cutoff, t);
    const breathe = 1 + 0.18 * Math.sin(t * 0.42);
    WL[n] += fl(l, cutoff * breathe, 0.6) * Math.max(0, env_) * 0.05;
    WR[n] += fr(r, cutoff * (2 - breathe), 0.6) * Math.max(0, env_) * 0.05;
    // The drone: the root an octave down, almost felt rather than heard.
    const droneEnv = env(LEVELS.drone, t);
    const d = dlv * 0.5 + 0.5 * Math.sin(2 * Math.PI * cur[0] * 0.5 * t);
    DL[n] += dl(d, 160) * 0.09 * droneEnv;
    DR[n] += dr(d, 160) * 0.09 * droneEnv;
  }
}

/* ── air: slowly evolving filtered noise, the room the film lives in ── */
function air() {
  const a = svf(), b = svf();
  for (let n = 0; n < N; n++) {
    const t = n / SR;
    const level = (0.012 + 0.01 * Math.sin(t * 0.21) ** 2) * env(LEVELS.air, t);
    WL[n] += a(rnd(), 1400 + 900 * Math.sin(t * 0.17), 1.4) * level;
    WR[n] += b(rnd(), 1400 + 900 * Math.cos(t * 0.19), 1.4) * level;
  }
}

/* ── instruments for the cues ── */

function bell(t0, midi, vel = 1, decay = 3, pan = 0) {
  const f = hz(midi);
  const i0 = idx(t0);
  const parts = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]];
  for (let n = 0; n < decay * 1.6 * SR; n++) {
    const t = n / SR;
    let v = 0;
    for (const [m, a] of parts) v += Math.sin(2 * Math.PI * f * m * t) * a * Math.exp(-t / (decay / m ** 0.6));
    add(WL, WR, i0 + n, v * Math.min(1, t / 0.004) * 0.03 * vel, pan);
  }
}

function tone(t0, midi, vel = 1, pan = 0) {
  const f = hz(midi);
  const i0 = idx(t0);
  for (let n = 0; n < 3.5 * SR; n++) {
    const t = n / SR;
    const v = (Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(2 * Math.PI * f * 2 * t)) * Math.min(1, t / 0.01) * Math.exp(-t / 1.1);
    add(WL, WR, i0 + n, v * 0.028 * vel, pan);
  }
}

function click(t0, vel = 1) {
  const i0 = idx(t0);
  for (let n = 0; n < 0.04 * SR; n++) {
    const t = n / SR;
    const v = (Math.sin(2 * Math.PI * 3100 * t) * 0.5 + rnd() * 0.5) * Math.exp(-t / 0.0025) * 0.16 * vel + Math.sin(2 * Math.PI * 140 * t) * Math.exp(-t / 0.012) * 0.12 * vel;
    add(DL, DR, i0 + n, v);
  }
  add(WL, WR, i0, 0.02 * vel);
}

function tick(t0, vel = 1) {
  const i0 = idx(t0);
  for (let n = 0; n < 0.02 * SR; n++) {
    const t = n / SR;
    add(DL, DR, i0 + n, Math.sin(2 * Math.PI * 5200 * t) * Math.exp(-t / 0.0018) * 0.07 * vel, (rnd() - 0.2) * 0.6);
  }
}

function reverseSwell(tEnd, dur, vel = 1) {
  const i0 = idx(tEnd - dur), len = Math.floor(dur * SR);
  const f = svf();
  const ch = chordAt(tEnd);
  for (let n = 0; n < len; n++) {
    const p = n / len;
    const t = n / SR;
    let v = f(rnd(), 300 + 3800 * p * p, 0.7) * 0.5;
    for (const m of ch.slice(1, 4)) v += Math.sin(2 * Math.PI * hz(m + 12) * t) * 0.12;
    add(WL, WR, i0 + n, v * p ** 3 * 0.22 * vel);
  }
}

function sub(t0, vel = 1, midi = 26, decay = 1.2) {
  const i0 = idx(t0);
  let ph = 0;
  for (let n = 0; n < decay * 2.5 * SR; n++) {
    const t = n / SR;
    ph += (2 * Math.PI * hz(midi) * (1 + 0.6 * Math.exp(-t / 0.05))) / SR;
    add(DL, DR, i0 + n, Math.sin(ph) * Math.min(1, t / 0.006) * Math.exp(-t / decay) * 0.5 * vel);
  }
}

function trace(t0) {
  // A thin, rising glass tone that follows the line of light.
  const i0 = idx(t0), len = Math.floor(4.7 * SR);
  let ph = 0;
  for (let n = 0; n < len; n++) {
    const p = n / len;
    ph += (2 * Math.PI * (880 + 440 * p)) / SR;
    const v = Math.sin(ph) * Math.sin(Math.PI * p) ** 1.5 * 0.018;
    add(WL, WR, i0 + n, v, -0.6 + 1.2 * p);
  }
}

function slide(t0) {
  const i0 = idx(t0), len = Math.floor(0.9 * SR);
  const f = svf();
  for (let n = 0; n < len; n++) {
    const p = n / len;
    add(DL, DR, i0 + n, f(rnd(), 500 + 1500 * Math.sin(Math.PI * p), 1.2) * Math.sin(Math.PI * p) ** 2 * 0.05, 0.5 - p);
  }
}

function power(t0) {
  // A low hum rising as a screen wakes.
  const i0 = idx(t0);
  let ph = 0;
  for (let n = 0; n < 1.6 * SR; n++) {
    const t = n / SR;
    ph += (2 * Math.PI * (55 + 55 * Math.min(1, t / 0.6))) / SR;
    add(DL, DR, i0 + n, Math.sin(ph) * Math.sin(Math.PI * Math.min(1, t / 1.6)) * 0.07);
  }
  click(t0 + 0.02, 0.6);
}

/* ── the pulse: arrives late, grows, holds its breath, returns ── */
const beat = 60 / PULSE.bpm;
for (let t = PULSE.start; t < PULSE.end; t += beat / 2) {
  const onBeat = Math.abs(((t - PULSE.start) / beat) % 1) < 1e-6 || Math.abs(((t - PULSE.start) / beat) % 1 - 1) < 1e-6;
  if (t >= PULSE.hush && t < PULSE.resume) continue;
  const doubled = t >= PULSE.double;
  if (!onBeat && !doubled) continue;
  const grow = 0.35 + 0.65 * sstep(ramp(t, PULSE.start, PULSE.hush));
  const vel = (t >= PULSE.resume ? 0.6 * (1 - ramp(t, PULSE.end - 3, PULSE.end)) : grow) * (onBeat ? 1 : 0.55);
  sub(t, 0.42 * vel, 26, 0.22);
  if (doubled && onBeat) tick(t, 0.6 * vel);
}

/* ── the cues ── */
const SFX = {
  trace,
  click: (t) => click(t, 1),
  tick: (t) => tick(t, 1.2),
  resonance: (t) => { bell(t, 62, 1, 3.5, -0.3); bell(t + 0.04, 69, 0.6, 3, 0.3); },
  reveal: (t) => { reverseSwell(t, 2.2, 1); sub(t, 0.7, 26, 1.4); bell(t, 74, 0.6, 4); },
  tone: (t) => { const ch = chordAt(t); tone(t, ch[ch.length - 1] + 12, 1, 0.2); tone(t + 0.18, ch[2] + 24, 0.6, -0.2); },
  air: (t) => reverseSwell(t + 1.2, 1.4, 0.6),
  rim: (t) => bell(t, 81, 0.5, 2.5, 0.4),
  power,
  slide,
  main: (t) => { reverseSwell(t, 1.6, 1.3); sub(t, 1, 26, 2.2); bell(t, 62, 1.4, 5, -0.2); bell(t + 0.03, 66, 1, 5, 0.2); bell(t + 0.06, 74, 0.8, 5, 0); },
  settle: (t) => { sub(t, 0.45, 26, 1.6); bell(t, 74, 0.7, 4.5); },
  // A new message: two soft, high notes.
  notify: (t) => { tone(t, 81, 0.9, 0.15); tone(t + 0.11, 88, 0.7, -0.15); },
  // Typing: soft, uneven keystrokes.
  typing: (t) => { for (let k = 0; k < 12; k++) tick(t + k * 0.14 + (rnd() * 0.04), 0.35); },
};
bed();
air();
for (const [t, kind] of CUES) {
  const fn = SFX[kind];
  if (!fn) throw new Error(`unknown cue ${kind}`);
  fn(t);
}

/* ── a long, dark reverb ── */
function reverb(input, combs, aps, fb = 0.9, damp = 0.5) {
  const out = new Float32Array(N);
  const cb = combs.map((d) => ({ d, b: new Float32Array(d), i: 0, lp: 0 }));
  const ab = aps.map((d) => ({ d, b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < N; n++) {
    const x = input[n] * 0.2;
    let s = 0;
    for (const c of cb) { const y = c.b[c.i]; c.lp = y * (1 - damp) + c.lp * damp; c.b[c.i] = x + c.lp * fb; c.i = (c.i + 1) % c.d; s += y; }
    for (const a of ab) { const y = a.b[a.i]; const v = s + y * 0.5; a.b[a.i] = v; a.i = (a.i + 1) % a.d; s = y - v * 0.5; }
    out[n] = s;
  }
  return out;
}
const RL = reverb(WL, [2333, 2459, 2213, 2111], [347, 727]);
const RR = reverb(WR, [2371, 2497, 2251, 2141], [359, 751]);

/* ── master: remove sub-rumble below ~25 Hz, gentle saturation, normalise ── */
const L = new Float32Array(N), R = new Float32Array(N);
let hl = 0, hr = 0, pl = 0, pr = 0, peak = 0;
const a = 1 / (1 + (2 * Math.PI * 25) / SR);
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const l = DL[n] + WL[n] * 0.7 + RL[n] * 0.85;
  const r = DR[n] + WR[n] * 0.7 + RR[n] * 0.85;
  hl = a * (hl + l - pl); pl = l; hr = a * (hr + r - pr); pr = r;
  const fade = Math.min(1, t / 0.3) * Math.min(1, (SECONDS - t) / 1.5);
  L[n] = Math.tanh(hl * 1.9) * fade;
  R[n] = Math.tanh(hr * 1.9) * fade;
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const g = 0.84 / peak;
const data = Buffer.alloc(44 + N * 4);
data.write("RIFF", 0); data.writeUInt32LE(36 + N * 4, 4); data.write("WAVE", 8); data.write("fmt ", 12);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write("data", 36); data.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * g)) * 32767), 44 + n * 4);
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * g)) * 32767), 46 + n * 4);
}
writeFileSync(OUT, data);
console.log(`wrote ${OUT}: ${SECONDS}s`);
