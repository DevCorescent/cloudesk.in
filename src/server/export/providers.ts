// Publishing a web app's files to GitHub, Netlify, Vercel or Cloudflare Pages with the person's
// own access token. Each call is the provider's documented REST API; success
// is only reported when the provider says so (a commit sha, a deploy that
// reached "ready"). Nothing here is simulated.
import { createHash } from "node:crypto";
import { ApiError } from "../http/errors";
import type { BundleFile } from "./bundle";
import { zip } from "./zip";

export type Result = { url: string; ref: string; note: string };
type Fetch = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(f: Fetch, url: string, init: RequestInit, what: string): Promise<T> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch {
    throw new ApiError("provider_error", `Couldn't reach ${what}. Check the connection and try again.`);
  }
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return { message: text.slice(0, 200) }; } })() : {};
  if (!res.ok) {
    const b = body as { message?: string; error?: { message?: string }; errors?: { message?: string }[] };
    const msg = String(b.message ?? b.error?.message ?? b.errors?.[0]?.message ?? "");
    if (res.status === 401 || res.status === 403) throw new ApiError("provider_error", `${what} refused the token — check it's valid and allowed to publish here${msg ? ` (${msg})` : ""}.`);
    if (res.status === 404) throw new ApiError("provider_error", `${what} couldn't find that ${what === "GitHub" ? "repository or branch" : "site or project"}${msg ? ` (${msg})` : ""}.`);
    throw new ApiError("provider_error", `${what} said: ${msg || `error ${res.status}`}`);
  }
  return body as T;
}

// ─── GitHub ──────────────────────────────────────────────────────────────────

