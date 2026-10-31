// Clinic API for a workspace. Dispatches on "METHOD section :id sub".
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { db, schema } from "@/db";
import { doctors, saveSettings, scope } from "@/server/clinic/access";
import { addendum, book, createBill, home, patientDetail, patients, payBill, prescription, queue, savePatient, saveVisit, setStatus, signVisit, voidBill } from "@/server/clinic/core";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? (/^[0-9a-f-]{36}$/.test(id) ? " :id" : ` ${id}`) : ""}${sub ? ` ${sub}` : ""}`;
  const s = await scope(ctx, orgId);
  switch (key) {
    case "GET meta": {
      const accounts = s.has("accounting") ? await db.select({ id: schema.accAccounts.id, name: schema.accAccounts.name }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), inArray(schema.accAccounts.subtype, ["cash", "bank"]), eq(schema.accAccounts.active, true))) : [];
      const team = s.manage ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)) : [];
      return { me: { id: s.userId, write: s.write, manage: s.manage, clinician: s.clinician }, settings: s.settings, doctors: await doctors(s), accounts, team };
    }
    case "GET home":
      return home(s);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET patients":
      return { patients: await patients(s, qs) };
    case "POST patients":
      return { patient: await savePatient(s, null, await body(ctx)) };
    case "GET patients :id":
      return patientDetail(s, id!, ctx.ip);
    case "PUT patients :id":
      return { patient: await savePatient(s, id!, await body(ctx)) };
    case "GET queue":
      return queue(s, qs);
    case "POST appointments":
      return { appointment: await book(s, await body(ctx)) };
    case "POST appointments :id status":
      return { appointment: await setStatus(s, id!, await body(ctx)) };
    case "POST visits":
      return { visit: await saveVisit(s, null, await body(ctx)) };
    case "PUT visits :id":
      return { visit: await saveVisit(s, id!, await body(ctx)) };
    case "POST visits :id sign":
      return { visit: await signVisit(s, id!) };
    case "POST visits :id addendum":
      return { visit: await addendum(s, id!, await body(ctx)) };
    case "GET visits :id prescription":
      return prescription(s, id!, ctx.ip);
    case "POST bills":
      return { bill: await createBill(s, await body(ctx)) };
    case "POST bills :id payments":
      return { payment: await payBill(s, id!, await body(ctx)) };
    case "POST bills :id void":
      await voidBill(s, id!);
      return { ok: true };
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
