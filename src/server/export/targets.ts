// Places a web app is also published: a GitHub repo, a Netlify site, a
// Vercel project or a Cloudflare Pages project. Tokens are kept encrypted and never sent back to the
// browser. Publishing builds the files from the live version and hands them
// to the provider; the result (or the provider's own error) is recorded.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { log } from "../log";
import { decryptSecret, encryptSecret } from "../security/secrets";
import { audit } from "../services/audit";
import { buildBundle } from "./bundle";
import { deployCloudflare, deployNetlify, deployVercel, pushGithub, verifyConnection } from "./providers";

const T = schema.siteTargets;
type Project = { id: string; orgId: string; name: string };
const isId = (x: string) => /^[0-9a-f-]{36}$/i.test(x);
const originOf = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.hostname === "localhost" ? u.origin : "";
  } catch {
    return "";
  }
};

const base = { name: z.string().trim().min(1, "Name it").max(80), url: z.string().trim().max(300).default("") };
const inputSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("github"), ...base, token: z.string().trim().max(400).optional(), repo: z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "Enter the repository as owner/name"), branch: z.string().trim().max(100).default(""), dir: z.string().trim().max(100).regex(/^[A-Za-z0-9_./-]*$/, "Letters, numbers, dots, dashes and slashes").default("site") }),
  z.object({ provider: z.literal("netlify"), ...base, token: z.string().trim().max(400).optional(), siteId: z.string().trim().max(100).default(""), siteName: z.string().trim().max(63).regex(/^[a-z0-9-]*$/, "Lowercase letters, numbers and dashes").default("") }),
  z.object({ provider: z.literal("vercel"), ...base, token: z.string().trim().max(400).optional(), project: z.string().trim().regex(/^[a-z0-9._-]{1,100}$/, "Lowercase letters, numbers, dots, dashes and underscores"), teamId: z.string().trim().max(100).default("") }),
  z.object({ provider: z.literal("cloudflare"), ...base, token: z.string().trim().max(400).optional(), accountId: z.string().trim().regex(/^[0-9a-f]{32}$/, "The account ID is 32 letters and numbers — copy it from Workers & Pages"), project: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,57}$/, "Lowercase letters, numbers and dashes") }),
]);

const configOf = (v: z.infer<typeof inputSchema>): Record<string, string> =>
  v.provider === "github" ? { repo: v.repo, branch: v.branch, dir: v.dir } : v.provider === "netlify" ? { siteId: v.siteId, siteName: v.siteName } : v.provider === "vercel" ? { project: v.project, teamId: v.teamId } : { accountId: v.accountId, project: v.project };

const out = (t: typeof T.$inferSelect) => {
  const { token, ...rest } = t;
  return { ...rest, tokenSaved: !!token };
};

export async function targets(projectId: string) {
  return (await db.select().from(T).where(eq(T.projectId, projectId)).orderBy(desc(T.createdAt))).map(out);
}

async function target(projectId: string, id: string) {
  if (!isId(id)) throw notFound("Target");
  const [t] = await db.select().from(T).where(and(eq(T.id, id), eq(T.projectId, projectId)));
  if (!t) throw notFound("Target");
  return t;
}

function parse(raw: unknown) {
  const r = inputSchema.safeParse(raw);
  if (!r.success) throw new ApiError("validation_failed", r.error.issues[0]?.message ?? "Check the fields");
  if (r.data.url && !originOf(r.data.url)) throw new ApiError("validation_failed", "The site address should start with https://");
  return r.data;
}

export async function saveTarget(p: Project, userId: string, id: string | null, raw: unknown) {
  const v = parse(raw);
  if (!id) {
    if (!v.token) throw new ApiError("validation_failed", "Paste an access token");
    const [t] = await db.insert(T).values({ projectId: p.id, provider: v.provider, name: v.name, config: configOf(v), token: encryptSecret(v.token), url: v.url, createdBy: userId }).returning();
    await audit({ orgId: p.orgId, actorId: userId, action: "export.target_added", targetType: "project", targetId: p.id, metadata: { provider: v.provider, name: v.name } });
    return out(t!);
  }
  const cur = await target(p.id, id);
  if (cur.provider !== v.provider) throw new ApiError("conflict", "A target's provider can't change — add a new one instead");
  const [t] = await db.update(T).set({ name: v.name, config: { ...cur.config, ...configOf(v) }, url: v.url || cur.url, ...(v.token ? { token: encryptSecret(v.token) } : {}) }).where(eq(T.id, cur.id)).returning();
  await audit({ orgId: p.orgId, actorId: userId, action: "export.target_changed", targetType: "project", targetId: p.id, metadata: { provider: v.provider, name: v.name, tokenReplaced: !!v.token } });
  return out(t!);
}