/** Commits the files to `dir` in the repo's branch: one commit, files from an earlier export that are gone removed. */
export async function pushGithub(f: Fetch, token: string, cfg: { repo: string; branch?: string; dir?: string }, files: BundleFile[], message: string): Promise<Result> {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(cfg.repo)) throw new ApiError("validation_failed", "Enter the repository as owner/name");
  const api = `https://api.github.com/repos/${cfg.repo}`;
  const h = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "Cloudesk" };
  const repo = await call<{ default_branch: string; html_url: string; permissions?: { push?: boolean } }>(f, api, { headers: h }, "GitHub");
  if (repo.permissions && !repo.permissions.push) throw new ApiError("provider_error", "This token can read the repository but not push to it. Give it Contents: write access.");
  const branch = cfg.branch || repo.default_branch;
  const dir = (cfg.dir ?? "").replace(/^\/+|\/+$/g, "");
  const at = (p: string) => (dir ? `${dir}/${p}` : p);
  let ref: { object: { sha: string } };
  try {
    ref = await call(f, `${api}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: h }, "GitHub");
  } catch (e) {
    // An empty repository has no branch yet: start it with the README, then build on that.
    const readme = files.find((x) => x.path === "README.md");
    await call(f, `${api}/contents/${encodeURIComponent(at("README.md"))}`, { method: "PUT", headers: h, body: JSON.stringify({ message: "Start the site", content: Buffer.from(readme?.data ?? "# Site\n").toString("base64"), branch }) }, "GitHub").catch(() => {
      throw e;
    });
    ref = await call(f, `${api}/git/ref/heads/${encodeURIComponent(branch)}`, { headers: h }, "GitHub");
  }
  const head = await call<{ tree: { sha: string } }>(f, `${api}/git/commits/${ref.object.sha}`, { headers: h }, "GitHub");
  const existing = await call<{ tree: { path: string; type: string }[]; truncated?: boolean }>(f, `${api}/git/trees/${head.tree.sha}?recursive=1`, { headers: h }, "GitHub");
  const ours = new Set(files.map((x) => at(x.path)));
  // Old exported pages under the export folder go; everything else in the repo stays.
  const stale = dir && !existing.truncated ? existing.tree.filter((t) => t.type === "blob" && t.path.startsWith(`${dir}/`) && !ours.has(t.path)).map((t) => ({ path: t.path, mode: "100644", type: "blob", sha: null })) : [];
  const tree = await call<{ sha: string }>(
    f,
    `${api}/git/trees`,
    { method: "POST", headers: h, body: JSON.stringify({ base_tree: head.tree.sha, tree: [...files.map((x) => ({ path: at(x.path), mode: "100644", type: "blob", content: x.data })), ...stale] }) },
    "GitHub",
  );
  const commit = await call<{ sha: string; html_url: string }>(f, `${api}/git/commits`, { method: "POST", headers: h, body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) }, "GitHub");
  await call(f, `${api}/git/refs/heads/${encodeURIComponent(branch)}`, { method: "PATCH", headers: h, body: JSON.stringify({ sha: commit.sha, force: false }) }, "GitHub");
  return { url: commit.html_url || `${repo.html_url}/commit/${commit.sha}`, ref: commit.sha, note: `Committed ${files.length} files to ${cfg.repo}@${branch}${dir ? `/${dir}` : ""}` };
}

// ─── Netlify ─────────────────────────────────────────────────────────────────

/** Uploads the site as a zip to a Netlify site (made first if there isn't one) and waits for it to go live. */
export async function deployNetlify(f: Fetch, token: string, cfg: { siteId?: string; siteName?: string }, files: BundleFile[], opts: { pollMs?: number; tries?: number } = {}): Promise<Result & { siteId: string }> {
  const h = { authorization: `Bearer ${token}`, "user-agent": "Cloudesk" };
  let siteId = cfg.siteId;
  let siteUrl = "";
  if (!siteId) {
    const site = await call<{ id: string; ssl_url?: string; url?: string }>(f, "https://api.netlify.com/api/v1/sites", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(cfg.siteName ? { name: cfg.siteName } : {}) }, "Netlify");
    siteId = site.id;
    siteUrl = site.ssl_url || site.url || "";
  }
  let d = await call<{ id: string; state: string; ssl_url?: string; deploy_ssl_url?: string; error_message?: string }>(f, `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys`, { method: "POST", headers: { ...h, "content-type": "application/zip" }, body: new Uint8Array(zip(files)) }, "Netlify");
  for (let i = 0; i < (opts.tries ?? 30) && !["ready", "error"].includes(d.state); i++) {
    await sleep(opts.pollMs ?? 2000);
    d = await call(f, `https://api.netlify.com/api/v1/deploys/${d.id}`, { headers: h }, "Netlify");
  }
  if (d.state === "error") throw new ApiError("provider_error", `Netlify couldn't publish it: ${d.error_message || "deploy failed"}`);
  if (d.state !== "ready") throw new ApiError("provider_error", `Netlify is still processing the upload (state: ${d.state}). Check again in a minute.`);
  return { siteId, url: d.ssl_url || siteUrl || d.deploy_ssl_url || "", ref: d.id, note: `Netlify deploy ${d.id} is live` };
}

// ─── Vercel ──────────────────────────────────────────────────────────────────

/** Deploys the files to a Vercel project as production and waits for it to be ready. */
export async function deployVercel(f: Fetch, token: string, cfg: { project: string; teamId?: string }, files: BundleFile[], opts: { pollMs?: number; tries?: number } = {}): Promise<Result> {
  if (!/^[a-z0-9._-]{1,100}$/.test(cfg.project)) throw new ApiError("validation_failed", "Vercel project names are lowercase letters, numbers, dots, dashes and underscores");
  const team = cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : "";
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json", "user-agent": "Cloudesk" };
  let d = await call<{ id: string; url: string; readyState: string; alias?: string[]; errorMessage?: string }>(
    f,
    `https://api.vercel.com/v13/deployments${team}`,
    { method: "POST", headers: h, body: JSON.stringify({ name: cfg.project, target: "production", files: files.map((x) => ({ file: x.path, data: x.data, encoding: "utf-8" })), projectSettings: { framework: null, buildCommand: null, installCommand: null, outputDirectory: null } }) },
    "Vercel",
  );
  for (let i = 0; i < (opts.tries ?? 30) && !["READY", "ERROR", "CANCELED"].includes(d.readyState); i++) {
    await sleep(opts.pollMs ?? 2000);
    d = await call(f, `https://api.vercel.com/v13/deployments/${d.id}${team}`, { headers: h }, "Vercel");
  }
  if (d.readyState !== "READY") throw new ApiError("provider_error", d.readyState === "ERROR" || d.readyState === "CANCELED" ? `Vercel couldn't publish it: ${d.errorMessage || d.readyState.toLowerCase()}` : `Vercel is still building (state: ${d.readyState}). Check again in a minute.`);
  const host = d.alias?.[0] ?? d.url;
  return { url: `https://${host}`, ref: d.id, note: `Vercel deployment ${d.id} is ready` };
}

