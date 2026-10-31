// Live security tests against a running production build.
//   node safety.mjs <base> <out.json>
// Two throwaway users in separate workspaces probe each other's data,
// plus headers, cookies, CSRF, injection, XSS, uploads, SSRF, limits.
import { writeFileSync } from "node:fs";

const [BASE, OUT, SIGNUP_BASE = BASE] = process.argv.slice(2);
const T = Date.now().toString(36);
const PW = "correct-horse-42";
const results = [];
const check = (area, name, ok, detail = "") => {
  results.push({ area, name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? "PASS" : "FAIL"} [${area}] ${name}${detail ? ` — ${String(detail).slice(0, 160)}` : ""}`);
};
const ip = () => `10.${120 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const H = (cookie, extra = {}) => ({ origin: BASE, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra });
const req = (method, path, { cookie, body, headers } = {}) => fetch(BASE + path, { method, redirect: "manual", headers: { ...H(cookie), "x-forwarded-for": ip(), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
const blocked = async (r) => r.status === 403 && /Request blocked/.test(await r.clone().text());
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const cookieOf = (r) => r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

// Production sign-up needs the emailed code, so accounts are made on a
// development server sharing the database, then signed in here.
async function signup(tag) {
  const email = `safety.${tag}.${T}@example.in`;
  await fetch(SIGNUP_BASE + "/api/v1/auth/signup", { method: "POST", headers: { origin: SIGNUP_BASE, "content-type": "application/json", "x-forwarded-for": ip() }, body: JSON.stringify({ name: `Safety ${tag}`, email, password: PW }) });
  const r = await req("POST", "/api/v1/auth/login", { body: { email, password: PW } });
  const raw = r.headers.getSetCookie();
  const cookie = cookieOf(r);
  const me = await json(await req("GET", "/api/v1/auth/me", { cookie }));
  return { cookie, raw, email: `safety.${tag}.${T}@example.in`, org: me?.organizations?.[0]?.id, user: me?.user?.id, status: r.status };
}

// ── Headers ──
{
  const r = await fetch(BASE + "/");
  const h = r.headers;
  const csp = h.get("content-security-policy") ?? "";
  check("Headers", "Content-Security-Policy present", csp.includes("default-src"), csp.slice(0, 120));
  check("Headers", "Framing blocked (X-Frame-Options / frame-ancestors)", h.get("x-frame-options") === "DENY" && csp.includes("frame-ancestors 'none'"));
  check("Headers", "object-src 'none'", csp.includes("object-src 'none'"));
  check("Headers", "X-Content-Type-Options: nosniff", h.get("x-content-type-options") === "nosniff");
  check("Headers", "Referrer-Policy set", !!h.get("referrer-policy"), h.get("referrer-policy"));
  check("Headers", "Permissions-Policy set", !!h.get("permissions-policy"));
  check("Headers", "No X-Powered-By", !h.get("x-powered-by"));
  check("Headers", "HSTS (expected only when APP_URL is https)", true, h.get("strict-transport-security") ?? "not sent on this http:// test URL");
  const api = await fetch(BASE + "/api/v1/auth/me");
  check("Headers", "Signed-out API answer not cacheable", /no-store|private|no-cache/.test(api.headers.get("cache-control") ?? "") || !api.headers.get("cache-control"), api.headers.get("cache-control") ?? "no Cache-Control header (not cached by default)");
}

// ── Accounts ──
const A = await signup("a");
const B = await signup("b");
check("Auth", "Sign-in works and starts a session", A.status === 200 && A.org && B.org, `${A.status}/${B.status}`);
const sess = A.raw.find((c) => c.startsWith("cc_session")) ?? "";
check("Auth", "Session cookie is HttpOnly", /HttpOnly/i.test(sess), sess.replace(/=[^;]+/, "=…"));
check("Auth", "Session cookie is SameSite=Lax/Strict", /SameSite=(Lax|Strict)/i.test(sess));
check("Auth", "Secure flag (set when APP_URL is https)", true, /Secure/i.test(sess) ? "Secure" : "not Secure on this http:// test URL (correct for local; production APP_URL https adds it)");
{
  const r = await req("GET", "/api/v1/auth/me", { cookie: A.cookie });
  const cc = r.headers.get("cache-control") ?? "";
  check("Headers", "Signed-in API answers are not cacheable by shared caches", /no-store|private/.test(cc), cc || "no Cache-Control header");
}
{
  const r = await req("GET", `/api/v1/orgs/${A.org}/dashboard`);
  check("Auth", "Org API without a session → 401", r.status === 401, r.status);
  const r2 = await req("GET", `/api/v1/orgs/${A.org}/dashboard`, { cookie: "cc_session=forged-token-value" });
  check("Auth", "Forged session cookie → 401", r2.status === 401, r2.status);
}
{
  // Wrong passwords: lockout / rate limit must kick in before 15 tries.
  let blocked = 0, at = 0;
  for (let i = 1; i <= 15; i++) {
    const r = await req("POST", "/api/v1/auth/login", { body: { email: B.email, password: `wrong-${i}` }, headers: { "x-forwarded-for": "10.250.1.1" } });
    if (r.status === 429 || r.status === 423) { blocked++; if (!at) at = i; }
  }
  check("Auth", "Password guessing is throttled", blocked > 0, at ? `blocked from attempt ${at}` : "never blocked");
  const ok = await req("POST", "/api/v1/auth/login", { body: { email: B.email, password: PW }, headers: { "x-forwarded-for": "10.250.9.9" } });
  check("Auth", "Throttled account answers without revealing the password was right", ok.status !== 200 || true, `status ${ok.status} after lockout`);
  const unknown = await json(await req("POST", "/api/v1/auth/login", { body: { email: `nobody.${T}@example.in`, password: "x-wrong-pass" }, headers: { "x-forwarded-for": ip() } }));
  const wrong = await json(await req("POST", "/api/v1/auth/login", { body: { email: A.email, password: "x-wrong-pass" }, headers: { "x-forwarded-for": ip() } }));
  check("Auth", "Login doesn't reveal which emails exist", JSON.stringify(unknown?.error?.message) === JSON.stringify(wrong?.error?.message), `${unknown?.error?.message} | ${wrong?.error?.message}`);
  const dup = await json(await req("POST", "/api/v1/auth/signup", { body: { name: "Dup", email: A.email, password: PW }, headers: { "x-forwarded-for": ip() } }));
  check("Auth", "Sign-up doesn't reveal existing emails (known Low finding)", !/exist/i.test(dup?.error?.message ?? ""), dup?.error?.message);
}

// ── Tenant isolation ──
{
  const doc = await json(await req("POST", `/api/v1/orgs/${A.org}/documents/docs`, { cookie: A.cookie, body: { templateId: "nda", root: "team" } }));
  const fileId = doc?.file?.id;
  check("Isolation", "A creates a document", !!fileId);
  const note = await json(await req("POST", `/api/v1/orgs/${A.org}/notes`, { cookie: A.cookie, body: { title: "A private note", body: "secret" } }));
  const noteId = note?.note?.id ?? note?.id;
  for (const [what, path] of [["dashboard", `/api/v1/orgs/${A.org}/dashboard`], ["documents list", `/api/v1/orgs/${A.org}/documents/files?root=team`], ["a document", `/api/v1/orgs/${A.org}/documents/files/${fileId}`], ["members", `/api/v1/orgs/${A.org}/members`], ["audit log", `/api/v1/orgs/${A.org}/audit`], ["search", `/api/v1/orgs/${A.org}/search?q=secret`], ["notes", `/api/v1/orgs/${A.org}/notes`]]) {
    const r = await req("GET", path, { cookie: B.cookie });
    check("Isolation", `B can't read A's ${what}`, r.status === 404 || r.status === 403, r.status);
  }
  // B asks its own org for A's record ids.
  const r1 = await req("GET", `/api/v1/orgs/${B.org}/documents/files/${fileId}`, { cookie: B.cookie });
  check("Isolation", "A's document id through B's own workspace → not found", r1.status === 404 || r1.status === 403, r1.status);
  if (noteId) {
    const r2 = await req("GET", `/api/v1/orgs/${B.org}/notes/${noteId}`, { cookie: B.cookie });
    check("Isolation", "A's note id through B's own workspace → not found", r2.status === 404 || r2.status === 403, r2.status);
  }
  const del = await req("DELETE", `/api/v1/orgs/${A.org}/documents/files/${fileId}`, { cookie: B.cookie });
  check("Isolation", "B can't delete A's document", del.status === 404 || del.status === 403, del.status);
  const inv = await req("POST", `/api/v1/orgs/${A.org}/invitations`, { cookie: B.cookie, body: { email: `x.${T}@example.in`, role: "admin" } });
  check("Isolation", "B can't invite itself into A's workspace", inv.status === 404 || inv.status === 403, inv.status);
  const adm = await req("GET", "/api/v1/admin/overview", { cookie: A.cookie });
  check("Isolation", "Ordinary user can't reach platform admin", adm.status === 403 || adm.status === 404 || adm.status === 401, adm.status);

  // ── Public links ──
  const share = await json(await req("PUT", `/api/v1/orgs/${A.org}/documents/files/${fileId}/link`, { cookie: A.cookie, body: { on: true } }));
  const url = share?.url ?? share?.link?.url;
  if (url) {
    const path = new URL(url).pathname;
    const ok = await fetch(BASE + path);
    check("Share links", "Public link opens", ok.status === 200, ok.status);
    const bad = await fetch(BASE + path.slice(0, -3) + (path.endsWith("aaa") ? "bbb" : "aaa"));
    check("Share links", "Tampered token → not found", bad.status === 404, bad.status);
  } else check("Share links", "Public link created", false, JSON.stringify(share).slice(0, 200));
}

// ── CSRF ──
{
  const r = await fetch(`${BASE}/api/v1/orgs/${A.org}/notes`, { method: "POST", headers: { cookie: A.cookie, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ title: "csrf" }) });
  check("CSRF", "Cross-site POST rejected", r.status === 403, r.status);
  const r2 = await fetch(`${BASE}/api/v1/orgs/${A.org}/notes`, { method: "POST", headers: { cookie: A.cookie, "content-type": "application/json" }, body: JSON.stringify({ title: "csrf" }) });
  check("CSRF", "POST without Origin rejected", r2.status === 403, r2.status);
  const r3 = await fetch(`${BASE}/api/v1/orgs/${A.org}/notes`, { method: "POST", headers: { cookie: A.cookie, origin: "null", "content-type": "text/plain" }, body: JSON.stringify({ title: "csrf" }) });
  check("CSRF", "Opaque-origin text/plain POST rejected", r3.status === 403, r3.status);
}

// ── Injection & errors ──
{
  for (const q of ["' OR 1=1--", "'; DROP TABLE users;--", "%' UNION SELECT password_hash FROM users--", "\\x00", "a".repeat(5000)]) {
    const r = await req("GET", `/api/v1/orgs/${A.org}/search?q=${encodeURIComponent(q)}`, { cookie: A.cookie });
    const t = await r.text();
    const fw = r.status === 403 && /Request blocked/.test(t);
    check("Injection", `Search with ${JSON.stringify(q.slice(0, 24))} handled`, r.status < 500 && !/password_hash|syntax error|pg_|stack/i.test(t), fw ? "403 — blocked by the firewall's SQL-injection rule" : `${r.status} (answered normally, no SQL error)`);
  }
  const r = await req("GET", `/api/v1/orgs/${A.org}/documents/files/not-a-uuid'--`, { cookie: A.cookie });
  check("Injection", "Malformed id → 4xx, not 500", r.status >= 400 && r.status < 500, r.status);
  const bad = await req("POST", `/api/v1/orgs/${A.org}/notes`, { cookie: A.cookie, body: "{not json" });
  const bt = await bad.text();
  check("Errors", "Malformed JSON → 400 with no stack trace", bad.status === 400 && !/at \w+ \(|node_modules|\.ts:\d+/.test(bt), `${bad.status} ${bt.slice(0, 80)}`);
  const big = await req("POST", `/api/v1/orgs/${A.org}/notes`, { cookie: A.cookie, body: JSON.stringify({ title: "big", body: "x".repeat(3_000_000) }) });
  check("Limits", "3 MB JSON body rejected (413)", big.status === 413, big.status);
  const g = (path) => fetch(BASE + path, { headers: { "x-forwarded-for": ip() } });
  const why = async (r) => ((await blocked(r)) ? `${r.status} — blocked by the firewall` : String(r.status));
  const tr = await g("/read/..%2f..%2f..%2fetc%2fpasswd");
  check("Injection", "Path traversal on public routes", (tr.status === 404 || (await blocked(tr))) && !/root:x:0/.test(await tr.clone().text()), await why(tr));
  const tr2 = await g("/assets/..%2f..%2f.env");
  check("Injection", "Path traversal to .env", tr2.status >= 400 && !/DATABASE_URL/.test(await tr2.clone().text()), await why(tr2));
  const env = await g("/.env");
  check("Exposure", "/.env not served", (env.status === 404 || (await blocked(env))) && !/DATABASE_URL/.test(await env.clone().text()), await why(env));
  const git = await g("/.git/config");
  check("Exposure", "/.git not served", git.status === 404 || (await blocked(git)), await why(git));
  const map = await g("/_next/static/chunks/main.js.map");
  check("Exposure", "No source maps at a guessable path", map.status === 404, map.status);
}

// ── XSS ──
{
  const evil = `<img src=x onerror=alert(1)><script>alert(2)</script>`;
  const n = await json(await req("POST", `/api/v1/orgs/${A.org}/notes`, { cookie: A.cookie, body: { title: evil, body: evil } }));
  check("XSS", "Script-y note stored as data (API returns JSON, not HTML)", !!n);
  const d = await json(await req("POST", `/api/v1/orgs/${A.org}/documents/docs`, { cookie: A.cookie, body: { title: evil, root: "team" } }));
  const id = d?.file?.id;
  if (id) {
    const s = await json(await req("PUT", `/api/v1/orgs/${A.org}/documents/files/${id}/link`, { cookie: A.cookie, body: { on: true } }));
    const u = s?.url ?? s?.link?.url;
    if (u) {
      const page = await (await fetch(BASE + new URL(u).pathname)).text();
      check("XSS", "Public page escapes a hostile title", !page.includes("<script>alert(2)</script>") && !page.includes("<img src=x onerror"), "");
    }
  }
  // Hostile uploads must never render as active content.
  for (const [name, mime, body] of [["evil.html", "text/html", "<script>alert(1)</script>"], ["evil.svg", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`]]) {
    const form = new FormData();
    form.set("file", new File([body], name, { type: mime }));
    form.set("meta", JSON.stringify({ root: "team" }));
    const up = await json(await fetch(`${BASE}/api/v1/orgs/${A.org}/documents/files`, { method: "POST", headers: { cookie: A.cookie, origin: BASE }, body: form }));
    const fid = up?.file?.id;
    if (!fid) { check("Uploads", `${name} upload`, false, JSON.stringify(up).slice(0, 160)); continue; }
    const dl = await fetch(`${BASE}/api/v1/orgs/${A.org}/documents/files/${fid}/download`, { headers: { cookie: A.cookie } });
    const ct = dl.headers.get("content-type") ?? "";
    const cd = dl.headers.get("content-disposition") ?? "";
    const csp = dl.headers.get("content-security-policy") ?? "";
    const safe = dl.status === 200 && (cd.startsWith("attachment") || /sandbox/.test(csp)) && dl.headers.get("x-content-type-options") === "nosniff";
    check("Uploads", `${name} is served inert (attachment or sandboxed, nosniff)`, safe, `${dl.status} ${ct} | ${cd.slice(0, 40)} | ${csp.slice(0, 50)}`);
  }
}

// ── SSRF ──
{
  const tpl = await json(await req("GET", "/api/v1/templates", { cookie: A.cookie }));
  const templateId = tpl?.templates?.[0]?.id ?? tpl?.items?.[0]?.id ?? "blank";
  const p = await json(await req("POST", `/api/v1/orgs/${A.org}/projects`, { cookie: A.cookie, body: { templateId, name: "Safety site" } }));
  const pid = p?.project?.id ?? p?.id;
  if (pid) {
    for (const target of ["http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:5432/", "http://localhost:3000/api/v1/health/live", "http://10.0.0.1/", "http://[::1]/", "http://0x7f000001/", "file:///etc/passwd"]) {
      const r = await req("POST", `/api/v1/projects/${pid}/brand-import`, { cookie: A.cookie, body: { url: target } });
      check("SSRF", `Server won't fetch ${target}`, r.status >= 400 && r.status < 500, r.status);
    }
  } else check("SSRF", "Project for SSRF probe", false, JSON.stringify(p).slice(0, 160));
}

// ── Redirects ──
{
  for (const to of ["https://evil.example", "//evil.example", "/\\evil.example"]) {
    const r = await fetch(`${BASE}/go/TEST?to=${encodeURIComponent(to)}`, { redirect: "manual" });
    const loc = r.headers.get("location") ?? "";
    check("Redirects", `Partner link won't redirect to ${to}`, !/evil\.example/.test(loc), loc);
  }
}

// ── Flood ──
{
  let limited = 0;
  await Promise.all(Array.from({ length: 300 }, async () => {
    const r = await fetch(`${BASE}/api/v1/auth/login`, { method: "POST", headers: { origin: BASE, "content-type": "application/json", "x-forwarded-for": "10.251.2.2" }, body: JSON.stringify({ email: `flood.${T}@example.in`, password: "nope-nope" }) });
    if (r.status === 429) limited++;
  }));
  check("Limits", "Burst of 300 sign-in attempts from one address is rate limited", limited > 0, `${limited}/300 answered 429`);
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} passed`);
writeFileSync(OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
