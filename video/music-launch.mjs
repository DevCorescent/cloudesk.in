// An original, bright, upbeat track for the Mail launch film — synthesised from
// scratch (no samples, nothing to license). 120 BPM in C major, F–G–Em–Am: plucky
// synth chords, punchy kick and claps, a bouncing sub, a bright bell hook,
// whooshes, risers, a soft impact on the sparkle and hard stops for the pauses.
// Sections and sound cues come from src/launch-plan.js.
//   node music-launch.mjs → public/music-launch.wav
import { writeFileSync } from "node:fs";
import { BARS, CUES, DURATION, SECTIONS, SILENCE } from "./src/launch-plan.js";

const SR = 48000;
const N = Math.ceil(DURATION * SR);
const BEAT = 0.5, BAR = 2;
const DL = new Float32Array(N), DR = new Float32Array(N), WL = new Float32Array(N), WR = new Float32Array(N);
const DUCK = new Float32Array(N).fill(1);
let seed = 4242;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
const idx = (t) => Math.floor(t * SR);
const add = (L, R, i, v, pan = 0) => { if (i >= 0 && i < N) { L[i] += v * (1 - Math.max(0, pan)); R[i] += v * (1 + Math.min(0, pan)); } };
const silent = (t) => SILENCE.some(([a, b]) => t >= a && t < b);
const kindAt = (bar) => (SECTIONS.find((s) => bar >= s.from && bar < s.to) ?? SECTIONS.at(-1)).kind;
function svf() { let lo = 0, bd = 0; return (x, fc, q = 0.7) => { const f = 2 * Math.sin((Math.PI * Math.min(fc, SR / 6)) / SR); lo += f * bd; bd += f * (x - lo - q * bd); return lo; }; }

// C major, modern: Fmaj7, G6, Em7, Am7 (voicings and roots).
const CH = [[53, 57, 60, 64], [55, 59, 62, 64], [52, 55, 59, 62], [57, 60, 64, 67]];
const ROOT = [29, 31, 28, 33];

