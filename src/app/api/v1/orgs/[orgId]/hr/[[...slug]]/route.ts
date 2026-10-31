// HR & payroll API for a workspace. What each call returns depends on who is
// asking: HR admins, payroll, managers (for their people) or the person
// themselves.
import { z } from "zod";
import { units as orgUnits } from "@/server/org/org";
import { readJson, route, type AuthedContext } from "@/server/http/handler";
import { ApiError, notFound } from "@/server/http/errors";
import { rateLimit } from "@/server/security/rate-limit";
import { members, requireSelfOrOversee, saveSettings, scope, todayIst } from "@/server/hr/access";
import { importPeople } from "@/server/hr/import";
import { cancelExit, createEmployee, directory, getEmployee, importHorecaStaff, inviteEmployee, linkUser, orgChart, startExit, tickChecklist, updateEmployee } from "@/server/hr/employees";
import { hire, jobs, moveCandidate, pipeline, saveCandidate, saveJob } from "@/server/hr/hiring";
import { bankFile, claims, createRun, decideClaim, deleteRun, finaliseRun, getRun, holdPayslip, markRunPaid, myPayslips, payslip, recalcRun, registerCsv, runs, setAdjustments, submitClaim } from "@/server/hr/payroll";
import { home, reports } from "@/server/hr/reports";
import { assets, assignAsset, announcements, deleteAnnouncement, deleteDepartment, deleteGoal, deleteLocation, departments, goals, letter, locations, postAnnouncement, reviews, saveAsset, saveDepartment, saveGoal, saveLocation, startCycle, submitReview } from "@/server/hr/talent";
import { adjustBalance, balances, cancelLeave, checkIn, checkOut, closeYear, decideLeave, decideRegularisation, deleteHoliday, holidays, leaveCalendar, leaveRequests, leaveTypes, markAttendance, monthSheet, regularisations, requestLeave, requestRegularisation, saveHoliday, saveLeaveType, today } from "@/server/hr/time";
import { PT_STATES } from "@/lib/hr/model";
import { addPerDiem, cancelTrip, cards, cardTxns, decideTrip, explainTxn, importCardTxns, markPersonal, markRepaid, payAdvance, saveCard, saveTrip, settleTrip, submitTrip, travelHome, tripDetail, trips } from "@/server/hr/travel";
import { addOvertime, cancelSettlement, cases, copyRoster, decideOvertime, deleteDocument, deletePosition, documents, draftSettlement, editSettlement, hireForPosition, openCase, overtime, paySettlement, recordTraining, roster, saveDocument, savePosition, saveShift, saveTraining, settlements, setRoster, shifts, submitSettlement, trainingRecords, trainings, updateCase, workforce } from "@/server/hr/plus";

type P = { orgId: string; slug?: string[] };
const body = (ctx: AuthedContext) => readJson(ctx.req, z.record(z.string(), z.unknown()));
const csv = (name: string, text: string) => new Response("﻿" + text, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } });

