import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import { businessKit } from "@/lib/site/business-kit";
import { planFromBrief } from "@/lib/site/planner";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as kit from "@/app/api/v1/projects/[projectId]/business-kit/route";
import * as fileRoute from "@/app/api/v1/projects/[projectId]/file/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
let projectId = "";

beforeAll(async () => {
  await resetDb();
  const r = await call(signup.POST, { method: "POST", body: { name: "K", email: "k@example.com", password: "correct-horse-42" } });
  cookie = cookieFrom(r);
  const m = await call(me.GET, { cookie });
  const spec = planFromBrief("A gym with personal training, group classes and memberships called Iron Forge", { name: "Iron Forge" });
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId: m.json.organizations[0].id }, body: { spec } })).json.project.id;
});

afterAll(async () => {
  await closeDb();
});

describe("business kit", () => {
  it("recommends what fits the business and never invents results", () => {
    const fitness = businessKit(planFromBrief("A yoga and fitness studio with classes", { name: "Flow" }));
    expect(fitness.bookings.recommended).toBe(true);
    expect(fitness.bookings.services.some((s) => s.capacity > 1)).toBe(true);
    const shop = businessKit(planFromBrief("An online store selling handmade candles", { name: "Wick" }));
    expect(shop.store.recommended).toBe(true);
    for (const f of [...fitness.files, ...shop.files]) expect(f.content).not.toMatch(/\d+%|\d+ (customers|clients|reviews)|award/i);
    expect(fitness.files.find((f) => f.path === "marketing/google-business.md")!.content.length).toBeLessThan(1000);
  });

  it("creates the store, hidden booking services and the launch files, once", async () => {
    const preview = await call(kit.GET, { cookie, params: { projectId } });
    expect(preview.json.kit.bookings.recommended).toBe(true);
    const r = await call(kit.POST, { method: "POST", cookie, params: { projectId }, body: { store: false, bookings: true, marketing: true } });
    expect(r.json.done).toEqual(["store", "bookings", "marketing"]);
    const bookings = await call(admin.GET, { cookie, params: { projectId, slug: ["bookings"] } });
    expect(bookings.json.services.length).toBeGreaterThan(0);
    expect(bookings.json.services.every((s: { active: boolean; price: number }) => !s.active && s.price === 0)).toBe(true);
    const f = await call(fileRoute.GET, { cookie, params: { projectId }, path: "/x?path=LAUNCH_CHECKLIST.md" });
    expect(f.json.content).toContain("Iron Forge");
    expect(f.json.content).toContain("Bookings");
    const again = await call(kit.POST, { method: "POST", cookie, params: { projectId }, body: { store: true, bookings: true, marketing: true } });
    expect(again.json.done).toEqual([]);
  });
});
