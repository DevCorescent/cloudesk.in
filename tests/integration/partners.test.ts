import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as admin from "@/app/api/v1/admin/[[...slug]]/route";
import * as login from "@/app/api/v1/auth/login/route";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as signupStart from "@/app/api/v1/auth/signup/start/route";
import * as signupVerify from "@/app/api/v1/auth/signup/verify/route";
import * as go from "@/app/go/[code]/route";
import * as partnerApi from "@/app/api/v1/partner/[[...slug]]/route";
import * as partnersApi from "@/app/api/v1/partners/[[...slug]]/route";
import * as subApi from "@/app/api/v1/orgs/[orgId]/subscription/[[...slug]]/route";
import { markPaid } from "@/server/billing/subscriptions";
import { attachReferral, balances, describeCode } from "@/server/partners/core";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

const seg = (p: string) => p.split("?")[0]!.split("/").filter(Boolean);
type H = Parameters<typeof call>[0];
let staff = "";
const A = (method: string, path: string, body?: unknown) => call((admin as unknown as Record<string, H>)[method]!, { method, cookie: staff, body, path: `/api/v1/admin/${path}`, params: { slug: seg(path) } });
const Me = (cookie: string) => (method: string, path: string, body?: unknown) => call((partnerApi as unknown as Record<string, H>)[method]!, { method, cookie, body, path: `/api/v1/partner/${path}`, params: { slug: seg(path) } });
const pub = (method: string, path: string, body?: unknown) => call((partnersApi as unknown as Record<string, H>)[method]!, { method, body, path: `/api/v1/partners/${path}`, params: { slug: seg(path) } });

const influencer = { type: "influencer", name: "Riya Creates", phone: "+91 98765 43210", country: "IN", city: "Mumbai", website: "", profile: { platform: "Instagram", handle: "https://instagram.com/riyacreates", followers: "50k–250k", niche: "Small business money" }, acceptTerms: true };
let riya = { cookie: "", id: "", code: "" };

const signIn = async (email: string) => cookieFrom(await call(login.POST, { method: "POST", body: { email, password: "correct-horse-42" } }));