export async function deleteTarget(p: Project, userId: string, id: string) {
  const t = await target(p.id, id);
  await db.delete(T).where(eq(T.id, t.id));
  await audit({ orgId: p.orgId, actorId: userId, action: "export.target_removed", targetType: "project", targetId: p.id, metadata: { provider: t.provider, name: t.name } });
}

/**
 * Checks details before (or after) saving them: the provider is asked whether
 * the token works for that repo, site, project or account. Nothing is published.
 * Editing a saved target can leave the token empty to check the saved one.
 */
export async function checkConnection(p: Project, id: string | null, raw: unknown, f: typeof fetch = fetch) {
  const v = parse(raw);
  let token = v.token;
  if (!token && id) {
    const t = await target(p.id, id);
    if (t.provider !== v.provider) throw new ApiError("conflict", "A target's provider can't change");
    token = decryptSecret(t.token);
  }
  if (!token) throw new ApiError("validation_failed", "Paste an access token");
  return verifyConnection(f, v.provider, token, configOf(v));
}

/** Builds the files from the live version and publishes them to the target. */
export async function publishTo(p: Project, userId: string, id: string, f: typeof fetch = fetch) {
  const t = await target(p.id, id);
  if (t.status === "running" && t.lastRunAt && Date.now() - t.lastRunAt.getTime() < 3 * 60_000) throw new ApiError("conflict", "This is already publishing — give it a moment");
  const bundle = await buildBundle(p.id);
  await db.update(T).set({ status: "running", lastRunAt: new Date(), lastError: "" }).where(eq(T.id, t.id));
  const token = decryptSecret(t.token);
  try {
    const cfg = t.config;
    const r =
      t.provider === "github"
        ? await pushGithub(f, token, { repo: cfg.repo!, branch: cfg.branch, dir: cfg.dir }, bundle.files, `Publish ${p.name} (version ${bundle.deploymentId.slice(0, 8)})`)
        : t.provider === "netlify"
          ? await deployNetlify(f, token, { siteId: cfg.siteId, siteName: cfg.siteName }, bundle.files)
          : t.provider === "vercel"
            ? await deployVercel(f, token, { project: cfg.project!, teamId: cfg.teamId }, bundle.files)
            : await deployCloudflare(f, token, { accountId: cfg.accountId!, project: cfg.project! }, bundle.files);
    const config: Record<string, string> = "siteId" in r && typeof r.siteId === "string" ? { ...cfg, siteId: r.siteId } : cfg;
    // GitHub gives a commit link, not a site address: keep the one the person entered.
    const url = t.provider === "github" ? t.url : r.url || t.url;
    const [row] = await db.update(T).set({ status: "done", url, config, lastDeploymentId: bundle.deploymentId, lastRunAt: new Date() }).where(eq(T.id, t.id)).returning();
    await audit({ orgId: p.orgId, actorId: userId, action: "export.published", targetType: "project", targetId: p.id, metadata: { provider: t.provider, name: t.name, ref: r.ref, files: bundle.files.length, deploymentId: bundle.deploymentId } });
    return { target: out(row!), result: { ...r, files: bundle.files.length, pages: bundle.pages } };
  } catch (e) {
    const message = e instanceof ApiError ? e.message : "Publishing failed";
    if (!(e instanceof ApiError)) log.error("export.publish_failed", { projectId: p.id, provider: t.provider, error: String(e) });
    await db.update(T).set({ status: "failed", lastError: message.slice(0, 500) }).where(eq(T.id, t.id));
    throw e instanceof ApiError ? e : new ApiError("provider_error", message);
  }
}

/** Origins of this project's external sites, whose forms may post back here. */
export async function allowedOrigins(projectId: string): Promise<Set<string>> {
  const rows = await db.select({ url: T.url }).from(T).where(eq(T.projectId, projectId));
  return new Set(rows.map((r) => originOf(r.url)).filter(Boolean));
}
