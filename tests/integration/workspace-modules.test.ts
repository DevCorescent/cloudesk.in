import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as modules from "@/app/api/v1/orgs/[orgId]/modules/route";
import { INDUSTRIES, isOn, MODULES, moduleForPath } from "@/lib/workspace/modules";
import { listOrgsForUser } from "@/server/services/orgs";
import { call, cookieFrom, resetDb } from "../helpers";

let owner = "";
let viewer = "";
let orgId = "";
const put = (cookie: string, body: unknown) => call(modules.PUT, { method: "PUT", cookie, params: { orgId }, body });

beforeAll(async () => {
  await resetDb();
  owner = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Meera", email: "meera@example.com", password: "correct-horse-42" } }));
  orgId = (await call(me.GET, { cookie: owner })).json.organizations[0].id;
  viewer = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Vik", email: "vik@example.com", password: "correct-horse-42" } }));
  const vik = (await call(me.GET, { cookie: viewer })).json.user.id;
  await db.insert(schema.memberships).values({ orgId, userId: vik, role: "viewer" });
});
afterAll(closeDb);

describe("workspace features", () => {
  it("starts with everything on, for workspaces that never chose", async () => {
    const r = await call(modules.GET, { cookie: owner, params: { orgId } });
    expect(r.json).toEqual({ modules: null, industry: null, partsOff: {} });
    expect(MODULES.every((m) => isOn(null, m.id))).toBe(true);
  });

  it("saves the picked features and industry, and the session carries them", async () => {
    const r = await put(owner, { modules: ["horeca", "invoicing", "horeca"], industry: "restaurant" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ modules: ["horeca", "invoicing"], industry: "restaurant", partsOff: {} });
    const userId = (await call(me.GET, { cookie: owner })).json.user.id;
    const [org] = await listOrgsForUser(userId);
    expect(org.modules).toEqual(["horeca", "invoicing"]);
    expect(isOn(org.modules, "store")).toBe(false);
    const [log] = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.action, "org.modules_updated")));
    expect(log).toBeTruthy();
  });

  it("rejects unknown features and industries", async () => {
    expect((await put(owner, { modules: ["teleport"] })).status).toBe(422);
    expect((await put(owner, { modules: [], industry: "spaceport" })).status).toBe(422);
  });

  it("only lets owners and admins change them", async () => {
    expect((await call(modules.GET, { cookie: viewer, params: { orgId } })).status).toBe(200);
    expect((await put(viewer, { modules: null })).status).toBe(403);
  });

  it("can switch everything back on", async () => {
    expect((await put(owner, { modules: null })).json.modules).toBeNull();
  });

  it("knows which feature owns a dashboard page", () => {
    const p = "/projects/7f1c2d1e-0000-4000-8000-000000000000";
    expect(moduleForPath(`${p}/store/products`)?.id).toBe("store");
    expect(moduleForPath(`${p}/store`)?.id).toBe("store");
    expect(moduleForPath(`${p}/store/labels`)?.id).toBe("pos");
    expect(moduleForPath(`${p}/pos`)?.id).toBe("pos");
    expect(moduleForPath(`${p}/horeca/kitchen`)?.id).toBe("horeca");
    expect(moduleForPath("/finance/abc")?.id).toBe("invoicing");
    expect(moduleForPath(`${p}/builder`)).toBeUndefined();
    expect(moduleForPath(`${p}/storefront`)).toBeUndefined();
    // Every industry recommends real features.
    for (const i of INDUSTRIES) expect(i.modules.every((m) => MODULES.some((x) => x.id === m))).toBe(true);
  });
});
