import { promises as dnsp } from "node:dns";
import { isIP } from "node:net";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { randomToken } from "../security/tokens";
import { audit } from "./audit";
import { assertWithinLimit } from "../billing/billing";

// Custom domains. Ownership is proven with a TXT record; traffic reaches the
// platform through a CNAME (or A record) the owner points at us. TLS
// certificates are issued by the edge proxy in front of the app (for example
// Caddy on-demand TLS, which asks /api/v1/domains/ask before issuing).

export const TXT_PREFIX = "_creationcloud";

type Resolver = { txt: (name: string) => Promise<string[][]>; cname: (name: string) => Promise<string[]>; a: (name: string) => Promise<string[]> };
let resolver: Resolver = { txt: (n) => dnsp.resolveTxt(n), cname: (n) => dnsp.resolveCname(n), a: (n) => dnsp.resolve4(n) };
/** Injectable for tests. */
export function setDomainResolver(r: Resolver) {
  resolver = r;
}

/** Where customers point their domain. Configure for your deployment. */
export function dnsTarget() {
  return { cname: (process.env.CUSTOM_DOMAIN_CNAME ?? "").toLowerCase().replace(/\.$/, ""), ipv4: (process.env.CUSTOM_DOMAIN_IPV4 ?? "").split(",").map((s) => s.trim()).filter(Boolean) };
}

/** Hosts that belong to the platform itself (never treated as customer domains). */
export function isPlatformHost(host: string) {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  // The same addresses the proxy serves as the platform (src/proxy.ts): APP_URL, Vercel's domains for this project, PLATFORM_HOSTS — each with and without www.
  const own = [process.env.APP_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, ...(process.env.PLATFORM_HOSTS ?? "").split(",")]
    .map((u) => { try { return u?.trim() ? new URL(u.includes("://") ? u.trim() : `https://${u.trim()}`).hostname.toLowerCase() : ""; } catch { return ""; } })
    .filter(Boolean)
    .flatMap((x) => [x, x.startsWith("www.") ? x.slice(4) : `www.${x}`]);
  return own.includes(h) || h.endsWith(".vercel.app") || h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h === dnsTarget().cname;
}

export function normalizeHostname(input: string) {
  const h = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (h.length > 253 || isIP(h) || !/^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/.test(h)) throw new ApiError("validation_failed", "Enter a domain like shop.example.com", { hostname: ["Invalid domain"] });
  if (isPlatformHost(h)) throw new ApiError("validation_failed", "That is the platform's own domain", { hostname: ["Not allowed"] });
  return h;
}

export async function listDomains(projectId: string) {
  return db.select().from(schema.siteDomains).where(eq(schema.siteDomains.projectId, projectId));
}

export async function addDomain(project: { id: string; orgId: string }, userId: string, raw: string) {
  const hostname = normalizeHostname(raw);
  const [taken] = await db.select({ projectId: schema.siteDomains.projectId }).from(schema.siteDomains).where(eq(schema.siteDomains.hostname, hostname));
  if (taken) throw new ApiError("conflict", taken.projectId === project.id ? "This domain is already added" : "This domain is connected to another site", { hostname: ["Already in use"] });
  const existing = await listDomains(project.id);
  if (existing.length >= 5) throw new ApiError("conflict", "A site can have up to 5 domains");
  await assertWithinLimit(project.orgId, "customDomains");
  const [d] = await db.insert(schema.siteDomains).values({ projectId: project.id, hostname, verificationToken: `cc-verify=${randomToken(16)}`, createdBy: userId }).returning();
  await audit({ orgId: project.orgId, actorId: userId, action: "domain.added", targetType: "domain", targetId: d.id, metadata: { hostname } });
  return d;
}

export async function removeDomain(project: { id: string; orgId: string }, userId: string, id: string) {
  const r = await db.delete(schema.siteDomains).where(and(eq(schema.siteDomains.id, id), eq(schema.siteDomains.projectId, project.id))).returning();
  if (!r.length) throw notFound("Domain");
  await audit({ orgId: project.orgId, actorId: userId, action: "domain.removed", targetType: "domain", targetId: id, metadata: { hostname: r[0].hostname } });
}

const flat = (txt: string[][]) => txt.map((parts) => parts.join(""));

/** Checks the TXT ownership record and that traffic is pointed at the platform. */
export async function checkDomain(projectId: string, id: string) {
  const [d] = await db.select().from(schema.siteDomains).where(and(eq(schema.siteDomains.id, id), eq(schema.siteDomains.projectId, projectId)));
  if (!d) throw notFound("Domain");
  const problems: string[] = [];
  const txt = await resolver.txt(`${TXT_PREFIX}.${d.hostname}`).then(flat, () => [] as string[]);
  if (!txt.includes(d.verificationToken)) problems.push(`TXT record ${TXT_PREFIX}.${d.hostname} with value ${d.verificationToken} was not found yet.`);
  const target = dnsTarget();
  if (target.cname || target.ipv4.length) {
    const cname = await resolver.cname(d.hostname).catch(() => [] as string[]);
    const a = await resolver.a(d.hostname).catch(() => [] as string[]);
    const pointed = (target.cname && cname.some((c) => c.toLowerCase().replace(/\.$/, "") === target.cname)) || a.some((ip) => target.ipv4.includes(ip));
    if (!pointed) problems.push(target.cname ? `${d.hostname} should have a CNAME record pointing to ${target.cname}.` : `${d.hostname} should have an A record pointing to ${target.ipv4.join(" or ")}.`);
  }
  const ok = problems.length === 0;
  const [u] = await db
    .update(schema.siteDomains)
    .set({ status: ok ? "verified" : d.status === "verified" ? "failed" : "pending", lastError: ok ? null : problems.join(" "), lastCheckedAt: new Date(), ...(ok && !d.verifiedAt ? { verifiedAt: new Date() } : {}) })
    .where(eq(schema.siteDomains.id, d.id))
    .returning();
  return u;
}

/** The project a verified custom host serves, if any. */
export async function projectForHost(host: string) {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  const [r] = await db
    .select({ projectId: schema.projects.id, prod: schema.projects.productionDeploymentId, archived: schema.projects.archivedAt })
    .from(schema.siteDomains)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.siteDomains.projectId))
    .where(and(eq(schema.siteDomains.hostname, h), eq(schema.siteDomains.status, "verified")));
  return r && !r.archived ? r : null;
}

export async function hostServesProject(host: string, projectId: string) {
  return (await projectForHost(host))?.projectId === projectId;
}

/** Public origin for a request (respects the edge proxy's forwarded protocol). */
export function originOf(req: Request) {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  const proto = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