// ─── Cloudflare Pages ────────────────────────────────────────────────────────

const CF = "https://api.cloudflare.com/client/v4";
const MIME: Record<string, string> = { html: "text/html", xml: "application/xml", txt: "text/plain", md: "text/markdown", json: "application/json", css: "text/css", js: "application/javascript" };
type CfEnvelope<T> = { success?: boolean; result: T };

/**
 * Direct Upload to a Cloudflare Pages project (made first if it doesn't exist):
 * the same steps Wrangler takes — an upload token, upload only the files Cloudflare
 * doesn't have yet, then a deployment from the manifest — and waits for it to finish.
 */
export async function deployCloudflare(f: Fetch, token: string, cfg: { accountId: string; project: string }, files: BundleFile[], opts: { pollMs?: number; tries?: number } = {}): Promise<Result> {
  if (!/^[0-9a-f]{32}$/.test(cfg.accountId)) throw new ApiError("validation_failed", "The Cloudflare account ID is 32 letters and numbers (Workers & Pages → right-hand side)");
  if (!/^[a-z0-9][a-z0-9-]{0,57}$/.test(cfg.project)) throw new ApiError("validation_failed", "Cloudflare project names are lowercase letters, numbers and dashes");
  const h = { authorization: `Bearer ${token}`, "user-agent": "Cloudesk" };
  const base = `${CF}/accounts/${cfg.accountId}/pages/projects`;
  let project: { name: string; subdomain?: string };
  try {
    project = (await call<CfEnvelope<typeof project>>(f, `${base}/${cfg.project}`, { headers: h }, "Cloudflare")).result;
  } catch {
    project = (await call<CfEnvelope<typeof project>>(f, base, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ name: cfg.project, production_branch: "main" }) }, "Cloudflare")).result;
  }
  const jwt = (await call<CfEnvelope<{ jwt: string }>>(f, `${base}/${cfg.project}/upload-token`, { headers: h }, "Cloudflare")).result.jwt;
  const jh = { authorization: `Bearer ${jwt}`, "content-type": "application/json", "user-agent": "Cloudesk" };
  // _headers is a setting, not a page: it goes with the deployment itself.
  const special = files.filter((x) => x.path === "_headers" || x.path === "_redirects");
  const assets = files
    .filter((x) => !special.includes(x))
    .map((x) => {
      const value = Buffer.from(x.data).toString("base64");
      const ext = x.path.split(".").pop() ?? "";
      return { path: `/${x.path}`, key: createHash("sha256").update(value + ext).digest("hex").slice(0, 32), value, contentType: MIME[ext] ?? "application/octet-stream" };
    });
  const hashes = [...new Set(assets.map((a) => a.key))];
  const missing = new Set((await call<CfEnvelope<string[]>>(f, `${CF}/pages/assets/check-missing`, { method: "POST", headers: jh, body: JSON.stringify({ hashes }) }, "Cloudflare")).result);
  const upload = assets.filter((a, i) => missing.has(a.key) && assets.findIndex((b) => b.key === a.key) === i);
  for (let i = 0; i < upload.length; i += 50) {
    const batch = upload.slice(i, i + 50).map((a) => ({ key: a.key, value: a.value, metadata: { contentType: a.contentType }, base64: true }));
    await call(f, `${CF}/pages/assets/upload`, { method: "POST", headers: jh, body: JSON.stringify(batch) }, "Cloudflare");
  }
  await call(f, `${CF}/pages/assets/upsert-hashes`, { method: "POST", headers: jh, body: JSON.stringify({ hashes }) }, "Cloudflare");
  const form = new FormData();
  form.set("manifest", JSON.stringify(Object.fromEntries(assets.map((a) => [a.path, a.key]))));
  form.set("branch", "main");
  for (const x of special) form.set(x.path, new Blob([x.data], { type: "text/plain" }), x.path);
  type Dep = { id: string; url?: string; latest_stage?: { name: string; status: string } };
  let d = (await call<CfEnvelope<Dep>>(f, `${base}/${cfg.project}/deployments`, { method: "POST", headers: h, body: form }, "Cloudflare")).result;
  const done = (x: Dep) => x.latest_stage?.status === "failure" || (x.latest_stage?.name === "deploy" && x.latest_stage.status === "success");
  for (let i = 0; i < (opts.tries ?? 30) && !done(d); i++) {
    await sleep(opts.pollMs ?? 2000);
    d = (await call<CfEnvelope<Dep>>(f, `${base}/${cfg.project}/deployments/${d.id}`, { headers: h }, "Cloudflare")).result;
  }
  if (d.latest_stage?.status === "failure") throw new ApiError("provider_error", `Cloudflare couldn't publish it (stage: ${d.latest_stage.name})`);
  if (!done(d)) throw new ApiError("provider_error", `Cloudflare is still deploying (stage: ${d.latest_stage?.name ?? "queued"}). Check again in a minute.`);
  const url = project.subdomain ? `https://${project.subdomain}` : d.url ?? "";
  return { url, ref: d.id, note: `Cloudflare Pages deployment ${d.id.slice(0, 8)} is live` };
}

