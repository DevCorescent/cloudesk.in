import { createSign, generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as identity from "@/app/api/v1/orgs/[orgId]/identity/[[...slug]]/route";
import * as ssoStart from "@/app/api/v1/auth/sso/start/route";
import * as ssoCallback from "@/app/api/v1/auth/sso/callback/route";
import * as scimApi from "@/app/api/v1/scim/v2/[[...path]]/route";
import { setSsoDns, setSsoHttp, verifyIdToken } from "@/server/auth/sso";
import { ORIGIN, call, cookieFrom, resetDb } from "../helpers";

// A mock identity provider (its own RSA key, discovery, keys and token
// endpoint): domain verification by DNS, signing in through SSO (new people
// join with the chosen role), tokens that don't check out being refused,
// "require SSO" stopping passwords, sign-ins recorded — and SCIM provisioning.
const ISS = "https://idp.example.com";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function idToken(claims: Record<string, unknown>, kid = "k1") {
  const h = b64({ alg: "RS256", typ: "JWT", kid });
  const p = b64({ iss: ISS, aud: "cloudesk-client", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 300, sub: "u-1", email_verified: true, ...claims });
  const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(privateKey).toString("base64url");
  return `${h}.${p}.${s}`;
}
let nextToken = "";
const tokenRequests: { body: string; auth: string }[] = [];
let orgId = "";
const C: Record<string, string> = {};
const I = (method: string, path: string, body?: unknown) => call((identity as unknown as Record<string, Parameters<typeof call>[0]>)[method], { method, cookie: C.owner, body, path: `/api/v1/orgs/${orgId}/identity/${path}`, params: { orgId, slug: path.split("/").filter(Boolean) } });
async function signInSso(email: string, claims: Record<string, unknown> = {}) {
  const st = await call(ssoStart.POST, { method: "POST", body: { email } });
  if (st.status !== 200) return { status: st.status, json: st.json };
  const u = new URL(st.json.url);
  const cookie = /cc_sso=[^;]+/.exec(st.headers.get("set-cookie")!)![0];
  nextToken = idToken({ email, nonce: u.searchParams.get("nonce"), ...claims });
  const res = await ssoCallback.GET(new Request(`${ORIGIN}/api/v1/auth/sso/callback?code=abc&state=${u.searchParams.get("state")}`, { headers: { cookie } }), { params: Promise.resolve({}) });
  return { status: res.status, location: res.headers.get("location") ?? "", cookie: res.headers.get("set-cookie") ?? "", url: u };
}
async function scim(method: string, path: string, token: string | null, body?: unknown) {
  const res = await (scimApi as unknown as Record<string, (r: Request, c: { params: Promise<{ path: string[] }> }) => Promise<Response>>)[method](new Request(`${ORIGIN}/api/v1/scim/v2/${path}`, { method, headers: { "content-type": "application/scim+json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), { params: Promise.resolve({ path: path.split("?")[0].split("/") }) });
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
}

beforeAll(async () => {
  await resetDb();
  C.owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Olga Owner", email: "olga@acme.example", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: C.owner })).json.organizations[0].id;
  setSsoHttp(async (url, init) => {
    if (url === `${ISS}/.well-known/openid-configuration`) return { status: 200, text: JSON.stringify({ issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token`, jwks_uri: `${ISS}/jwks` }) };
    if (url === `${ISS}/jwks`) return { status: 200, text: JSON.stringify({ keys: [jwk] }) };
    if (url === `${ISS}/token`) {
      tokenRequests.push({ body: init.body ?? "", auth: init.headers.Authorization ?? "" });
      return { status: 200, text: JSON.stringify({ id_token: nextToken, access_token: "x" }) };
    }
    return { status: 404, text: "" };
  });
});
afterAll(async () => {
  setSsoHttp(null);
  setSsoDns(null);
  await closeDb();
});

describe("setting up SSO", () => {
  it("verifies a domain by DNS and refuses public ones", async () => {
    expect((await I("POST", "domains", { domain: "gmail.com" })).status).toBe(422);
    const d = (await I("POST", "domains", { domain: "acme.example" })).json.domain;
    setSsoDns(async () => [["something-else"]]);
    expect((await I("POST", `domains/${d.id}/verify`)).status).toBe(422);
    setSsoDns(async (name) => (name === "_cloudesk.acme.example" ? [[`cloudesk-verify=${d.token}`]] : []));
    expect((await I("POST", `domains/${d.id}/verify`)).status).toBe(200);
  });

  it("checks the issuer before saving, and keeps the secret out of answers", async () => {
    expect((await I("PUT", "sso", { issuer: "https://not-an-idp.example.com", clientId: "x", clientSecret: "y" })).status).toBe(422);
    const r = await I("PUT", "sso", { issuer: ISS, clientId: "cloudesk-client", clientSecret: "s3cret", jitRole: "editor" });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain("s3cret");
    expect(r.json.connection).toMatchObject({ issuer: ISS, enforce: false, jitRole: "editor", hasSecret: true });
  });
});

describe("signing in", () => {
  it("signs someone new in through the provider and adds them with the chosen role", async () => {
    const r = await signInSso("neha@acme.example", { name: "Neha Nair" });
    expect(r.status).toBe(302);
    expect(r.location).toMatch(/\/home$/);
    expect(r.cookie).toMatch(/cc_session=/);
    expect(r.url!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(tokenRequests.at(-1)!.body).toContain("code_verifier=");
    expect(tokenRequests.at(-1)!.auth).toBe(`Basic ${Buffer.from("cloudesk-client:s3cret").toString("base64")}`);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "neha@acme.example"));
    expect(u).toMatchObject({ name: "Neha Nair", passwordHash: null });
    expect((await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, u.id))))[0].role).toBe("editor");
    const [ev] = await db.select().from(schema.loginEvents).where(eq(schema.loginEvents.userId, u.id));
    expect(ev).toMatchObject({ ok: true, method: "sso" });
  });

  it("refuses tokens that don't check out, and other domains", async () => {
    for (const bad of [{ nonce: "wrong" }, { aud: "someone-else" }, { iss: "https://evil.example.com" }, { exp: Math.floor(Date.now() / 1000) - 3600 }, { email_verified: false }]) {
      const r = await signInSso("neha@acme.example", bad);
      expect(r.location).toContain("/login?sso=1&error=");
    }
    expect((await signInSso("x@other.example")).status).toBe(404);
    // A token signed by some other key.
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const h = b64({ alg: "RS256", kid: "k1" });
    const p = b64({ iss: ISS, aud: "cloudesk-client", exp: Math.floor(Date.now() / 1000) + 60, sub: "s", nonce: "n" });
    const forged = `${h}.${p}.${createSign("RSA-SHA256").update(`${h}.${p}`).sign(other.privateKey).toString("base64url")}`;
    await expect(verifyIdToken(forged, { issuer: ISS, clientId: "cloudesk-client", jwksUri: `${ISS}/jwks`, nonce: "n" })).rejects.toThrow(/signature/);
    expect((await db.select().from(schema.loginEvents).where(and(eq(schema.loginEvents.method, "sso"), eq(schema.loginEvents.ok, false)))).length).toBeGreaterThanOrEqual(5);
  });

  it("keeps the account's own two-step sign-in, and next can't leave the site", async () => {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, "neha@acme.example"));
    await db.update(schema.users).set({ totpEnabledAt: new Date(), totpSecret: "unused" }).where(eq(schema.users.id, u.id));
    const r = await signInSso("neha@acme.example");
    expect(r.status).toBe(302);
    expect(r.location).toContain("/login?mfa=1");
    expect(r.cookie).not.toMatch(/cc_session=/);
    expect(r.cookie).toMatch(/cc_mfa=/);
    await db.update(schema.users).set({ totpEnabledAt: null, totpSecret: null }).where(eq(schema.users.id, u.id));
    const st = await call(ssoStart.POST, { method: "POST", body: { email: "neha@acme.example", next: "/\\evil.com" } });
    const cookie = /cc_sso=[^;]+/.exec(st.headers.get("set-cookie")!)![0];
    const url = new URL(st.json.url);
    nextToken = idToken({ email: "neha@acme.example", nonce: url.searchParams.get("nonce") });
    const res = await ssoCallback.GET(new Request(`${ORIGIN}/api/v1/auth/sso/callback?code=abc&state=${url.searchParams.get("state")}`, { headers: { cookie } }), { params: Promise.resolve({}) });
    expect(new URL(res.headers.get("location")!).origin).toBe(new URL(process.env.APP_URL ?? ORIGIN).origin);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/home");
  });

  it("with SSO required, the domain's members can't use a password", async () => {
    expect((await call(login.POST, { method: "POST", body: { email: "olga@acme.example", password: "correct-horse-42" } })).status).toBe(200);
    await I("PUT", "sso", { issuer: ISS, clientId: "cloudesk-client", enforce: true, jitRole: "editor" });
    const r = await call(login.POST, { method: "POST", body: { email: "olga@acme.example", password: "correct-horse-42" } });
    expect(r.status).toBe(403);
    expect(r.json.error.message).toMatch(/single sign-on/);
    const ev = await db.select().from(schema.loginEvents).where(eq(schema.loginEvents.email, "olga@acme.example"));
    expect(ev.map((e) => e.reason)).toContain("sso required");
  });
});

describe("SCIM", () => {
  it("provisions, renames and deprovisions people with the workspace token", async () => {
    const token = (await I("POST", "scim")).json.token;
    expect(token).toMatch(/^scim_/);
    expect((await scim("GET", "Users", null)).status).toBe(401);
    const made = await scim("POST", "Users", token, { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "Ravi@acme.example", name: { givenName: "Ravi", familyName: "Rao" }, active: true });
    expect(made.status).toBe(201);
    expect(made.json).toMatchObject({ userName: "ravi@acme.example", active: true, name: { givenName: "Ravi", familyName: "Rao" } });
    expect((await scim("POST", "Users", token, { userName: "ravi@acme.example" })).status).toBe(409);
    const found = await scim("GET", 'Users?filter=userName eq "ravi@acme.example"', token);
    expect(found.json.totalResults).toBe(1);
    const id = made.json.id;
    const renamed = await scim("PATCH", `Users/${id}`, token, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", value: { "name.familyName": "Rajan" } }] });
    expect(renamed.json.name.formatted).toBe("Ravi Rajan");
    const off = await scim("PATCH", `Users/${id}`, token, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: false }] });
    expect(off.json.active).toBe(false);
    expect(await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, id)))).toHaveLength(0);
    expect((await scim("GET", `Users/${id}`, token)).json.active).toBe(false);
    expect((await scim("PATCH", `Users/${id}`, token, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "replace", path: "active", value: true }] })).json.active).toBe(true);
    // An owner can't be deprovisioned.
    const owner = (await call(me.GET, { cookie: C.owner })).json.user.id;
    expect((await scim("DELETE", `Users/${owner}`, token)).status).toBe(409);
    // Only accounts on this workspace's verified domains: not anyone else's account on the platform.
    await call(signup.POST, { method: "POST", body: { name: "Victor Victim", email: "victor@elsewhere.example", password: "correct-horse-42" } });
    expect((await scim("POST", "Users", token, { userName: "victor@elsewhere.example" })).status).toBe(403);
    expect((await scim("POST", "Users", token, { userName: "brand-new@elsewhere.example" })).status).toBe(403);
    const [victor] = await db.select().from(schema.users).where(eq(schema.users.email, "victor@elsewhere.example"));
    expect(await db.select().from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, victor.id)))).toHaveLength(0);
    await I("DELETE", "scim");
    expect((await scim("GET", "Users", token)).status).toBe(401);
  });
});
