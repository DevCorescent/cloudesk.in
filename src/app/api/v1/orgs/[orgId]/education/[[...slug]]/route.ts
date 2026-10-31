// Education API for a workspace. Dispatches on "METHOD section :id sub".
import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { notFound } from "@/server/http/errors";
import { db, schema } from "@/db";
import { saveSettings, scope } from "@/server/education/access";
import { attendance, attendanceMonth, classes, collections, dues, examSheet, exams, home, markAttendance, pay, plans, raisePlan, saveClass, saveExam, saveMarks, savePlan, saveStudent, studentDetail, students, waive } from "@/server/education/core";
import { importStudents } from "@/server/education/import";

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
      const team = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)).orderBy(asc(schema.users.name));
      const accounts = s.has("accounting") ? await db.select({ id: schema.accAccounts.id, name: schema.accAccounts.name }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), inArray(schema.accAccounts.subtype, ["cash", "bank"]), eq(schema.accAccounts.active, true))) : [];
      return { me: { write: s.write, manage: s.manage }, settings: s.settings, classes: await classes(s), team, accounts };
    }
    case "GET home":
      return home(s);
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "POST classes":
      return { class: await saveClass(s, null, await body(ctx)) };
    case "PUT classes :id":
      return { class: await saveClass(s, id!, await body(ctx)) };
    case "GET students":
      return { students: await students(s, qs) };
    case "POST students":
      return { student: await saveStudent(s, null, await body(ctx)) };
    case "POST students import":
      return importStudents(s, await readJson(ctx.req, z.unknown()));
    case "GET students :id":
      return studentDetail(s, id!);
    case "PUT students :id":
      return { student: await saveStudent(s, id!, await body(ctx)) };
    case "GET plans":
      return { plans: await plans(s) };
    case "POST plans":
      return { plan: await savePlan(s, null, await body(ctx)) };
    case "PUT plans :id":
      return { plan: await savePlan(s, id!, await body(ctx)) };
    case "POST plans :id raise":
      return raisePlan(s, id!);
    case "GET fees":
      return dues(s, qs);
    case "POST fees :id payments":
      return { payment: await pay(s, id!, await body(ctx)) };
    case "POST fees :id waive":
      await waive(s, id!, await body(ctx));
      return { ok: true };
    case "GET collections":
      return collections(s, qs);
    case "GET attendance :id":
      return qs.month ? attendanceMonth(s, id!, qs.month) : attendance(s, id!, qs.date ?? "");
    case "POST attendance :id":
      return markAttendance(s, id!, await body(ctx));
    case "GET exams":
      return { exams: await exams(s, qs.classId) };
    case "POST exams":
      return { exam: await saveExam(s, null, await body(ctx)) };
    case "PUT exams :id":
      return { exam: await saveExam(s, id!, await body(ctx)) };
    case "GET exams :id":
      return examSheet(s, id!);
    case "POST exams :id marks":
      return saveMarks(s, id!, await body(ctx));
  }
  throw notFound("Route");
}

export const GET = route<P>(handle);
export const POST = route<P>(handle);
export const PUT = route<P>(handle);