function kick(t0, v = 1) {
  const i0 = idx(t0); let ph = 0;
  for (let n = 0; n < 0.45 * SR; n++) { const t = n / SR; ph += (2 * Math.PI * (46 + 150 * Math.exp(-t / 0.028))) / SR; add(DL, DR, i0 + n, (Math.tanh(1.8 * Math.sin(ph)) * Math.exp(-t / 0.17) + (n < 160 ? rnd() * 0.3 * (1 - n / 160) : 0)) * 0.8 * v); }
  for (let n = 0; n < 0.22 * SR; n++) { const i = i0 + n; if (i < N) DUCK[i] = Math.min(DUCK[i], 1 - 0.8 * Math.exp(-n / SR / 0.09)); }
}
function clap(t0, v = 1) {
  const i0 = idx(t0); let p = 0;
  for (let n = 0; n < 0.32 * SR; n++) { const t = n / SR; const b = t < 0.03 ? (Math.floor(t / 0.009) % 2 ? 0.3 : 1) : 1; const x = rnd(); const h = x - p; p = x; const s = h * Math.exp(-t / 0.1) * b * 0.3 * v; add(DL, DR, i0 + n, s * 0.7); add(WL, WR, i0 + n, s * 0.8); }
}
function hat(t0, v = 1, pan = 0.25) { const i0 = idx(t0); let a = 0; for (let n = 0; n < 0.05 * SR; n++) { const t = n / SR; const x = rnd(); a += (x - a) * 0.6; add(DL, DR, i0 + n, (x - a) * Math.exp(-t / 0.012) * 0.1 * v, pan); } }
function tom(t0, midi, v = 1) { const i0 = idx(t0); let ph = 0; const f = hz(midi); for (let n = 0; n < 0.5 * SR; n++) { const t = n / SR; ph += (2 * Math.PI * f * (1 + 0.8 * Math.exp(-t / 0.04))) / SR; add(DL, DR, i0 + n, Math.sin(ph) * Math.exp(-t / 0.16) * 0.42 * v, (midi - 45) / 30); } }
function bass(t0, midi, dur, v = 1) {
  const i0 = idx(t0), len = Math.floor(dur * SR), f = hz(midi); let ph = 0, lp = 0;
  for (let n = 0; n < len; n++) { const t = n / SR; const i = i0 + n; if (i >= N) break; ph = (ph + f / SR) % 1; lp += (2 * ph - 1 - lp) * (0.05 + 0.15 * Math.exp(-t / 0.04)); const e = Math.min(1, t / 0.003) * Math.exp(-t / 0.3) * (n > len - 200 ? (len - n) / 200 : 1); const s = (Math.sin(2 * Math.PI * f * t) * 0.85 + lp * 0.4) * e * 0.34 * v * (0.45 + 0.55 * DUCK[i]); DL[i] += s; DR[i] += s; }
}
// The ostinato: a bowed-pluck saw, sixteenths, filtered by section.
function ost(t0, midi, fc, v, pan) {
  const i0 = idx(t0), len = Math.floor(0.2 * SR), f = hz(midi), flt = svf(); let a = 0, b = 0.37;
  for (let n = 0; n < len; n++) { const t = n / SR; const i = i0 + n; if (i >= N) break; a = (a + (f * 0.997) / SR) % 1; b = (b + (f * 1.003) / SR) % 1; const x = (2 * a - 1 + 2 * b - 1) * 0.5; const y = flt(x, fc * (0.6 + 1.2 * Math.exp(-t / 0.05)), 0.4); add(WL, WR, i, y * Math.min(1, t / 0.003) * Math.exp(-t / 0.08) * 0.09 * v * (0.55 + 0.45 * DUCK[i]), pan); }
}
function bell(t0, midi, v = 1, pan = 0) { const i0 = idx(t0), f = hz(midi); for (let n = 0; n < 1.4 * SR; n++) { const t = n / SR; const s = (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t / 0.15) + 0.15 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t / 0.06)) * Math.min(1, t / 0.002) * Math.exp(-t / 0.45); add(WL, WR, i0 + n, s * 0.05 * v, pan); } }
function pad(t0, chord, dur, v) {
  const i0 = idx(t0), len = Math.floor((dur + 0.4) * SR); const ph = chord.map(() => [Math.random(), Math.random()]); const lp = chord.map(() => [0, 0]);
  for (let n = 0; n < len; n++) { const t = n / SR; const i = i0 + n; if (i >= N) break; const e = Math.min(1, t / 0.25) * (t > dur ? Math.exp(-(t - dur) / 0.2) : 1); let l = 0, r = 0; chord.forEach((m, j) => { const f = hz(m - 12); ph[j][0] = (ph[j][0] + (f * 0.996) / SR) % 1; ph[j][1] = (ph[j][1] + (f * 1.004) / SR) % 1; lp[j][0] += (2 * ph[j][0] - 1 - lp[j][0]) * 0.04; lp[j][1] += (2 * ph[j][1] - 1 - lp[j][1]) * 0.04; l += lp[j][0]; r += lp[j][1]; }); const d = 0.5 + 0.5 * DUCK[i]; WL[i] += l * e * 0.045 * v * d; WR[i] += r * e * 0.045 * v * d; }
}
function impact(t0, v = 1) { const i0 = idx(t0); let ph = 0; for (let n = 0; n < 2 * SR; n++) { const t = n / SR; ph += (2 * Math.PI * (34 + 80 * Math.exp(-t / 0.05))) / SR; add(DL, DR, i0 + n, (Math.sin(ph) * Math.exp(-t / 0.6) + rnd() * 0.35 * Math.exp(-t / 0.03)) * 0.85 * v); add(WL, WR, i0 + n, rnd() * 0.14 * Math.exp(-t / 0.35) * v); } }
function riser(t0, dur, v = 1) { const i0 = idx(t0), len = Math.floor(dur * SR), f = svf(); let ph = 0; for (let n = 0; n < len; n++) { const p = n / len; ph += (2 * Math.PI * (150 + 1200 * p * p)) / SR; add(WL, WR, i0 + n, (f(rnd(), 400 + 7000 * p * p, 0.5) * 0.6 + Math.sin(ph) * 0.12) * p * p * 0.24 * v); } }
function pop(t0) { const i0 = idx(t0); let ph = 0; for (let n = 0; n < 0.12 * SR; n++) { const t = n / SR; ph += (2 * Math.PI * (500 + 900 * (1 - Math.exp(-t / 0.015)))) / SR; add(DL, DR, i0 + n, Math.sin(ph) * Math.exp(-t / 0.03) * 0.12); } }
function tick(t0) { const i0 = idx(t0); for (let n = 0; n < 0.02 * SR; n++) { const t = n / SR; add(DL, DR, i0 + n, Math.sin(2 * Math.PI * 4800 * t) * Math.exp(-t / 0.002) * 0.08, rnd() * 0.4); } }
function swish(t0) { const i0 = idx(t0), len = Math.floor(0.35 * SR), f = svf(); for (let n = 0; n < len; n++) { const p = n / len; add(DL, DR, i0 + n, f(rnd(), 800 + 5000 * Math.sin(Math.PI * p), 0.8) * Math.sin(Math.PI * p) ** 2 * 0.14, -0.7 + 1.4 * p); } }
function whoosh(t0) { const i0 = idx(t0), len = Math.floor(0.8 * SR), f = svf(); for (let n = 0; n < len; n++) { const p = n / len; const s = f(rnd(), 300 + 4000 * Math.sin(Math.PI * p), 0.8) * Math.sin(Math.PI * p) ** 2 * 0.25; add(DL, DR, i0 + n, s * 0.5, -0.8 + 1.6 * p); add(WL, WR, i0 + n, s * 0.4); } }
function shimmer(t0) { [76, 83, 88, 95].forEach((m, k) => bell(t0 + k * 0.06, m, 0.6, k % 2 ? 0.4 : -0.4)); }

