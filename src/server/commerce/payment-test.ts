// Live payment testing: an end-to-end check against the provider's real test
// environment with the merchant's own keys. The test only passes when the
// provider sends a correctly signed webhook for the right amount — returning
// from checkout in the browser proves nothing, so it never counts.
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { appUrl } from "../services/mail";
import { providerCreds } from "./orders";
import { inferMode, paypal, providerHttp, providerInfo, razorpay, stripe, type Creds, type ProviderId } from "./payments";
import { getStore } from "./catalog";

export type Check = { id: string; label: string; status: "pass" | "fail" | "warn" | "manual"; detail: string };
const TESTABLE: ProviderId[] = ["stripe", "razorpay", "paypal"];
const EXPIRE_MS = 60 * 60_000;

export const webhookUrlFor = (projectId: string, provider: string) => appUrl(`/api/v1/store/${projectId}/webhooks/${provider}`);

/** Checks that can be answered before taking a payment. Each one calls the provider or reads real config. */
export async function preflight(projectId: string, provider: ProviderId): Promise<{ checks: Check[]; ready: boolean; creds: Creds | null; mode: string }> {
  if (!TESTABLE.includes(provider)) throw new ApiError("validation_failed", "Live tests are for Stripe, Razorpay and PayPal");
  const checks: Check[] = [];
  const p = await providerCreds(projectId, provider);
  const name = providerInfo(provider)!.name;
  if (!p) {
    checks.push({ id: "keys", label: "Keys saved", status: "fail", detail: `Connect ${name} with test keys first.` });
    return { checks, ready: false, creds: null, mode: "test" };
  }
  checks.push({ id: "keys", label: "Keys saved", status: "pass", detail: "Stored encrypted." });
  const mode = inferMode(provider, p.creds, p.mode);
  checks.push(
    mode === "test"
      ? { id: "mode", label: "Test mode", status: "pass", detail: provider === "paypal" ? "Sandbox environment." : "These are test keys; no real money moves." }
      : { id: "mode", label: "Test mode", status: "fail", detail: "These are live keys. Live tests charge real money, so they're not offered — save test keys to run this check." },
  );
  try {
    if (provider === "stripe") await stripe.test(p.creds);
    else if (provider === "razorpay") await razorpay.test(p.creds);
    else await paypal.test(p.creds, p.mode);
    checks.push({ id: "auth", label: `${name} accepts the keys`, status: "pass", detail: "Authenticated just now." });
  } catch (e) {
    checks.push({ id: "auth", label: `${name} accepts the keys`, status: "fail", detail: (e as Error).message });
  }
  const secret = provider === "paypal" ? p.creds.webhookId : p.creds.webhookSecret;
  checks.push(secret ? { id: "secret", label: provider === "paypal" ? "Webhook ID saved" : "Webhook signing secret saved", status: "pass", detail: "Incoming webhooks are verified with it." } : { id: "secret", label: provider === "paypal" ? "Webhook ID saved" : "Webhook signing secret saved", status: "fail", detail: "Without it webhooks are rejected, so payments can't be confirmed if a customer closes the tab." });

  const url = webhookUrlFor(projectId, provider);
  if (provider === "stripe") {
    try {
      const r = await providerHttp("https://api.stripe.com/v1/webhook_endpoints?limit=100", { headers: { Authorization: `Bearer ${p.creds.secretKey}` } });
      const body = (await r.json()) as { data?: { url: string; status: string; enabled_events: string[] }[] };
      const ep = body.data?.find((e) => e.url === url);
      if (!ep) checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "fail", detail: `Add ${url} in Stripe → Developers → Webhooks (test mode), with the checkout.session.completed event.` });
      else if (ep.status !== "enabled") checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "fail", detail: "The endpoint exists but is disabled in Stripe." });
      else if (!ep.enabled_events.includes("*") && !ep.enabled_events.includes("checkout.session.completed")) checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "fail", detail: "The endpoint doesn't send checkout.session.completed." });
      else checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "pass", detail: "Found in your Stripe account with the right event." });
    } catch {
      checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "warn", detail: "Couldn't list endpoints; the test below will show whether webhooks arrive." });
    }
  } else {
    checks.push({ id: "endpoint", label: "Webhook endpoint registered", status: "manual", detail: provider === "razorpay" ? `Razorpay doesn't let apps read webhook settings. In Dashboard → Settings → Webhooks (test mode), add ${url} with the payment_link.paid event and the same secret.` : `In the PayPal developer dashboard, add ${url} with PAYMENT.CAPTURE.COMPLETED and save its Webhook ID here.` });
  }
  const host = new URL(url).hostname;
  const local = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$|.*\.local$)/.test(host);
  checks.push(local ? { id: "public", label: "Reachable from the internet", status: "fail", detail: `${host} isn't reachable by ${name}. Set APP_URL to a public https address (or a tunnel) so webhooks can arrive.` } : new URL(url).protocol === "https:" ? { id: "public", label: "Reachable from the internet", status: "pass", detail: `Webhooks go to ${host}.` } : { id: "public", label: "Reachable from the internet", status: "warn", detail: "Use https so providers deliver webhooks." });

  const ready = checks.every((c) => c.status !== "fail" || c.id === "endpoint" || c.id === "public");
  return { checks, ready: ready && checks.find((c) => c.id === "mode")!.status === "pass" && checks.find((c) => c.id === "auth")!.status === "pass" && checks.find((c) => c.id === "secret")!.status === "pass", creds: p.creds, mode: p.mode };
}

