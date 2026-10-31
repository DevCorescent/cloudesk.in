// Load test for a running Cloudesk production build. No dependencies.
//   node load.mjs <base> <email> <password> <out.json> [stageSeconds] [concurrencies]
// Each virtual user loops: pick a weighted scenario, send it, record latency.
// One signed-in session per virtual user (logins are spread over a few seconds
// and source addresses so the sign-in limiter isn't what we measure).
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const [BASE, EMAIL, PASSWORD, OUT, STAGE = "30", LEVELS = "10,25,50,100,200"] = process.argv.slice(2);
const stageMs = Number(STAGE) * 1000;
const levels = LEVELS.split(",").map(Number);
const ORIGIN = { origin: BASE };

async function login(i) {
  const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { ...ORIGIN, "content-type": "application/json", "x-forwarded-for": `10.9${i % 10}.${(i * 7) % 250}.${(i * 13) % 250}` }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
  if (!r.ok) throw new Error(`login ${r.status} ${await r.text()}`);
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

let ORG = "";
const S = (name, weight, fn) => ({ name, weight, fn });
const get = (path, cookie, iph) => fetch(BASE + path, { headers: { cookie: cookie ?? "", accept: "*/*", "x-forwarded-for": iph ?? "10.200.0.1" } });
const scenarios = [
  S("GET / (marketing)", 8, (c, i) => get("/", undefined, i)),
  S("GET /pricing", 3, (c, i) => get("/pricing", undefined, i)),
  S("GET /api/v1/health/live", 4, (c, i) => get("/api/v1/health/live", undefined, i)),
  S("GET /home (app page)", 6, (c, i) => get("/home", c, i)),
  S("GET auth/me", 12, (c, i) => get("/api/v1/auth/me", c, i)),
  S("GET dashboard", 14, (c, i) => get(`/api/v1/orgs/${ORG}/dashboard`, c, i)),
  S("GET documents (drive)", 8, (c, i) => get(`/api/v1/orgs/${ORG}/documents/files?root=team`, c, i)),
  S("GET search", 8, (c, i) => get(`/api/v1/orgs/${ORG}/search?q=rao`, c, i)),
  S("GET notifications", 8, (c, i) => get(`/api/v1/orgs/${ORG}/notifications`, c, i)),
  S("GET inbox (my work)", 6, (c, i) => get(`/api/v1/orgs/${ORG}/inbox`, c, i)),
  S("POST note (write)", 3, (c, i) => fetch(`${BASE}/api/v1/orgs/${ORG}/notes`, { method: "POST", headers: { cookie: c, ...ORIGIN, "content-type": "application/json", "x-forwarded-for": i }, body: JSON.stringify({ title: `Load test ${Date.now()}`, body: "Written by the load test." }) })),
];
const total = scenarios.reduce((a, s) => a + s.weight, 0);
const pick = () => {
  let r = Math.random() * total;
  for (const s of scenarios) if ((r -= s.weight) < 0) return s;
  return scenarios[0];
};

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : null);
const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

async function stage(n, cookies) {
  const rec = new Map(scenarios.map((s) => [s.name, { lat: [], status: {}, errors: 0 }]));
  const end = performance.now() + stageMs;
  let done = 0;
  const vu = async (i) => {
    const cookie = cookies[i % cookies.length];
    const ipv = `10.${100 + (i % 100)}.${Math.floor(i / 100)}.${(i * 37) % 250}`;
    while (performance.now() < end) {
      const s = pick();
      const r = rec.get(s.name);
      const t = performance.now();
      try {
        const res = await s.fn(cookie, ipv);
        await res.arrayBuffer();
        r.lat.push(performance.now() - t);
        r.status[res.status] = (r.status[res.status] ?? 0) + 1;
      } catch (e) {
        r.errors++;
        r.status[e.cause?.code ?? "ERR"] = (r.status[e.cause?.code ?? "ERR"] ?? 0) + 1;
      }
      done++;
    }
  };
  const t0 = performance.now();
  await Promise.all(Array.from({ length: n }, (_, i) => vu(i)));
  const secs = (performance.now() - t0) / 1000;
  const all = [];
  const endpoints = [];
  for (const [name, r] of rec) {
    r.lat.sort((a, b) => a - b);
    all.push(...r.lat);
    const count = r.lat.length + r.errors;
    const bad = Object.entries(r.status).filter(([k]) => !/^[23]/.test(k)).reduce((a, [, v]) => a + v, 0);
    endpoints.push({ name, count, rps: round(count / secs), p50: round(pct(r.lat, 50)), p95: round(pct(r.lat, 95)), p99: round(pct(r.lat, 99)), max: round(r.lat.at(-1)), status: r.status, errorRate: count ? round((bad / count) * 100) : 0 });
  }
  all.sort((a, b) => a - b);
  const failures = endpoints.reduce((a, e) => a + Object.entries(e.status).filter(([k]) => !/^[23]/.test(k)).reduce((x, [, v]) => x + v, 0), 0);
  return { concurrency: n, seconds: round(secs), requests: done, rps: round(done / secs), p50: round(pct(all, 50)), p95: round(pct(all, 95)), p99: round(pct(all, 99)), max: round(all.at(-1)), errorRate: round((failures / Math.max(1, done)) * 100), endpoints };
}

const me = async (cookie) => (await (await get("/api/v1/auth/me", cookie)).json()).organizations[0].id;
const sessions = [];
const need = Number(process.env.SESSIONS ?? 6);
for (let i = 0; i < need; i++) {
  sessions.push(await login(i));
  await new Promise((r) => setTimeout(r, 120));
}
ORG = await me(sessions[0]);
console.log(`${sessions.length} sessions for org ${ORG}`);
// Warm every route once so first-compile/cold caches aren't in the numbers.
for (const s of scenarios) await (await s.fn(sessions[0])).arrayBuffer();

const results = [];
for (const n of levels) {
  const r = await stage(n, sessions);
  results.push(r);
  console.log(`c=${n}  ${r.rps} req/s  p50 ${r.p50}ms  p95 ${r.p95}ms  p99 ${r.p99}ms  errors ${r.errorRate}%`);
  await new Promise((res) => setTimeout(res, 3000));
}
writeFileSync(OUT, JSON.stringify({ base: BASE, stageSeconds: Number(STAGE), at: new Date().toISOString(), results }, null, 2));