/** A business signing up through onboarding (the emailed code), optionally with a code or a partner link's cookie. */
async function businessSignup(email: string, o: { coupon?: string; cookie?: string; plan?: boolean } = {}) {
  const start = await call(signupStart.POST, { method: "POST", body: { name: "Owner", email, password: "correct-horse-42", workspaceName: `Biz ${email}`, acceptTerms: true, ...(o.coupon ? { coupon: o.coupon } : {}), ...(o.plan ? { choice: { kind: "plan", planId: "starter", interval: "month" } } : {}) }, headers: { "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  expect(start.status, start.text).toBe(200);
  const done = await call(signupVerify.POST, { method: "POST", body: { ticket: start.json.ticket, code: start.json.devCode }, headers: o.cookie ? { cookie: o.cookie } : {} });
  expect(done.status, done.text).toBe(201);
  const cookie = await signIn(email);
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id as string;
  return { cookie, orgId };
}

beforeAll(async () => {
  await resetDb();
  staff = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Pat Platform", email: "pat@cloudesk.example", password: "correct-horse-42" } }));
  const u = (await call(me.GET, { cookie: staff })).json.user.id;
  await db.update(schema.users).set({ isPlatformAdmin: true }).where(eq(schema.users.id, u));
});
afterAll(closeDb);

describe("the partner program", () => {
  it("takes an application with a new account, after the emailed code", async () => {
    expect((await pub("GET", "program")).json.types.find((t: { id: string }) => t.id === "influencer")).toMatchObject({ commissionBps: 2000, discountBps: 1500, discountPayments: 3 });
    // Questions for the kind of partner are required.
    const missing = await pub("POST", "apply/start", { ...influencer, profile: {}, person: "Riya Shah", email: "riya@creates.in", password: "correct-horse-42" });
    expect(missing.status).toBe(422);
    const start = await pub("POST", "apply/start", { ...influencer, person: "Riya Shah", email: "riya@creates.in", password: "correct-horse-42" });
    expect(start.status, start.text).toBe(200);
    // Nothing exists until the code is entered.
    expect(await db.select().from(schema.partners)).toHaveLength(0);
    const done = await call(signupVerify.POST, { method: "POST", body: { ticket: start.json.ticket, code: start.json.devCode } });
    expect(done.json).toMatchObject({ email: "riya@creates.in", partner: true });
    riya.cookie = await signIn("riya@creates.in");
    // An account with no workspace — only the partner profile, waiting for review.
    expect((await call(me.GET, { cookie: riya.cookie })).json.organizations).toHaveLength(0);
    const mine = (await Me(riya.cookie)("GET", "")).json;
    expect(mine.partner).toMatchObject({ status: "pending", type: "influencer", name: "Riya Creates" });
    expect(mine.totals).toBeUndefined();
    riya = { ...riya, id: mine.partner.id, code: mine.partner.code };
    expect(riya.code).toMatch(/^RIYA[A-Z]*\d{2}$/);
    // The code doesn't work before approval, and pending partners can't do partner things.
    expect((await describeCode(riya.code)).valid).toBe(false);
    expect((await Me(riya.cookie)("POST", "coupons", { label: "Reel", discountBps: 1000 })).status).toBe(403);
  });

  it("is reviewed in the console: approval switches the code on and emails the partner", async () => {
    const list = (await A("GET", "partners")).json;
    expect(list.stats).toMatchObject({ pending: 1, approved: 0 });
    expect(list.rows[0]).toMatchObject({ id: riya.id, status: "pending" });
    expect((await A("POST", `partners/${riya.id}`, { action: "reject", note: "" })).status).toBe(422);
    const ok = await A("POST", `partners/${riya.id}`, { action: "approve" });
    expect(ok.json.partner.status).toBe("approved");
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "riya@creates.in")).orderBy(schema.outboundEmails.createdAt);
    expect(mail).toBeDefined();
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "riya@creates.in"));
    expect(mails.some((m) => m.body.includes(riya.code))).toBe(true);
    expect(await describeCode(riya.code)).toMatchObject({ valid: true, discountBps: 1500, label: "15% off the first 3 payments" });
    expect((await pub("GET", `coupon?code=${riya.code.toLowerCase()}`)).json.valid).toBe(true);
  });

  it("gives a customer the discount on their invoice and the partner a share of what they pay", async () => {
    const bad = await call(signupStart.POST, { method: "POST", body: { name: "X", email: "x@shop.in", password: "correct-horse-42", workspaceName: "X", acceptTerms: true, coupon: "NOPE1234" } });
    expect(bad.status).toBe(422);
    const shop = await businessSignup("meera@shop.in", { coupon: riya.code, plan: true });
    const [ref] = await db.select().from(schema.partnerReferrals).where(eq(schema.partnerReferrals.orgId, shop.orgId));
    expect(ref).toMatchObject({ partnerId: riya.id, source: "coupon", discountBps: 1500, discountLeft: 3 });
    // The first invoice (Starter ₹999 after the trial) carries the 15% off, before GST.
    const [inv] = await db.select().from(schema.subscriptionInvoices).where(and(eq(schema.subscriptionInvoices.orgId, shop.orgId), eq(schema.subscriptionInvoices.status, "open")));
    expect(inv!.lines).toContainEqual({ label: `Partner code ${riya.code} (15% off)`, amount: -14985 });
    expect(inv!.subtotal).toBe(99900 - 14985);
    expect(inv!.lines.reduce((a, l) => a + l.amount, 0)).toBe(inv!.subtotal);
    const ov = (await call(subApi.GET, { cookie: shop.cookie, path: `/api/v1/orgs/${shop.orgId}/subscription`, params: { orgId: shop.orgId, slug: [] } })).json;
    expect(ov.coupon).toMatchObject({ code: riya.code, left: 3 });
    // Another code can't be added on top.
    expect((await call(subApi.POST, { method: "POST", cookie: shop.cookie, body: { code: riya.code }, path: `/api/v1/orgs/${shop.orgId}/subscription/coupon`, params: { orgId: shop.orgId, slug: ["coupon"] } })).status).toBe(409);

    await markPaid(inv!.id, { via: "manual", ref: "UPI 1" });
    const [k] = await db.select().from(schema.partnerCommissions).where(eq(schema.partnerCommissions.partnerId, riya.id));
    expect(k).toMatchObject({ basis: 84915, rateBps: 2000, amount: 16983, status: "earned" });
    expect(k!.availableAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
    // Once per invoice, and one discounted payment used.
    await markPaid(inv!.id, { via: "manual", ref: "UPI 1" });
    expect(await db.select().from(schema.partnerCommissions)).toHaveLength(1);
    expect((await db.select().from(schema.partnerReferrals).where(eq(schema.partnerReferrals.id, ref!.id)))[0]!.discountLeft).toBe(2);

    const d = (await Me(riya.cookie)("GET", "")).json;
    // Paid during the trial: a paying customer (and counted for tiers).
    expect(d.totals).toMatchObject({ signups: 1, paying: 1, mrr: 99900, revenue: 84915, earned: 16983, onHold: 16983, available: 0 });
    expect(d.customers[0]).toMatchObject({ name: "Biz meera@shop.in", source: "coupon", paid: 84915, earned: 16983 });
    expect(d.coupons[0]).toMatchObject({ code: riya.code, primary: true, signups: 1 });
    expect(d.series.at(-1)).toMatchObject({ earned: 16983, revenue: 84915 });
  });

  it("counts link visits and credits sign-ups that came through a link", async () => {
    const r = await call(go.GET as H, { path: `/go/${riya.code}?c=diwali-reel&to=/pricing`, params: { code: riya.code } });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`${ORIGIN}/pricing`);
    const cookie = cookieFrom(r);
    expect(cookie).toBe(`cc_ref=${encodeURIComponent(`${riya.code}|diwali-reel`)}`.replace("%7C", "%7C"));
    // Somewhere else entirely isn't followed.
    const off = await call(go.GET as H, { path: `/go/${riya.code}?to=//evil.example`, params: { code: riya.code } });
    expect(off.headers.get("location")).toBe(`${ORIGIN}/`);
    const shop = await businessSignup("kabir@cafe.in", { cookie });
    const [ref] = await db.select().from(schema.partnerReferrals).where(eq(schema.partnerReferrals.orgId, shop.orgId));
    expect(ref).toMatchObject({ source: "link", campaign: "diwali-reel" });
    const d = (await Me(riya.cookie)("GET", "")).json;
    expect(d.totals.clicks).toBe(2);
    expect(d.campaigns.find((c: { campaign: string }) => c.campaign === "diwali-reel")).toMatchObject({ clicks: 1, signups: 1 });
  });

  it("lets partners make their own codes within the program's limits", async () => {
    const R = Me(riya.cookie);
    expect((await R("POST", "coupons", { label: "Too generous", discountBps: 5000 })).status).toBe(422);
    const c = await R("POST", "coupons", { label: "YouTube", code: "riyayt", discountBps: 2000, discountPayments: 2 });
    expect(c.json.coupon).toMatchObject({ code: "RIYAYT", discount: "20% off the first 2 payments" });
    expect((await R("POST", "coupons", { label: "Again", code: "RIYAYT", discountBps: 1000 })).status).toBe(409);
    expect((await R("PATCH", `coupons/${c.json.coupon.id}`, { active: false })).json.coupon.active).toBe(false);
    expect((await describeCode("RIYAYT")).valid).toBe(false);
  });

  it("pays out only what's past the hold, once approved, with the details kept encrypted", async () => {
    const R = Me(riya.cookie);
    expect((await R("POST", "payouts", { amount: 100000 })).json.error.message).toMatch(/payout details/);
    expect((await R("PUT", "payout-details", { method: "upi", upiId: "bad", holder: "Riya Shah" })).status).toBe(422);
    const set = await R("PUT", "payout-details", { method: "upi", upiId: "riya.shah@okhdfc", holder: "Riya Shah", pan: "abcde1234f" });
    expect(set.json.partner).toMatchObject({ payoutMethod: "upi", payoutHint: "UPI · riy…@okhdfc" });
    const [row] = await db.select().from(schema.partners).where(eq(schema.partners.id, riya.id));
    expect(row!.payoutEnc).not.toContain("riya.shah");
    // Still on hold.
    expect((await R("POST", "payouts", { amount: 100000 })).status).toBe(422);
    // The hold is over; an admin adds a bonus (a fresh sign-in, logged).
    await db.update(schema.partnerCommissions).set({ availableAt: new Date(Date.now() - 1000) }).where(eq(schema.partnerCommissions.partnerId, riya.id));
    expect((await A("POST", `partners/${riya.id}/adjust`, { amount: 100000, note: "Launch bonus" })).status).toBe(200);
    expect(await balances(riya.id)).toMatchObject({ earned: 116983, available: 116983 });
    expect((await R("POST", "payouts", { amount: 50000 })).json.error.message).toMatch(/smallest payout is ₹1,000/);
    expect((await R("POST", "payouts", { amount: 200000 })).json.error.message).toMatch(/up to ₹1,169.83/);
    const req = await R("POST", "payouts", { amount: 100000, note: "October" });
    expect(req.json.payout).toMatchObject({ status: "requested", amount: 100000, net: 100000, method: "UPI · riy…@okhdfc" });
    expect((await R("POST", "payouts", { amount: 1000 })).status).toBe(409);
    expect(await balances(riya.id)).toMatchObject({ available: 16983, pendingPayout: 100000 });

    const queue = (await A("GET", "partner-payouts?status=open")).json.payouts;
    expect(queue[0]).toMatchObject({ id: req.json.payout.id, partner: { name: "Riya Creates" } });
    expect((await A("GET", `partners/${riya.id}/payout-details`)).json.details).toMatchObject({ method: "upi", upiId: "riya.shah@okhdfc", pan: "ABCDE1234F" });
    expect((await A("POST", `partner-payouts/${req.json.payout.id}`, { action: "approve" })).json.payout.status).toBe("approved");
    expect((await R("POST", `payouts/${req.json.payout.id}/cancel`)).status).toBe(409);
    expect((await A("POST", `partner-payouts/${req.json.payout.id}`, { action: "paid", reference: "" })).status).toBe(422);
    const paid = await A("POST", `partner-payouts/${req.json.payout.id}`, { action: "paid", reference: "UTR 4471882" });
    expect(paid.json.payout).toMatchObject({ status: "paid", reference: "UTR 4471882" });
    expect(await balances(riya.id)).toMatchObject({ paidOut: 100000, available: 16983, pendingPayout: 0 });
  });

  it("withholds tax at the program's rate and lets admins set the terms", async () => {
    const put = await A("PUT", "settings/partners", { tdsBps: 200, minPayout: 10000, types: { influencer: { commissionBps: 2500, commissionMonths: 6, discountBps: 1000, discountPayments: 1, maxDiscountBps: 2000 } } });
    expect(put.status, put.text).toBe(200);
    const d = (await Me(riya.cookie)("GET", "")).json;
    expect(d.terms).toMatchObject({ commissionBps: 2500, commissionMonths: 6, tdsBps: 200 });
    expect(d.rate).toMatchObject({ base: 2500, rate: 2500, tier: "Partner" });
    const req = await Me(riya.cookie)("POST", "payouts", { amount: 15000 });
    expect(req.json.payout).toMatchObject({ amount: 15000, tds: 300, net: 14700 });
    expect((await A("POST", `partner-payouts/${req.json.payout.id}`, { action: "reject", note: "Bank details didn't match" })).json.payout.status).toBe("rejected");
    // A rejected request is back in the balance.
    expect((await balances(riya.id)).available).toBe(16983);
    // An override for one partner.
    await A("PUT", `partners/${riya.id}`, { commissionBps: 3500, adminNote: "Top creator" });
    expect((await Me(riya.cookie)("GET", "")).json.rate.base).toBe(3500);
  });

  it("protects leads a sales partner registered, and credits them when that business signs up", async () => {
    const sam = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Sam Sales", email: "sam@sells.in", password: "correct-horse-42" } }));
    const applied = await Me(sam)("POST", "apply", { type: "sales", name: "Sam Sales", phone: "9876543210", city: "Pune", profile: { experience: "3–5 years", regions: "Pune", industries: "Clinics" }, acceptTerms: true });
    expect(applied.status, applied.text).toBe(200);
    expect((await Me(sam)("POST", "apply", { type: "sales", name: "Sam", phone: "9876543210", city: "Pune", profile: { experience: "3–5 years", regions: "Pune", industries: "Clinics" }, acceptTerms: true })).status).toBe(409);
    expect((await Me(sam)("POST", "leads", { company: "Sunrise Clinic", email: "dr@sunrise.in" })).status).toBe(403);
    await A("POST", `partners/${applied.json.partner.id}`, { action: "approve" });
    const lead = await Me(sam)("POST", "leads", { company: "Sunrise Clinic", contactName: "Dr Rao", email: "dr@sunrise.in", value: 299900 });
    expect(lead.json.lead).toMatchObject({ status: "registered" });
    // Someone else can't take it, and existing customers can't be registered.
    expect((await Me(riya.cookie)("POST", "leads", { company: "Sunrise", email: "DR@sunrise.in" })).status).toBe(409);
    expect((await Me(sam)("POST", "leads", { company: "Meera's", email: "meera@shop.in" })).status).toBe(409);
    expect((await Me(sam)("PATCH", `leads/${lead.json.lead.id}`, { status: "won" })).status).toBe(422);
    expect((await Me(sam)("PATCH", `leads/${lead.json.lead.id}`, { status: "demo" })).json.lead.status).toBe("demo");
    const clinic = await businessSignup("dr@sunrise.in");
    const [ref] = await db.select().from(schema.partnerReferrals).where(eq(schema.partnerReferrals.orgId, clinic.orgId));
    expect(ref).toMatchObject({ partnerId: applied.json.partner.id, source: "lead", discountBps: 0 });
    expect((await Me(sam)("GET", "leads")).json.leads[0]).toMatchObject({ status: "signed_up", orgId: clinic.orgId });
  });

  it("never credits partners for their own workspace, and suspended codes stop working", async () => {
    const [p] = await db.select().from(schema.partners).where(eq(schema.partners.id, riya.id));
    const own = await businessSignup("riya.biz@creates.in");
    expect(await attachReferral(own.orgId, { ownerId: p!.userId, coupon: riya.code })).toBeNull();
    // A workspace can take a code in Billing once.
    const ok = await call(subApi.POST, { method: "POST", cookie: own.cookie, body: { code: riya.code }, path: `/api/v1/orgs/${own.orgId}/subscription/coupon`, params: { orgId: own.orgId, slug: ["coupon"] } });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.coupon).toMatchObject({ code: riya.code });
    expect((await A("POST", `partners/${riya.id}`, { action: "suspend", note: "Misleading ads" })).json.partner.status).toBe("suspended");
    expect((await describeCode(riya.code)).valid).toBe(false);
    expect((await Me(riya.cookie)("GET", "")).json.partner).toMatchObject({ status: "suspended", reviewNote: "Misleading ads" });
    await A("POST", `partners/${riya.id}`, { action: "reactivate" });
    expect((await describeCode(riya.code)).valid).toBe(true);
    // Admins can take a workspace away from a partner.
    const [r] = await db.select().from(schema.partnerReferrals).where(eq(schema.partnerReferrals.orgId, own.orgId));
    expect((await A("DELETE", `partner-referrals/${r!.id}`)).json.referral.status).toBe("reversed");
  });

  it("is not reachable by people who aren't platform admins", async () => {
    expect((await call((admin as unknown as Record<string, H>).GET!, { cookie: riya.cookie, path: "/api/v1/admin/partners", params: { slug: ["partners"] } })).status).toBe(404);
  });
});