async function handle(ctx: AuthedContext, { orgId, slug = [] }: P) {
  const [section, id, sub, sub2] = slug;
  const m = ctx.req.method;
  const qs = Object.fromEntries(new URL(ctx.req.url).searchParams);
  const key = `${m} ${section ?? ""}${id ? " :id" : ""}${sub ? ` ${sub}` : ""}${sub2 ? " :x" : ""}`;
  const s = await scope(ctx, orgId);
  const year = Number(qs.year) || Number(todayIst().slice(0, 4));

  switch (key) {
    case "GET meta": {
      const [ds, ls, lt, people] = await Promise.all([departments(orgId), locations(orgId), leaveTypes(orgId), directory(s, {})]);
      return {
        me: { userId: s.userId, role: s.role, manage: s.manage, payroll: s.payroll, employeeId: s.me?.id ?? null, name: s.me?.name ?? null, reports: [...s.reports], isManager: s.reports.size > 0 },
        settings: s.manage ? s.settings : { workWeek: s.settings.workWeek, shift: s.settings.shift, attendance: s.settings.attendance, overtime: s.settings.overtime, expenses: s.settings.expenses, company: { legalName: s.settings.company.legalName } },
        departments: ds,
        locations: ls,
        leaveTypes: lt,
        people: people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, departmentId: p.departmentId, managerId: p.managerId, status: p.status, userId: p.userId })),
        members: s.manage ? await members(orgId) : [],
        ptStates: Object.entries(PT_STATES).map(([code, v]) => ({ code, name: v.name })),
        units: (await orgUnits(orgId)).filter((u) => u.active).map((u) => ({ id: u.id, code: u.code, name: u.name })),
      };
    }
    case "PUT settings":
      return { settings: await saveSettings(s, await body(ctx)) };
    case "GET home":
      return home(s);

    // ─── People ───
    case "GET people":
      return { people: await directory(s, { q: qs.q, status: qs.status, departmentId: qs.departmentId, locationId: qs.locationId }) };
    case "POST people":
      return { employee: await createEmployee(s, await body(ctx)) };
    case "GET people :id":
      if (id === "chart") return { people: await orgChart(s) };
      return getEmployee(s, id);
    case "PUT people :id":
      return { employee: await updateEmployee(s, id, await body(ctx)) };
    case "POST people :id exit":
      return { employee: await startExit(s, id, await body(ctx)) };
    case "POST people :id stay":
      await cancelExit(s, id);
      return { ok: true };
    case "POST people :id link": {
      const b = await body(ctx);
      await linkUser(s, id, typeof b.userId === "string" && b.userId ? b.userId : null);
      return { ok: true };
    }
    case "POST people :id invite": {
      await rateLimit(`hr-invite:${ctx.user.id}`, 50, 3600_000);
      await inviteEmployee(s, id, ctx.user.name);
      return { ok: true };
    }
    case "POST people :id checklist": {
      const b = await body(ctx);
      await tickChecklist(s, id, String(b.kind ?? ""), String(b.itemId ?? ""), !!b.done);
      return { ok: true };
    }
    case "GET people :id balances":
      // Your own, your people's, or anyone's for HR and payroll.
      if (!s.payroll) requireSelfOrOversee(s, id);
      return { balances: await balances(s, id, year) };
    case "GET people :id payslips":
      return { payslips: await myPayslips(s, id) };
    case "GET people :id letter":
      return letter(s, id, qs.template ?? "");
    case "POST people :id":
      if (id === "import-horeca") return importHorecaStaff(s);
      if (id === "import") {
        await rateLimit(`hr-import:${ctx.user.id}`, 60, 3600_000);
        return importPeople(s, await readJson(ctx.req, z.unknown()));
      }
      throw notFound("Route");

    // ─── Departments & locations ───
    case "POST departments":
      return { department: await saveDepartment(s, await body(ctx)) };
    case "PUT departments :id":
      return { department: await saveDepartment(s, await body(ctx), id) };
    case "DELETE departments :id":
      await deleteDepartment(s, id);
      return { ok: true };
    case "POST locations":
      return { location: await saveLocation(s, await body(ctx)) };
    case "PUT locations :id":
      return { location: await saveLocation(s, await body(ctx), id) };
    case "DELETE locations :id":
      await deleteLocation(s, id);
      return { ok: true };

    // ─── Attendance ───
    case "POST attendance :id":
      if (id === "check-in") return { attendance: await checkIn(s) };
      if (id === "check-out") return { attendance: await checkOut(s) };
      if (id === "mark") return markAttendance(s, await body(ctx));
      if (id === "correct") return { request: await requestRegularisation(s, await body(ctx)) };
      throw notFound("Route");
    case "GET attendance :id":
      if (id === "today") return today(s);
      if (id === "month") return monthSheet(s, qs.month ?? todayIst().slice(0, 7), qs.employeeId || undefined);
      if (id === "corrections") return { requests: await regularisations(s, qs.status ?? "pending") };
      throw notFound("Route");
    case "POST corrections :id decide": {
      const b = await body(ctx);
      await decideRegularisation(s, id, b.approve === true);
      return { ok: true };
    }

    // ─── Leave ───
    case "GET leave":
      return { requests: await leaveRequests(s, { status: qs.status || undefined, mine: qs.mine === "1" }) };
    case "POST leave":
      return { request: await requestLeave(s, await body(ctx)) };
    case "POST leave :id decide": {
      const b = await body(ctx);
      await decideLeave(s, id, b.approve === true, typeof b.note === "string" ? b.note : "");
      return { ok: true };
    }
    case "POST leave :id cancel":
      await cancelLeave(s, id);
      return { ok: true };
    case "GET leave :id":
      if (id === "calendar") return leaveCalendar(s, qs.from ?? `${year}-01-01`, qs.to ?? `${year}-12-31`);
      throw notFound("Route");
    case "POST leave :id":
      if (id === "adjust") {
        await adjustBalance(s, await body(ctx));
        return { ok: true };
      }
      if (id === "close-year") return closeYear(s, Number((await body(ctx)).year) || year - 1);
      throw notFound("Route");
    case "POST leave-types":
      return { type: await saveLeaveType(s, await body(ctx)) };
    case "PUT leave-types :id":
      return { type: await saveLeaveType(s, await body(ctx), id) };
    case "GET holidays":
      return { holidays: await holidays(orgId, year) };
    case "POST holidays":
      return { holiday: await saveHoliday(s, await body(ctx)) };
    case "PUT holidays :id":
      return { holiday: await saveHoliday(s, await body(ctx), id) };
    case "DELETE holidays :id":
      await deleteHoliday(s, id);
      return { ok: true };

    // ─── Payroll ───
    case "GET payroll":
      return { runs: await runs(s) };
    case "POST payroll":
      return createRun(s, String((await body(ctx)).month ?? ""));
    case "GET payroll :id":
      return getRun(s, id);
    case "DELETE payroll :id":
      await deleteRun(s, id);
      return { ok: true };
    case "POST payroll :id recalc":
      return recalcRun(s, id);
    case "POST payroll :id finalise":
      return finaliseRun(s, id);
    case "POST payroll :id paid":
      return markRunPaid(s, id);
    case "GET payroll :id bank":
      return csv(`salaries-${id.slice(0, 8)}.csv`, await bankFile(s, id));
    case "GET payroll :id register":
      return csv(`payroll-register-${id.slice(0, 8)}.csv`, await registerCsv(s, id));
    case "PUT payroll :id slips :x": {
      const b = await body(ctx);
      if ("hold" in b) await holdPayslip(s, id, sub2, !!b.hold);
      if ("adjustments" in b) await setAdjustments(s, id, sub2, b.adjustments);
      return getRun(s, id);
    }
    case "GET payslips :id":
      if (id === "mine") return { payslips: await myPayslips(s) };
      return payslip(s, id);

    // ─── Claims ───
    case "GET claims":
      return { claims: await claims(s, { status: qs.status || undefined, mine: qs.mine === "1" }) };
    case "POST claims":
      return { claim: await submitClaim(s, await body(ctx)) };
    case "POST claims :id decide": {
      const b = await body(ctx);
      const action = b.action === "approve" || b.action === "reject" || b.action === "paid" ? b.action : null;
      if (!action) throw new ApiError("validation_failed", "Approve, reject or mark paid");
      await decideClaim(s, id, action, typeof b.note === "string" ? b.note : "");
      return { ok: true };
    }

    // ─── Travel & company cards ───
    case "GET travel":
      return travelHome(s);
    case "GET trips":
      return { trips: await trips(s, qs) };
    case "POST trips":
      return { trip: await saveTrip(s, null, await body(ctx)) };
    case "GET trips :id":
      return tripDetail(s, id);
    case "PUT trips :id":
      return { trip: await saveTrip(s, id, await body(ctx)) };
    case "POST trips :id submit":
      return submitTrip(s, id);
    case "POST trips :id decide":
      return decideTrip(s, id, await body(ctx));
    case "POST trips :id cancel":
      await cancelTrip(s, id);
      return { ok: true };
    case "POST trips :id advance":
      return { trip: await payAdvance(s, id, await body(ctx)) };
    case "POST trips :id per-diem":
      return { claim: await addPerDiem(s, id) };
    case "POST trips :id settle":
      return settleTrip(s, id, await body(ctx));
    case "GET cards":
      return { cards: await cards(s) };
    case "POST cards":
      return { card: await saveCard(s, null, await body(ctx)) };
    case "PUT cards :id":
      return { card: await saveCard(s, id, await body(ctx)) };
    case "GET card-txns":
      return { txns: await cardTxns(s, qs) };
    case "POST card-txns-import":
      return importCardTxns(s, await body(ctx));
    case "POST card-txns :id explain":
      return { claim: await explainTxn(s, id, await body(ctx)) };
    case "POST card-txns :id personal":
      await markPersonal(s, id);
      return { ok: true };
    case "POST card-txns :id repaid":
      await markRepaid(s, id, await body(ctx));
      return { ok: true };

    // ─── Hiring ───
    case "GET jobs":
      return jobs(s);
    case "POST jobs":
      return { job: await saveJob(s, await body(ctx)) };
    case "PUT jobs :id":
      return { job: await saveJob(s, await body(ctx), id) };
    case "GET jobs :id":
      return pipeline(s, id);
    case "POST candidates":
      return { candidate: await saveCandidate(s, await body(ctx)) };
    case "PUT candidates :id":
      return { candidate: await saveCandidate(s, await body(ctx), id) };
    case "POST candidates :id move":
      return { candidate: await moveCandidate(s, id, String((await body(ctx)).stage ?? "")) };
    case "POST candidates :id hire":
      return { employee: await hire(s, id, await body(ctx)) };

    // ─── Performance ───
    case "GET goals":
      return { goals: await goals(s, qs.employeeId || undefined) };
    case "POST goals":
      return { goal: await saveGoal(s, await body(ctx)) };
    case "PUT goals :id":
      return { goal: await saveGoal(s, await body(ctx), id) };
    case "DELETE goals :id":
      await deleteGoal(s, id);
      return { ok: true };
    case "GET reviews":
      return reviews(s, qs.cycle || undefined);
    case "POST reviews":
      return startCycle(s, String((await body(ctx)).cycle ?? ""));
    case "POST reviews :id submit":
      await submitReview(s, id, await body(ctx));
      return { ok: true };

    // ─── Assets, announcements, reports ───
    // ── Shifts, overtime ──
    case "GET shifts":
      return { shifts: await shifts(orgId) };
    case "POST shifts":
      return { shift: await saveShift(s, null, await body(ctx)) };
    case "PUT shifts :id":
      return { shift: await saveShift(s, id!, await body(ctx)) };
    case "GET roster":
      return { roster: await roster(s, String(qs.from), String(qs.to)), shifts: await shifts(orgId) };
    case "POST roster":
      return setRoster(s, await body(ctx));
    case "POST roster-copy": {
      const b = await body(ctx);
      return copyRoster(s, String(b.from), Number(b.days) || 7, Number(b.offset) || 7);
    }
    case "GET overtime":
      return { overtime: await overtime(s, qs) };
    case "POST overtime":
      return { overtime: await addOvertime(s, await body(ctx)) };
    case "POST overtime :id decide":
      return { overtime: await decideOvertime(s, id!, (await body(ctx)).approve !== false) };
    // ── Full and final ──
    case "GET bank-accounts": {
      // Where a settlement is paid from (payroll can see this much of the books).
      if (!s.payroll) throw new ApiError("forbidden", "Only owners, admins and billing can see this");
      const { db, schema } = await import("@/db");
      const { and, eq, inArray } = await import("drizzle-orm");
      return { accounts: await db.select({ id: schema.accAccounts.id, name: schema.accAccounts.name, subtype: schema.accAccounts.subtype }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, orgId), inArray(schema.accAccounts.subtype, ["bank", "cash"]), eq(schema.accAccounts.active, true))) };
    }
    case "GET settlements":
      return { settlements: await settlements(s) };
    case "POST settlements":
      return draftSettlement(s, String((await body(ctx)).employeeId ?? ""));
    case "PUT settlements :id":
      return { settlement: await editSettlement(s, id!, await body(ctx)) };
    case "POST settlements :id submit":
      return submitSettlement(s, id!);
    case "POST settlements :id pay":
      return { settlement: await paySettlement(s, id!, await body(ctx)) };
    case "DELETE settlements :id":
      await cancelSettlement(s, id!);
      return { ok: true };
    // ── Documents, training ──
    case "GET documents":
      return { documents: await documents(s, qs) };
    case "POST documents":
      return { document: await saveDocument(s, null, await body(ctx)) };
    case "PUT documents :id":
      return { document: await saveDocument(s, id!, await body(ctx)) };
    case "DELETE documents :id":
      await deleteDocument(s, id!);
      return { ok: true };
    case "GET trainings":
      return { trainings: await trainings(s) };
    case "POST trainings":
      return { training: await saveTraining(s, null, await body(ctx)) };
    case "PUT trainings :id":
      return { training: await saveTraining(s, id!, await body(ctx)) };
    case "POST trainings :id record":
      return recordTraining(s, id!, await body(ctx));
    case "GET training-records":
      return { records: await trainingRecords(s, qs) };
    // ── Grievances and discipline ──
    case "GET cases":
      return { cases: await cases(s, qs) };
    case "POST cases":
      return { case: await openCase(s, await body(ctx)) };
    case "PUT cases :id":
      return { case: await updateCase(s, id!, await body(ctx)) };
    // ── Workforce plan ──
    case "GET workforce":
      return workforce(s);
    case "POST positions":
      return { position: await savePosition(s, null, await body(ctx)) };
    case "PUT positions :id":
      return { position: await savePosition(s, id!, await body(ctx)) };
    case "DELETE positions :id":
      await deletePosition(s, id!);
      return { ok: true };
    case "POST positions :id hire":
      return { job: await hireForPosition(s, id!) };

    case "GET assets":
      return { assets: await assets(s) };
    case "POST assets":
      return { asset: await saveAsset(s, await body(ctx)) };
    case "PUT assets :id":
      return { asset: await saveAsset(s, await body(ctx), id) };
    case "POST assets :id assign": {
      const b = await body(ctx);
      await assignAsset(s, id, typeof b.employeeId === "string" && b.employeeId ? b.employeeId : null);
      return { ok: true };
    }
    case "GET announcements":
      return { announcements: await announcements(orgId) };
    case "POST announcements":
      return { announcement: await postAnnouncement(s, await body(ctx)) };
    case "DELETE announcements :id":
      await deleteAnnouncement(s, id);
      return { ok: true };
    case "GET reports":
      if (!s.manage && !s.payroll && !s.reports.size) throw new ApiError("forbidden", "Reports are for HR and managers");
      return reports(s, year);
  }
  throw notFound("Route");
}

const handler = route<P>(handle);
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