// ─── Checking a connection ───────────────────────────────────────────────────

/** Asks the provider whether the token works for what was entered, without publishing anything. */
export async function verifyConnection(f: Fetch, provider: "github" | "netlify" | "vercel" | "cloudflare", token: string, cfg: Record<string, string>): Promise<{ account: string; note: string }> {
  if (provider === "github") {
    const repo = cfg.repo ?? "";
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new ApiError("validation_failed", "Enter the repository as owner/name");
    const h = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "Cloudesk" };
    const r = await call<{ full_name: string; default_branch: string; permissions?: { push?: boolean } }>(f, `https://api.github.com/repos/${repo}`, { headers: h }, "GitHub");
    if (r.permissions && !r.permissions.push) throw new ApiError("provider_error", "This token can read the repository but not push to it. Give it Contents: write access.");
    return { account: r.full_name, note: `Can push to ${r.full_name} (default branch ${r.default_branch})` };
  }
  if (provider === "netlify") {
    const h = { authorization: `Bearer ${token}`, "user-agent": "Cloudesk" };
    const u = await call<{ email?: string; full_name?: string }>(f, "https://api.netlify.com/api/v1/user", { headers: h }, "Netlify");
    const who = u.full_name || u.email || "your account";
    if (cfg.siteId) {
      const site = await call<{ name: string }>(f, `https://api.netlify.com/api/v1/sites/${encodeURIComponent(cfg.siteId)}`, { headers: h }, "Netlify");
      return { account: who, note: `Signed in as ${who}; site ${site.name} found` };
    }
    return { account: who, note: `Signed in as ${who}; a new site is made on the first publish` };
  }
  if (provider === "vercel") {
    const team = cfg.teamId ? `?teamId=${encodeURIComponent(cfg.teamId)}` : "";
    const u = await call<{ user: { username?: string; email?: string } }>(f, `https://api.vercel.com/v2/user${team}`, { headers: { authorization: `Bearer ${token}`, "user-agent": "Cloudesk" } }, "Vercel");
    const who = u.user.username || u.user.email || "your account";
    return { account: who, note: `Signed in as ${who}${cfg.teamId ? " for that team" : ""}; project ${cfg.project || "(name it)"} is made on the first publish if it doesn't exist` };
  }
  if (!/^[0-9a-f]{32}$/.test(cfg.accountId ?? "")) throw new ApiError("validation_failed", "The Cloudflare account ID is 32 letters and numbers (Workers & Pages → right-hand side)");
  const r = await call<CfEnvelope<{ name: string }[]>>(f, `${CF}/accounts/${cfg.accountId}/pages/projects`, { headers: { authorization: `Bearer ${token}`, "user-agent": "Cloudesk" } }, "Cloudflare");
  const has = r.result.some((x) => x.name === cfg.project);
  return { account: cfg.accountId, note: `Token can manage Pages in this account; ${has ? `project ${cfg.project} found` : `project ${cfg.project || "(name it)"} is made on the first publish`}` };
}