/* ── arrangement ── */
const HOOK = [76, 79, 81, 79, 76, 74, 72, 74]; // a bright eight-note figure over each bar
for (let b = 0; b < BARS; b++) {
  const k = kindAt(b), t = b * BAR, c = b % 4, ch = CH[c];
  for (let beat = 0; beat < 4; beat++) {
    const tb = t + beat * BEAT;
    if (silent(tb)) continue;
    const full = k === "drive" || k === "peak";
    // Drums.
    if (full || k === "groove" || (k === "hook" && b >= 1) || (k === "outro" && b < BARS - 2)) kick(tb, k === "hook" ? 0.75 : 1);
    if ((full && (beat === 1 || beat === 3)) || (k === "groove" && beat === 2)) clap(tb, k === "peak" ? 1.15 : 1);
    if (full || k === "groove") for (let s = 0; s < 4; s++) if (!silent(tb + s * 0.125)) hat(tb + s * 0.125, s % 2 ? 0.5 : 1, s % 2 ? 0.3 : -0.2);
    if (k === "hook") hat(tb + 0.25, 0.6);
    // Bass eighths.
    if (full || k === "groove" || k === "lift") for (let e = 0; e < 2; e++) if (!silent(tb + e * 0.25)) bass(tb + e * 0.25, ROOT[c] + 12 * (e === 1 && beat === 3 ? 1 : 0), 0.23, e ? 0.85 : 1);
    // Ostinato sixteenths, opening up.
    const fc = k === "hook" ? 1400 + b * 300 : k === "break" ? 450 : k === "groove" ? 1400 : k === "lift" ? 1800 : k === "peak" ? 4200 : k === "outro" ? 1200 : 2600;
    for (let s = 0; s < 4; s++) {
      const ts = tb + s * 0.125;
      if (silent(ts) || (k === "outro" && b >= BARS - 2)) continue;
      const note = ch[(beat * 4 + s) % 4] + (s % 2 ? 12 : 0);
      ost(ts, note, fc, k === "break" ? 0.6 : 1, s % 2 ? 0.45 : -0.45);
    }
  }
  // Pads on every bar; brighter at the peak.
  pad(t, ch, BAR, k === "peak" ? 1.3 : k === "break" ? 1.2 : k === "hook" ? 0.6 : 0.9);
  // The bell hook in the groove, the peak and the outro.
  if (k === "groove" || k === "peak" || (k === "outro" && b < BARS - 1) || k === "lift") HOOK.forEach((m, j) => { const tj = t + j * 0.25; if (!silent(tj)) bell(tj, m + (k === "peak" ? 12 : 0) - (c === 1 ? 4 : c === 2 ? -3 : c === 3 ? -2 : 0) * 0, 0.8, j % 2 ? 0.35 : -0.35); });
  // Tom fills at the end of drive sections.
  // Risers into the big moments.
  if (kindAt(b + 1) === "drive" && k !== "drive") riser(t + 0.5, 1.0, 0.9);
  if (kindAt(b + 1) === "peak" || kindAt(b + 1) === "outro") riser(t, 1.5, 1.1);
}
// Final resolution: a held E minor add9 with a bell.
pad(BARS * BAR - 2, [48, 55, 60, 64, 67, 71], 3, 1);
bell(BARS * BAR - 2, 84, 1);

