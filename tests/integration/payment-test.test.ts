import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as admin from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import * as webhookRoute from "@/app/api/v1/store/[projectId]/webhooks/[provider]/route";
import { setPaymentHttp } from "@/server/commerce/payments";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let projectId = "";
const secret = "whsec_test_live_check";
const calls: { url: string; body: string }[] = [];
let endpoints: { url: string; status: string; enabled_events: string[] }[] = [];
let sessionPaid = false;
const store = (method: string, path: string, body?: unknown) => call(admin[method as "GET"], { method, cookie, body, path: `/api/v1/projects/${projectId}/store/${path}`, params: { projectId, slug: path.split("/").filter(Boolean) } });
const sign = (raw: string, s = secret) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", s).update(`${t}.${raw}`).digest("hex")}`;
};
const webhook = (raw: string, sig = sign(raw)) => webhookRoute.POST(new Request(`${ORIGIN}/api/v1/store/${projectId}/webhooks/stripe`, { method: "POST", headers: { "stripe-signature": sig }, body: raw }), { params: Promise.resolve({ projectId, provider: "stripe" }) });
const completed = (id: string, amount: number, evt = `evt_${Math.random()}`) => JSON.stringify({ id: evt, type: "checkout.session.completed", data: { object: { id, payment_status: "paid", amount_total: amount, currency: "inr", payment_intent: "pi_test_1" } } });

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pia Pay", email: "pia@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "Loom" } })).json.project.id;
  await store("POST", "setup", { name: "Loom", country: "IN", region: "Karnataka", email: "owner@example.com" });
  setPaymentHttp(async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/v1/balance")) return Response.json({ object: "balance" });
    if (url.includes("/v1/webhook_endpoints")) return Response.json({ data: endpoints });
    if (url.endsWith("/v1/checkout/sessions")) {
      const n = calls.filter((c) => c.url.endsWith("/v1/checkout/sessions")).length;
      const id = n === 1 ? "cs_test_live1" : `cs_test_live${n}`;
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    if (url.includes("/v1/checkout/sessions/cs_test_live1")) return Response.json({ id: "cs_test_live1", payment_status: sessionPaid ? "paid" : "unpaid", amount_total: 100, currency: "inr", payment_intent: "pi_test_1" });
    if (url.endsWith("/v1/refunds")) return Response.json({ id: "re_test_1" });
    return Response.json({ error: { message: "unexpected" } }, { status: 400 });
  });
});
afterAll(async () => {
  setPaymentHttp((input, init) => fetch(input, init));
  await closeDb();
});

describe("live payment test", () => {
  it("refuses until keys are connected, and refuses live keys", async () => {
    const none = await store("POST", "payments/stripe/preflight");
    expect(none.json.checks[0]).toMatchObject({ id: "keys", status: "fail" });
    await store("PUT", "payments/stripe", { enabled: true, credentials: { secretKey: "sk_live_abcdef123456", webhookSecret: secret } });
    const live = await store("POST", "payments/stripe/preflight");
    expect(live.json.checks.find((c: { id: string }) => c.id === "mode")).toMatchObject({ status: "fail" });
    expect(live.json.ready).toBe(false);
    expect((await store("POST", "payments/stripe/tests")).status).toBe(409);
    expect(calls.some((c) => c.url.endsWith("/v1/checkout/sessions"))).toBe(false);
  });

  it("checks the real webhook registration at Stripe", async () => {
    await store("PUT", "payments/stripe", { enabled: true, credentials: { secretKey: "sk_test_abcdef123456", webhookSecret: secret } });
    let pf = await store("POST", "payments/stripe/preflight");
    const url = pf.json.webhookUrl;
    expect(url).toBe(`http://localhost:3000/api/v1/store/${projectId}/webhooks/stripe`);
    expect(pf.json.checks.find((c: { id: string }) => c.id === "endpoint")).toMatchObject({ status: "fail" });
    expect(pf.json.checks.find((c: { id: string }) => c.id === "public")).toMatchObject({ status: "fail" }); // localhost can't receive webhooks
    endpoints = [{ url, status: "enabled", enabled_events: ["payment_intent.succeeded"] }];
    pf = await store("POST", "payments/stripe/preflight");
    expect(pf.json.checks.find((c: { id: string }) => c.id === "endpoint").detail).toBe("The endpoint doesn't send checkout.session.completed.");
    endpoints = [{ url, status: "enabled", enabled_events: ["checkout.session.completed"] }];
    pf = await store("POST", "payments/stripe/preflight");
    expect(pf.json.checks.map((c: { id: string; status: string }) => `${c.id}:${c.status}`)).toEqual(["keys:pass", "mode:pass", "auth:pass", "secret:pass", "endpoint:pass", "public:fail"]);
    expect(pf.json.ready).toBe(true);
  });

  it("passes only on a signed webhook with the right amount — never on the redirect", async () => {
    const r = await store("POST", "payments/stripe/tests");
    expect(r.json.redirectUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_live1");
    const id = r.json.test.id;
    const body = new URLSearchParams(calls.findLast((c) => c.url.endsWith("/v1/checkout/sessions"))!.body);
    expect(body.get("line_items[0][price_data][unit_amount]")).toBe("100");
    expect(body.get("success_url")).toBe(`http://localhost:3000/projects/${projectId}/store/payments?paymentTest=${id}`);

    // Coming back from checkout changes nothing.
    expect((await store("GET", `payments/stripe/tests/${id}`)).json.test.status).toBe("created");
    // The provider API can say it's paid; still not passed without the webhook.
    sessionPaid = true;
    expect((await store("POST", `payments/stripe/tests/${id}/check`)).json.test).toMatchObject({ status: "created", providerSaysPaid: true });
    // A forged webhook is rejected.
    expect((await webhook(completed("cs_test_live1", 100), sign(completed("cs_test_live1", 100), "whsec_wrong"))).status).toBe(403);
    expect((await store("GET", `payments/stripe/tests/${id}`)).json.test.status).toBe("created");
    // The real one passes it.
    expect((await webhook(completed("cs_test_live1", 100, "evt_live_ok"))).status).toBe(200);
    expect((await store("GET", `payments/stripe/tests/${id}`)).json.test).toMatchObject({ status: "passed", webhookEventId: "evt_live_ok", captureRef: "pi_test_1" });
    const refunded = await store("POST", `payments/stripe/tests/${id}/refund`);
    expect(refunded.json.test.status).toBe("refunded");
    expect(new URLSearchParams(calls.findLast((c) => c.url.endsWith("/v1/refunds"))!.body).get("amount")).toBe("100");
  });

  it("fails on a wrong amount, and late webhooks don't change finished tests", async () => {
    const r = await store("POST", "payments/stripe/tests");
    expect(r.json.test.ref).toBe("cs_test_live2");
    await webhook(completed("cs_test_live2", 50, "evt_low"));
    expect((await store("GET", `payments/stripe/tests/${r.json.test.id}`)).json.test).toMatchObject({ status: "failed", error: "The webhook amount (50) didn't match the test amount (100)" });
    await webhook(completed("cs_test_live1", 100, "evt_late"));
    expect((await store("GET", "payments/stripe/tests")).json.tests.map((t: { status: string }) => t.status)).toEqual(["failed", "refunded"]);
  });
});
