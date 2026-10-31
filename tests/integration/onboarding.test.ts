import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import * as onboarding from "@/app/api/v1/auth/onboarding/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import { call, cookieFrom, resetDb } from "../helpers";

let cookie = "";
beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Owen Board", email: "owen@example.com", password: "correct-horse-42" } }));
});
afterAll(closeDb);

describe("onboarding answers", () => {
  it("starts empty, merges answers, and records completion once", async () => {
    expect((await call(onboarding.GET, { cookie })).json).toEqual({ onboarding: {}, onboardedAt: null });
    await call(onboarding.PUT, { method: "PUT", cookie, body: { intent: "internal", notifyInternal: true } });
    const r = await call(onboarding.PUT, { method: "PUT", cookie, body: { intent: "store", role: "team" } });
    expect(r.json.onboarding).toEqual({ intent: "store", notifyInternal: true, role: "team" });
    const done = await call(onboarding.PUT, { method: "PUT", cookie, body: { experience: "first", complete: true } });
    expect(done.json.onboardedAt).toBeTruthy();
    const again = await call(onboarding.PUT, { method: "PUT", cookie, body: { complete: true } });
    expect(again.json.onboardedAt).toBe(done.json.onboardedAt);
  });

  it("keeps what the person told us about their business, and the tour", async () => {
    const r = await call(onboarding.PUT, { method: "PUT", cookie, body: { name: "Saanjh", brief: "Handwoven kurtas", sells: "both", stage: "selling", goals: ["sell", "pos"], assets: ["domain"], catalogSize: "10-100", domain: "saanjh.in", kind: "store", category: "fashion" } });
    expect(r.json.onboarding).toMatchObject({ name: "Saanjh", sells: "both", goals: ["sell", "pos"], domain: "saanjh.in", kind: "store", category: "fashion" });
    expect((await call(onboarding.PUT, { method: "PUT", cookie, body: { tourDone: true } })).json.onboarding.tourDone).toBe(true);
    expect((await call(onboarding.PUT, { method: "PUT", cookie, body: { goals: ["teleport"] } })).status).toBe(422);
    expect((await call(onboarding.PUT, { method: "PUT", cookie, body: { sells: "everywhere" } })).status).toBe(422);
  });

  it("rejects unknown values and anonymous requests", async () => {
    expect((await call(onboarding.PUT, { method: "PUT", cookie, body: { intent: "rocket" } })).status).toBe(422);
    expect((await call(onboarding.GET, {})).status).toBe(401);
  });
});
