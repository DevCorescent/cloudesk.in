import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as login from "@/app/api/v1/auth/login/route";
import * as password from "@/app/api/v1/auth/password/route";
import * as passwordCode from "@/app/api/v1/auth/password/code/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import { call, cookieFrom, resetDb } from "../helpers";

// Forgot the current password in account settings: a code emailed to the
// account stands in for it, works once, and a wrong one doesn't.
const PW = "correct-horse-42";
const EMAIL = "forgetful@example.com";
let cookie = "";

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Forgetful Fran", email: EMAIL, password: PW } }));
});
afterAll(closeDb);

describe("changing a forgotten password with an emailed code", () => {
  it("needs a signed-in account", async () => {
    expect((await call(passwordCode.POST, { method: "POST" })).status).toBe(401);
  });

  it("emails a code, takes it instead of the current password, and only once", async () => {
    const sent = await call(passwordCode.POST, { method: "POST", cookie });
    expect(sent.status).toBe(200);
    expect(sent.json.email).toBe(EMAIL);
    const code: string = sent.json.devCode;
    expect(code).toMatch(/^\d{6}$/);
    const mail = (await db.select().from(schema.outboundEmails)).filter((m) => m.to === EMAIL && m.subject.startsWith(code));
    expect(mail[0]!.body).toContain("change your Cloudesk password");

    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
    const bad = await call(password.PATCH, { method: "PATCH", cookie, body: { code: wrong, newPassword: "brand-new-pass-9" } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toMatch(/tries left/);

    expect((await call(password.PATCH, { method: "PATCH", cookie, body: { code, newPassword: "brand-new-pass-9" } })).status).toBe(200);
    expect((await call(login.POST, { method: "POST", body: { email: EMAIL, password: PW } })).status).toBe(401);
    expect((await call(login.POST, { method: "POST", body: { email: EMAIL, password: "brand-new-pass-9" } })).status).toBe(200);
    // The code is used up.
    expect((await call(password.PATCH, { method: "PATCH", cookie, body: { code, newPassword: "another-pass-77" } })).status).toBe(400);
  });

  it("still needs the current password without a code", async () => {
    const r = await call(password.PATCH, { method: "PATCH", cookie, body: { currentPassword: "nope-nope-12", newPassword: "another-pass-77" } });
    expect(r.status).toBe(422);
  });
});