function click(t0) { const i0 = idx(t0); for (let n = 0; n < 0.035 * SR; n++) { const t = n / SR; add(DL, DR, i0 + n, (Math.sin(2 * Math.PI * 2600 * t) * 0.6 + rnd() * 0.4) * Math.exp(-t / 0.003) * 0.2 + Math.sin(2 * Math.PI * 160 * t) * Math.exp(-t / 0.01) * 0.15); } }
// A two-note bell for the check; a glow for a highlight; a soft orb tone; a glide for the push; a burst of confetti.
function ding(t0) { bell(t0, 88, 1.2, -0.2); bell(t0 + 0.09, 95, 0.9, 0.2); }
function glow(t0) { bell(t0, 91, 0.45, 0.3); bell(t0 + 0.05, 98, 0.3, -0.3); }
function orb(t0) { const i0 = idx(t0); let ph = 0; for (let n = 0; n < 0.35 * SR; n++) { const t = n / SR; ph += (2 * Math.PI * (330 + 500 * (1 - Math.exp(-t / 0.05)))) / SR; add(WL, WR, i0 + n, Math.sin(ph) * Math.min(1, t / 0.004) * Math.exp(-t / 0.09) * 0.14); } }
function glide(t0) { const i0 = idx(t0), len = Math.floor(1.1 * SR), f = svf(); for (let n = 0; n < len; n++) { const p = n / len; const s = f(rnd(), 200 + 2600 * p * p, 0.8) * Math.sin(Math.PI * p) ** 1.5 * 0.2; add(DL, DR, i0 + n, s * 0.5); add(WL, WR, i0 + n, s * 0.5); } }
function burst(t0) { for (let k = 0; k < 14; k++) tick(t0 + k * 0.035 + Math.abs(rnd()) * 0.02); const i0 = idx(t0); const f = svf(); for (let n = 0; n < 0.3 * SR; n++) { const t = n / SR; add(WL, WR, i0 + n, f(rnd(), 3000, 0.8) * Math.exp(-t / 0.08) * 0.18); } }
const SFX = { pop, tick, swish, whoosh, shimmer, click, ding, glow, orb, glide, burst, impact: (t) => impact(t, 1), hit: (t) => impact(t, 0.55), "hit-soft": (t) => impact(t, 0.35) };
for (const [t, kind] of CUES) SFX[kind](t);

/* ── reverb, master ── */
function reverb(input, combs, aps, fb = 0.82, damp = 0.35) {
  const out = new Float32Array(N); const cb = combs.map((d) => ({ d, b: new Float32Array(d), i: 0, lp: 0 })); const ab = aps.map((d) => ({ d, b: new Float32Array(d), i: 0 }));
  for (let n = 0; n < N; n++) { const x = input[n] * 0.22; let s = 0; for (const c of cb) { const y = c.b[c.i]; c.lp = y * (1 - damp) + c.lp * damp; c.b[c.i] = x + c.lp * fb; c.i = (c.i + 1) % c.d; s += y; } for (const a of ab) { const y = a.b[a.i]; const v = s + y * 0.5; a.b[a.i] = v; a.i = (a.i + 1) % a.d; s = y - v * 0.5; } out[n] = s; }
  return out;
}
const RL = reverb(WL, [1687, 1777, 1601, 1523], [241, 593]);
const RR = reverb(WR, [1709, 1801, 1627, 1549], [257, 617]);
const L = new Float32Array(N), R = new Float32Array(N);
let hl = 0, hr = 0, pl = 0, pr = 0, peak = 0;
const a = 1 / (1 + (2 * Math.PI * 30) / SR);
for (let n = 0; n < N; n++) {
  const t = n / SR;
  const l = DL[n] + WL[n] * 0.85 + RL[n] * 0.6, r = DR[n] + WR[n] * 0.85 + RR[n] * 0.6;
  hl = a * (hl + l - pl); pl = l; hr = a * (hr + r - pr); pr = r;
  const fade = Math.min(1, t / 0.05) * Math.min(1, (DURATION - t) / 1.8);
  L[n] = Math.tanh(hl * 1.5) * fade; R[n] = Math.tanh(hr * 1.5) * fade;
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}
const g = 0.6 / peak;
const data = Buffer.alloc(44 + N * 4);
data.write("RIFF", 0); data.writeUInt32LE(36 + N * 4, 4); data.write("WAVE", 8); data.write("fmt ", 12);
data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(SR, 24); data.writeUInt32LE(SR * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
data.write("data", 36); data.writeUInt32LE(N * 4, 40);
for (let n = 0; n < N; n++) { data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[n] * g)) * 32767), 44 + n * 4); data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[n] * g)) * 32767), 46 + n * 4); }
writeFileSync("public/music-launch.wav", data);
console.log(`wrote public/music-launch.wav: ${DURATION}s`);