/** Starts a real test checkout for the smallest sensible amount. */
export async function startTest(projectId: string, provider: ProviderId, user: { id: string; email: string; name: string }) {
  const pf = await preflight(projectId, provider);
  if (!pf.ready || !pf.creds) throw new ApiError("conflict", "Fix the failing checks before starting a test", { checks: pf.checks.filter((c) => c.status === "fail").map((c) => c.label) });
  const store = await getStore(projectId);
  if (!store) throw notFound("Store");
  const currency = store.currency;
  // 100 minor units: one rupee/dollar/euro (or ¥100), above every provider's minimum.
  const [t] = await db.insert(schema.paymentTests).values({ projectId, provider, amount: 100, currency, checks: pf.checks, createdBy: user.id }).returning();
  const back = appUrl(`/projects/${projectId}/store/payments?paymentTest=${t.id}`);
  const order = { id: t.id, number: 0, label: `${store.name} — payment test`, total: t.amount, currency, email: user.email, phone: "", name: user.name };
  try {
    const r = provider === "stripe" ? await stripe.create(pf.creds, order, { success: back, cancel: back }) : provider === "razorpay" ? await razorpay.create(pf.creds, order, { success: back, cancel: back }) : await paypal.create(pf.creds, order, { success: back, cancel: back }, pf.mode, store.name);
    await db.update(schema.paymentTests).set({ ref: r.ref }).where(eq(schema.paymentTests.id, t.id));
    return { test: { ...t, ref: r.ref }, redirectUrl: r.redirectUrl };
  } catch (e) {
    await db.update(schema.paymentTests).set({ status: "failed", error: (e as Error).message }).where(eq(schema.paymentTests.id, t.id));
    throw e;
  }
}

/** Called from the payment webhook handler after the signature checked out. */
export async function recordTestWebhook(projectId: string, provider: string, evt: { eventId: string; ref?: string; paid?: boolean; amount?: number; captureRef?: string }) {
  if (!evt.ref) return false;
  const [t] = await db.select().from(schema.paymentTests).where(and(eq(schema.paymentTests.projectId, projectId), eq(schema.paymentTests.provider, provider), eq(schema.paymentTests.ref, evt.ref)));
  if (!t) return false;
  // Only an open test can be settled; late or repeated webhooks don't change a finished one.
  if (t.status !== "created") return true;
  const amountOk = evt.amount === undefined || evt.amount === t.amount;
  await db
    .update(schema.paymentTests)
    .set(evt.paid && amountOk ? { status: "passed", webhookEventId: evt.eventId, webhookAt: new Date(), captureRef: evt.captureRef ?? null, error: null } : { status: "failed", webhookEventId: evt.eventId, webhookAt: new Date(), error: !evt.paid ? "The webhook said the payment wasn't completed" : `The webhook amount (${evt.amount}) didn't match the test amount (${t.amount})` })
    .where(eq(schema.paymentTests.id, t.id));
  return true;
}

export async function getTest(projectId: string, id: string) {
  const [t] = await db.select().from(schema.paymentTests).where(and(eq(schema.paymentTests.projectId, projectId), eq(schema.paymentTests.id, id)));
  if (!t) throw notFound("Payment test");
  if (t.status === "created" && Date.now() - t.createdAt.getTime() > EXPIRE_MS) {
    await db.update(schema.paymentTests).set({ status: "expired", error: "No webhook arrived within an hour" }).where(eq(schema.paymentTests.id, t.id));
    return { ...t, status: "expired", error: "No webhook arrived within an hour" };
  }
  return t;
}

export async function listTests(projectId: string) {
  return db.select().from(schema.paymentTests).where(eq(schema.paymentTests.projectId, projectId)).orderBy(desc(schema.paymentTests.createdAt)).limit(20);
}

/**
 * Asks the provider directly whether the test payment went through. Useful
 * when the webhook hasn't arrived: it tells you payments work but webhooks
 * don't. It never marks the test passed on its own.
 */
export async function askProvider(projectId: string, id: string) {
  const t = await getTest(projectId, id);
  if (!t.ref) throw new ApiError("conflict", "This test never reached the provider");
  const p = await providerCreds(projectId, t.provider);
  if (!p) throw new ApiError("conflict", "The provider is no longer connected");
  const order = { id: t.id, number: 0, label: "", total: t.amount, currency: t.currency, email: "", phone: "", name: "" };
  let paid = false;
  if (t.provider === "stripe") paid = (await stripe.verify(p.creds, t.ref, order)).paid;
  else if (t.provider === "razorpay") paid = (await razorpay.verify(p.creds, t.ref, order, new URLSearchParams())).paid;
  else throw new ApiError("validation_failed", "PayPal test payments are captured on return; check the webhook instead");
  await db.update(schema.paymentTests).set({ providerSaysPaid: paid }).where(eq(schema.paymentTests.id, t.id));
  return { ...t, providerSaysPaid: paid };
}

/** Refunds a passed test payment (test mode, so nothing real moves). */
export async function refundTest(projectId: string, id: string) {
  const t = await getTest(projectId, id);
  if (t.status !== "passed" || !t.captureRef) throw new ApiError("conflict", "Only a passed test with a payment reference can be refunded");
  if (t.refundedAt) return t;
  const p = await providerCreds(projectId, t.provider);
  if (!p) throw new ApiError("conflict", "The provider is no longer connected");
  if (inferMode(t.provider as ProviderId, p.creds, p.mode) !== "test") throw new ApiError("conflict", "The saved keys are now live keys; refund the test payment from the provider's dashboard");
  if (t.provider === "stripe") await stripe.refund(p.creds, t.captureRef, t.amount);
  else if (t.provider === "razorpay") await razorpay.refund(p.creds, t.captureRef, t.amount);
  else await paypal.refund(p.creds, t.captureRef, t.amount, t.currency, p.mode);
  const [out] = await db.update(schema.paymentTests).set({ status: "refunded", refundedAt: new Date() }).where(eq(schema.paymentTests.id, t.id)).returning();
  return out;
}
