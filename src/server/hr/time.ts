// Time: attendance (check in and out, marking, the month sheet, corrections),
// leave (balances, requests, approvals, the calendar, year-end carry forward)
// and holidays. Also works out loss-of-pay days for payroll.
import { and, asc, desc, eq, gte, inArray, lte, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { ApiError, notFound } from "../http/errors";
import { notify } from "../notify/notify";
import { log } from "../log";
import { appUrl, sendMail } from "../services/mail";
import { accrued, eachDay, leaveDays, leaveRequestSchema, leaveTypeSchema, monthDays, weekday, type HrSettings } from "@/lib/hr/model";
import { isOn, isPartOn, type PartsOff } from "@/lib/workspace/modules";
import { addEvent, check, getSettings, holidaySet, isSelf, oversees, requireEmployee, requireManage, requireMe, requireSelfOrOversee, requireWithin, todayIst, type Employee, type Scope } from "./access";

const A = schema.hrAttendance;
const L = schema.hrLeaveRequests;

const istMinutes = (d: Date) => {
  const t = new Date(d.getTime() + 5.5 * 3600_000);
  return t.getUTCHours() * 60 + t.getUTCMinutes();
};
const hm = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const statusFor = (minutes: number, st: HrSettings) => (minutes >= st.shift.fullDayHours * 60 ? "present" : "half_day");

// ─── Attendance ───

export async function checkIn(s: Scope, at = new Date()) {
  const me = requireMe(s);
  if (!s.settings.attendance.selfCheckIn) throw new ApiError("forbidden", "Check-in is switched off — HR marks attendance");
  const date = todayIst(at);
  const [cur] = await db.select().from(A).where(and(eq(A.employeeId, me.id), eq(A.date, date)));
  if (cur?.checkIn) throw new ApiError("conflict", "You've already checked in today");
  // Late against the shift they're rostered on today (or the usual one); never late on a day off.
  const { shiftFor } = await import("./plus");
  const sh = await shiftFor(s.orgId, me.id, date, s.settings);
  const { isLate } = await import("@/lib/hr/model");
  const late = sh ? isLate(istMinutes(at), sh) : false;
  const values = { orgId: s.orgId, employeeId: me.id, date, checkIn: at, status: "present", late, source: "web" };
  if (cur) await db.update(A).set(values).where(eq(A.id, cur.id));
  else await db.insert(A).values(values);
  return (await db.select().from(A).where(and(eq(A.employeeId, me.id), eq(A.date, date))))[0];
}

export async function checkOut(s: Scope, at = new Date()) {
  const me = requireMe(s);
  const date = todayIst(at);
  const [cur] = await db.select().from(A).where(and(eq(A.employeeId, me.id), eq(A.date, date)));
  if (!cur?.checkIn) throw new ApiError("conflict", "Check in first");
  const minutes = Math.max(0, Math.round((at.getTime() - cur.checkIn.getTime()) / 60000));
  const [r] = await db.update(A).set({ checkOut: at, minutes, status: statusFor(minutes, s.settings) }).where(eq(A.id, cur.id)).returning();
  const { noteOvertime } = await import("./plus");
  await noteOvertime(s.orgId, me.id, date, minutes, s.settings);
  return r;
}

const markSchema = z.object({ employeeIds: z.array(z.uuid()).min(1).max(1000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(["present", "half_day", "absent"]), note: z.string().max(200).default("") });

/** HR (anyone) or a manager (their people) sets a day's attendance by hand. */
export async function markAttendance(s: Scope, raw: unknown) {
  const input = check(markSchema, raw);
  if (input.date > todayIst()) throw new ApiError("validation_failed", "That day hasn't happened yet");
  const ok = input.employeeIds.filter((id) => oversees(s, id));
  if (!ok.length) throw new ApiError("forbidden", "You can only mark attendance for people who report to you");
  for (const id of ok) {
    await db
      .insert(A)
      .values({ orgId: s.orgId, employeeId: id, date: input.date, status: input.status, source: "manual", note: input.note, minutes: input.status === "present" ? s.settings.shift.fullDayHours * 60 : input.status === "half_day" ? s.settings.shift.halfDayHours * 60 : 0 })
      .onConflictDoUpdate({ target: [A.employeeId, A.date], set: { status: input.status, source: "manual", note: input.note } });
  }
  return { count: ok.length };
}

/** Who's in today: checked in, late, on leave, not in yet. */
export async function today(s: Scope) {
  const date = todayIst();
  const people = await visiblePeople(s);
  const ids = people.map((p) => p.id);
  const [rows, leaves, hol] = await Promise.all([
    ids.length ? db.select().from(A).where(and(eq(A.orgId, s.orgId), inArray(A.employeeId, ids), eq(A.date, date))) : [],
    ids.length ? db.select({ employeeId: L.employeeId, half: L.half, type: schema.hrLeaveTypes.name }).from(L).innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, L.leaveTypeId)).where(and(inArray(L.employeeId, ids), eq(L.status, "approved"), lte(L.fromDate, date), gte(L.toDate, date))) : [],
    holidaySet(s.orgId, date, date),
  ]);
  const off = !s.settings.workWeek.includes(weekday(date)) || hol.size > 0;
  return {
    date,
    off,
    people: people.map((p) => {
      const a = rows.find((r) => r.employeeId === p.id);
      const l = leaves.find((x) => x.employeeId === p.id);
      return { id: p.id, name: p.name, designation: p.designation, departmentId: p.departmentId, checkIn: a?.checkIn ?? null, checkOut: a?.checkOut ?? null, status: l && l.half === "none" ? "leave" : a ? (a.status === "absent" ? "absent" : a.checkOut ? "out" : "in") : off ? "off" : "not_in", late: a?.late ?? false, leave: l?.type ?? null, source: a?.source ?? null };
    }),
  };
}

async function visiblePeople(s: Scope) {
  const all = await db.select().from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, s.orgId), ne(schema.hrEmployees.status, "exited"))).orderBy(asc(schema.hrEmployees.name));
  return all.filter((e) => s.manage || s.payroll || oversees(s, e.id) || isSelf(s, e.id));
}

/**
 * The month as a grid: for each person and day — P present, H half day,
 * A absent, L leave (½L for half), O weekly off, HO holiday, — nothing yet,
 * and before joining / after leaving blank.
 */
export async function monthSheet(s: Scope, month: string, only?: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ApiError("validation_failed", "Choose a month");
  let people = await visiblePeople(s);
  if (only) people = people.filter((p) => p.id === only);
  const days = monthDays(month);
  const ids = people.map((p) => p.id);
  const [rows, leaves, hol] = await Promise.all([
    ids.length ? db.select().from(A).where(and(eq(A.orgId, s.orgId), inArray(A.employeeId, ids), gte(A.date, days[0]), lte(A.date, days[days.length - 1]))) : [],
    ids.length ? db.select({ r: L, code: schema.hrLeaveTypes.code, paid: schema.hrLeaveTypes.paid }).from(L).innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, L.leaveTypeId)).where(and(inArray(L.employeeId, ids), eq(L.status, "approved"), lte(L.fromDate, days[days.length - 1]), gte(L.toDate, days[0]))) : [],
    db.select().from(schema.hrHolidays).where(and(eq(schema.hrHolidays.orgId, s.orgId), eq(schema.hrHolidays.optional, false), gte(schema.hrHolidays.date, days[0]), lte(schema.hrHolidays.date, days[days.length - 1]))),
  ]);
  const today = todayIst();
  return {
    month,
    days: days.map((d) => ({ date: d, off: !s.settings.workWeek.includes(weekday(d)), holiday: hol.find((h) => String(h.date) === d)?.name ?? null })),
    people: people.map((p) => {
      const cells = days.map((d) => {
        if (d < String(p.joinDate) || (p.exitDate && d > String(p.exitDate))) return "";
        const h = hol.find((x) => String(x.date) === d && (!x.locationId || x.locationId === p.locationId));
        if (h) return "HO";
        if (!s.settings.workWeek.includes(weekday(d))) return "O";
        const l = leaves.find((x) => x.r.employeeId === p.id && String(x.r.fromDate) <= d && String(x.r.toDate) >= d);
        const a = rows.find((x) => x.employeeId === p.id && String(x.date) === d);
        if (l && l.r.half === "none") return `L:${l.code}`;
        if (a) return a.status === "absent" ? "A" : a.status === "half_day" || l ? (l ? `½L:${l.code}` : "H") : a.late ? "P*" : "P";
        if (l) return `½L:${l.code}`;
        return d > today ? "" : s.settings.attendance.absentIfNoCheckIn ? "A" : "—";
      });
      const count = (pred: (c: string) => boolean) => cells.filter(pred).length;
      return { id: p.id, name: p.name, designation: p.designation, cells, summary: { present: count((c) => c === "P" || c === "P*") + count((c) => c === "H") / 2, late: count((c) => c === "P*"), absent: count((c) => c === "A") + count((c) => c === "H") / 2, leave: count((c) => c.startsWith("L:")) + count((c) => c.startsWith("½L")) / 2 } };
    }),
  };
}

/**
 * Loss-of-pay days for a month: unpaid leave, absences, and half of each
 * half day without leave. (Days with no check-in count only if the workspace
 * asks.) Also the days they were employed.
 */
/** Loss-of-pay days in a month. With attendance switched off, only unpaid leave counts. */
export async function lopFor(orgId: string, e: Employee, month: string, st: HrSettings, attendance = true) {
  const days = monthDays(month);
  const first = days[0];
  const last = days[days.length - 1];
  const from = String(e.joinDate) > first ? String(e.joinDate) : first;
  const to = e.exitDate && String(e.exitDate) < last ? String(e.exitDate) : last;
  const employed = from > to ? 0 : eachDay(from, to).length;
  if (!employed) return { employedDays: 0, lop: 0 };
  const [rows, leaves, hol] = await Promise.all([
    db.select().from(A).where(and(eq(A.orgId, orgId), eq(A.employeeId, e.id), gte(A.date, from), lte(A.date, to))),
    db.select({ r: L, paid: schema.hrLeaveTypes.paid }).from(L).innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, L.leaveTypeId)).where(and(eq(L.orgId, orgId), eq(L.employeeId, e.id), eq(L.status, "approved"), lte(L.fromDate, to), gte(L.toDate, from))),
    holidaySet(orgId, from, to, e.locationId),
  ]);
  const today = todayIst();
  let lop = 0;
  for (const d of eachDay(from, to)) {
    if (!st.workWeek.includes(weekday(d)) || hol.has(d)) continue;
    const l = leaves.find((x) => String(x.r.fromDate) <= d && String(x.r.toDate) >= d);
    const a = rows.find((x) => String(x.date) === d);
    if (l) {
      const part = l.r.half === "none" ? 1 : 0.5;
      if (!l.paid) lop += part;
      if (part === 0.5 && attendance && a?.status === "absent") lop += 0.5;
      continue;
    }
    if (!attendance) continue;
    if (a?.status === "absent") lop += 1;
    else if (a?.status === "half_day") lop += 0.5;
    else if (!a && st.attendance.absentIfNoCheckIn && d <= today) lop += 1;
  }
  return { employedDays: employed, lop };
}

// ─── Corrections ───

const regSchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), checkIn: z.iso.datetime({ offset: true }), checkOut: z.iso.datetime({ offset: true }), reason: z.string().trim().min(3, "Say what happened").max(300) });

export async function requestRegularisation(s: Scope, raw: unknown) {
  const me = requireMe(s);
  const input = check(regSchema, raw);
  if (input.date > todayIst()) throw new ApiError("validation_failed", "That day hasn't happened yet");
  if (new Date(input.checkOut) <= new Date(input.checkIn)) throw new ApiError("validation_failed", "Check-out must be after check-in");
  const [r] = await db.insert(schema.hrRegularisations).values({ orgId: s.orgId, employeeId: me.id, date: input.date, checkIn: new Date(input.checkIn), checkOut: new Date(input.checkOut), reason: input.reason }).returning();
  await notifyManager(s.orgId, me, `Attendance correction from ${me.name}`, `${me.name} asked to correct ${input.date}: ${input.reason}`);
  return r;
}

export async function decideRegularisation(s: Scope, id: string, approve: boolean) {
  const [r] = await db.select().from(schema.hrRegularisations).where(and(eq(schema.hrRegularisations.id, id), eq(schema.hrRegularisations.orgId, s.orgId)));
  if (!r) throw notFound("Request");
  if (!oversees(s, r.employeeId) || (isSelf(s, r.employeeId) && !s.manage)) throw new ApiError("forbidden", "Only their manager or HR can decide this");
  if (r.status !== "pending") throw new ApiError("conflict", "Already decided");
  await db.update(schema.hrRegularisations).set({ status: approve ? "approved" : "rejected", decidedBy: s.userId, decidedAt: new Date() }).where(eq(schema.hrRegularisations.id, id));
  if (approve) {
    const minutes = Math.round((r.checkOut.getTime() - r.checkIn.getTime()) / 60000);
    const late = istMinutes(r.checkIn) > hm(s.settings.shift.start) + s.settings.shift.graceMin;
    await db
      .insert(A)
      .values({ orgId: s.orgId, employeeId: r.employeeId, date: r.date, checkIn: r.checkIn, checkOut: r.checkOut, minutes, status: statusFor(minutes, s.settings), late, source: "regularised", note: r.reason })
      .onConflictDoUpdate({ target: [A.employeeId, A.date], set: { checkIn: r.checkIn, checkOut: r.checkOut, minutes, status: statusFor(minutes, s.settings), late, source: "regularised", note: r.reason } });
  }
}

/** A Horeca till unlock: the first of the day checks them in, later ones move check-out along. */
export async function horecaPresence(projectId: string, staffId: string, at = new Date()) {
  const [row] = await db
    .select({ e: schema.hrEmployees, modules: schema.organizations.modules, partsOff: schema.organizations.partsOff })
    .from(schema.hrEmployees)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.hrEmployees.orgId))
    .innerJoin(schema.projects, eq(schema.projects.orgId, schema.hrEmployees.orgId))
    .where(and(eq(schema.hrEmployees.horecaStaffId, staffId), eq(schema.projects.id, projectId), ne(schema.hrEmployees.status, "exited")));
  if (!row || !isOn(row.modules, "hr") || !isPartOn(row.partsOff as PartsOff, "hr", "attendance")) return;
  const { settings: st } = await getSettings(row.e.orgId);
  if (!st.attendance.horeca) return;
  const date = todayIst(at);
  const [cur] = await db.select().from(A).where(and(eq(A.employeeId, row.e.id), eq(A.date, date)));
  if (!cur) {
    await db.insert(A).values({ orgId: row.e.orgId, employeeId: row.e.id, date, checkIn: at, status: "present", late: istMinutes(at) > hm(st.shift.start) + st.shift.graceMin, source: "horeca" }).onConflictDoNothing();
  } else if (cur.checkIn && cur.source === "horeca" && at > cur.checkIn) {
    const minutes = Math.round((at.getTime() - cur.checkIn.getTime()) / 60000);
    await db.update(A).set({ checkOut: at, minutes, status: statusFor(minutes, st) }).where(eq(A.id, cur.id));
  }
}

// ─── Leave ───

export async function leaveTypes(orgId: string) {
  return db.select().from(schema.hrLeaveTypes).where(eq(schema.hrLeaveTypes.orgId, orgId)).orderBy(asc(schema.hrLeaveTypes.sort));
}

export async function saveLeaveType(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const input = check(leaveTypeSchema, raw);
  if (id) {
    const [t] = await db.update(schema.hrLeaveTypes).set(input).where(and(eq(schema.hrLeaveTypes.id, id), eq(schema.hrLeaveTypes.orgId, s.orgId))).returning();
    if (!t) throw notFound("Leave type");
    return t;
  }
  const n = (await leaveTypes(s.orgId)).length;
  const [t] = await db.insert(schema.hrLeaveTypes).values({ orgId: s.orgId, ...input, sort: n }).returning();
  return t;
}

/** Balances for one person and year, worked out from the rules and their approved leave. */
export async function balances(s: Scope, employeeId: string, year = Number(todayIst().slice(0, 4))) {
  const e = await requireEmployee(s.orgId, employeeId);
  const [types, stored, reqs] = await Promise.all([
    leaveTypes(s.orgId),
    db.select().from(schema.hrLeaveBalances).where(and(eq(schema.hrLeaveBalances.employeeId, employeeId), eq(schema.hrLeaveBalances.year, year))),
    db.select().from(L).where(and(eq(L.employeeId, employeeId), inArray(L.status, ["approved", "pending"]), gte(L.fromDate, `${year}-01-01`), lte(L.fromDate, `${year}-12-31`))),
  ]);
  const today = todayIst();
  return types
    .filter((t) => t.active)
    .map((t) => {
      const b = stored.find((x) => x.leaveTypeId === t.id);
      const used = reqs.filter((r) => r.leaveTypeId === t.id && r.status === "approved").reduce((a, r) => a + r.days, 0);
      const pending = reqs.filter((r) => r.leaveTypeId === t.id && r.status === "pending").reduce((a, r) => a + r.days, 0);
      const got = accrued(t, year, String(e.joinDate), today);
      const unlimited = t.accrual === "none";
      const available = unlimited ? null : Math.round(((b?.opening ?? 0) + got + (b?.adjusted ?? 0) - used) * 2) / 2;
      return { typeId: t.id, name: t.name, code: t.code, color: t.color, paid: t.paid, allowHalf: t.allowHalf, quota: t.quota, accrual: t.accrual, opening: b?.opening ?? 0, accrued: got, adjusted: b?.adjusted ?? 0, used, pending, available, unlimited };
    });
}

export async function requestLeave(s: Scope, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  // HR can file leave for someone; everyone else for themselves.
  const employeeId = typeof body.employeeId === "string" && body.employeeId && s.manage ? body.employeeId : requireMe(s).id;
  const e = await requireEmployee(s.orgId, employeeId);
  requireWithin(s, employeeId);
  const input = check(leaveRequestSchema, body);
  if (input.toDate < input.fromDate) throw new ApiError("validation_failed", "The end date is before the start");
  const [t] = await db.select().from(schema.hrLeaveTypes).where(and(eq(schema.hrLeaveTypes.id, input.leaveTypeId), eq(schema.hrLeaveTypes.orgId, s.orgId)));
  if (!t || !t.active) throw new ApiError("validation_failed", "Choose a leave type");
  if (input.half !== "none" && (input.fromDate !== input.toDate || !t.allowHalf)) throw new ApiError("validation_failed", t.allowHalf ? "Half days are for a single day" : `${t.name} can't be taken as half days`);
  const hol = await holidaySet(s.orgId, input.fromDate, input.toDate, e.locationId);
  const days = leaveDays(input.fromDate, input.toDate, input.half, s.settings.workWeek, hol);
  if (!days) throw new ApiError("validation_failed", "Those are all weekly offs or holidays — no leave needed");
  const [clash] = await db.select({ id: L.id }).from(L).where(and(eq(L.employeeId, employeeId), inArray(L.status, ["pending", "approved"]), lte(L.fromDate, input.toDate), gte(L.toDate, input.fromDate)));
  if (clash) throw new ApiError("conflict", "There's already leave on some of these days");
  if (t.accrual !== "none") {
    const b = (await balances(s, employeeId, Number(input.fromDate.slice(0, 4)))).find((x) => x.typeId === t.id);
    const left = (b?.available ?? 0) - (b?.pending ?? 0);
    if (days > left) throw new ApiError("validation_failed", `Only ${Math.max(0, left)} day${left === 1 ? "" : "s"} of ${t.name} left`);
  }
  const autoApprove = s.manage && employeeId !== s.me?.id;
  const [r] = await db.insert(L).values({ orgId: s.orgId, employeeId, leaveTypeId: t.id, fromDate: input.fromDate, toDate: input.toDate, half: input.half, days, reason: input.reason, ...(autoApprove ? { status: "approved", decidedBy: s.userId, decidedAt: new Date(), decisionNote: "Added by HR" } : {}) }).returning();
  if (!autoApprove) await notifyManager(s.orgId, e, `Leave request from ${e.name}`, `${e.name} asked for ${days} day${days === 1 ? "" : "s"} of ${t.name} (${input.fromDate}${input.toDate !== input.fromDate ? ` to ${input.toDate}` : ""}).${input.reason ? `\n\n“${input.reason}”` : ""}\n\nApprove or decline: ${appUrl("/hr/leave")}`);
  return r;
}

export async function decideLeave(s: Scope, id: string, approve: boolean, note = "") {
  const [r] = await db.select().from(L).where(and(eq(L.id, id), eq(L.orgId, s.orgId)));
  if (!r) throw notFound("Leave request");
  if (!oversees(s, r.employeeId) || (isSelf(s, r.employeeId) && !s.manage)) throw new ApiError("forbidden", "Only their manager or HR can decide this");
  if (r.status !== "pending") throw new ApiError("conflict", "Already decided");
  await db.update(L).set({ status: approve ? "approved" : "rejected", decidedBy: s.userId, decidedAt: new Date(), decisionNote: note.slice(0, 300) }).where(eq(L.id, id));
  const e = await requireEmployee(s.orgId, r.employeeId);
  const subject = `Your leave was ${approve ? "approved" : "declined"}`;
  const text = `${r.days} day${r.days === 1 ? "" : "s"} from ${r.fromDate}${r.toDate !== r.fromDate ? ` to ${r.toDate}` : ""} — ${approve ? "approved" : "declined"}.${note ? `\n\n“${note}”` : ""}`;
  if (e.userId) await notify(s.orgId, [e.userId], { kind: "hr.leave_decided", title: subject, body: text, link: "/hr/me", values: { decision: approve ? "approved" : "declined", dates: `${r.fromDate} to ${r.toDate}` } });
  else if (e.email || e.personalEmail) await sendMail({ to: e.email || e.personalEmail, subject, body: text }).catch(() => "");
}

export async function cancelLeave(s: Scope, id: string) {
  const [r] = await db.select().from(L).where(and(eq(L.id, id), eq(L.orgId, s.orgId)));
  if (!r) throw notFound("Leave request");
  const mine = isSelf(s, r.employeeId);
  if (!mine && !s.manage) throw new ApiError("forbidden", "Only they or HR can cancel this");
  if (mine && !s.manage && r.status === "approved" && String(r.fromDate) <= todayIst()) throw new ApiError("conflict", "Leave that has started can only be cancelled by HR");
  if (!["pending", "approved"].includes(r.status)) throw new ApiError("conflict", "Nothing to cancel");
  await db.update(L).set({ status: "cancelled" }).where(eq(L.id, id));
}

export async function leaveRequests(s: Scope, opts: { status?: string; mine?: boolean }) {
  const rows = await db
    .select({ r: L, name: schema.hrEmployees.name, type: schema.hrLeaveTypes.name, code: schema.hrLeaveTypes.code, color: schema.hrLeaveTypes.color })
    .from(L)
    .innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, L.employeeId))
    .innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, L.leaveTypeId))
    .where(and(eq(L.orgId, s.orgId), opts.status ? eq(L.status, opts.status) : undefined))
    .orderBy(desc(L.createdAt))
    .limit(500);
  return rows.filter((x) => (opts.mine ? isSelf(s, x.r.employeeId) : s.manage || oversees(s, x.r.employeeId) || isSelf(s, x.r.employeeId))).map((x) => ({ ...x.r, name: x.name, type: x.type, code: x.code, color: x.color, canDecide: x.r.status === "pending" && oversees(s, x.r.employeeId) && (!isSelf(s, x.r.employeeId) || s.manage) }));
}

/** Who's away when — everyone sees the team calendar (names and dates only). */
export async function leaveCalendar(s: Scope, from: string, to: string) {
  const rows = await db
    .select({ id: L.id, employeeId: L.employeeId, fromDate: L.fromDate, toDate: L.toDate, half: L.half, status: L.status, name: schema.hrEmployees.name, code: schema.hrLeaveTypes.code, color: schema.hrLeaveTypes.color })
    .from(L)
    .innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, L.employeeId))
    .innerJoin(schema.hrLeaveTypes, eq(schema.hrLeaveTypes.id, L.leaveTypeId))
    .where(and(eq(L.orgId, s.orgId), inArray(L.status, ["approved", "pending"]), lte(L.fromDate, to), gte(L.toDate, from)));
  const holidays = await db.select().from(schema.hrHolidays).where(and(eq(schema.hrHolidays.orgId, s.orgId), gte(schema.hrHolidays.date, from), lte(schema.hrHolidays.date, to))).orderBy(asc(schema.hrHolidays.date));
  return { leaves: rows.filter((r) => r.status === "approved" || s.manage || oversees(s, r.employeeId) || isSelf(s, r.employeeId)), holidays };
}

export async function adjustBalance(s: Scope, raw: { employeeId?: unknown; leaveTypeId?: unknown; year?: unknown; days?: unknown; reason?: unknown }) {
  requireManage(s);
  const employeeId = String(raw.employeeId ?? "");
  const leaveTypeId = String(raw.leaveTypeId ?? "");
  const year = Number(raw.year) || Number(todayIst().slice(0, 4));
  const days = Number(raw.days);
  if (!Number.isFinite(days) || days === 0 || Math.abs(days) > 365) throw new ApiError("validation_failed", "Enter the days to add (or take away)");
  await requireEmployee(s.orgId, employeeId);
  requireWithin(s, employeeId);
  await db
    .insert(schema.hrLeaveBalances)
    .values({ orgId: s.orgId, employeeId, leaveTypeId, year, adjusted: days })
    .onConflictDoUpdate({ target: [schema.hrLeaveBalances.employeeId, schema.hrLeaveBalances.leaveTypeId, schema.hrLeaveBalances.year], set: { adjusted: sql`${schema.hrLeaveBalances.adjusted} + ${days}` } });
  await addEvent(s.orgId, employeeId, "leave", `Leave balance ${days > 0 ? "+" : ""}${days} days`, s.userId, { reason: String(raw.reason ?? "").slice(0, 200) });
}

/** Year end: what's left (up to each type's carry-forward limit) becomes next year's opening balance. */
export async function closeYear(s: Scope, year: number) {
  requireManage(s);
  const types = (await leaveTypes(s.orgId)).filter((t) => t.carryForward > 0 && t.accrual !== "none");
  const people = await db.select({ id: schema.hrEmployees.id }).from(schema.hrEmployees).where(and(eq(schema.hrEmployees.orgId, s.orgId), ne(schema.hrEmployees.status, "exited")));
  let carried = 0;
  for (const p of people) {
    const b = await balances(s, p.id, year);
    for (const t of types) {
      const left = Math.max(0, Math.min(t.carryForward, b.find((x) => x.typeId === t.id)?.available ?? 0));
      await db
        .insert(schema.hrLeaveBalances)
        .values({ orgId: s.orgId, employeeId: p.id, leaveTypeId: t.id, year: year + 1, opening: left })
        .onConflictDoUpdate({ target: [schema.hrLeaveBalances.employeeId, schema.hrLeaveBalances.leaveTypeId, schema.hrLeaveBalances.year], set: { opening: left } });
      if (left) carried++;
    }
  }
  return { people: people.length, carried };
}

// ─── Holidays ───

const holidaySchema = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(80), optional: z.boolean().default(false), locationId: z.uuid().nullable().default(null) });

export async function holidays(orgId: string, year: number) {
  return db.select().from(schema.hrHolidays).where(and(eq(schema.hrHolidays.orgId, orgId), gte(schema.hrHolidays.date, `${year}-01-01`), lte(schema.hrHolidays.date, `${year}-12-31`))).orderBy(asc(schema.hrHolidays.date));
}
export async function saveHoliday(s: Scope, raw: unknown, id?: string) {
  requireManage(s);
  const input = check(holidaySchema, raw);
  if (id) {
    const [h] = await db.update(schema.hrHolidays).set(input).where(and(eq(schema.hrHolidays.id, id), eq(schema.hrHolidays.orgId, s.orgId))).returning();
    if (!h) throw notFound("Holiday");
    return h;
  }
  const [h] = await db.insert(schema.hrHolidays).values({ orgId: s.orgId, ...input }).returning();
  return h;
}
export async function deleteHoliday(s: Scope, id: string) {
  requireManage(s);
  await db.delete(schema.hrHolidays).where(and(eq(schema.hrHolidays.id, id), eq(schema.hrHolidays.orgId, s.orgId)));
}

export async function myAttendance(s: Scope, employeeId: string, month: string) {
  requireSelfOrOversee(s, employeeId);
  return monthSheet(s, month, employeeId);
}

export async function regularisations(s: Scope, status = "pending") {
  const rows = await db.select({ r: schema.hrRegularisations, name: schema.hrEmployees.name }).from(schema.hrRegularisations).innerJoin(schema.hrEmployees, eq(schema.hrEmployees.id, schema.hrRegularisations.employeeId)).where(and(eq(schema.hrRegularisations.orgId, s.orgId), eq(schema.hrRegularisations.status, status))).orderBy(desc(schema.hrRegularisations.createdAt));
  return rows.filter((x) => oversees(s, x.r.employeeId) || isSelf(s, x.r.employeeId)).map((x) => ({ ...x.r, name: x.name, canDecide: oversees(s, x.r.employeeId) && (!isSelf(s, x.r.employeeId) || s.manage) }));
}

/**
 * Tells someone's manager (or, with none, the workspace's owners and admins):
 * in the app and by email when they have an account, by email to their HR
 * address otherwise.
 */
async function notifyManager(orgId: string, e: Employee, subject: string, body: string) {
  try {
    if (e.managerId) {
      const [m] = await db.select({ email: schema.hrEmployees.email, userId: schema.hrEmployees.userId }).from(schema.hrEmployees).where(eq(schema.hrEmployees.id, e.managerId));
      if (m?.userId) return void (await notify(orgId, [m.userId], { kind: "hr.leave_requested", title: subject, body: body.replace(/\n\nApprove or decline: .*$/, ""), link: "/hr/leave", values: { employee: e.name } }));
      if (m?.email) return void (await sendMail({ to: m.email, subject, body }));
    }
    const owners = await db.select({ id: schema.users.id }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), or(eq(schema.memberships.role, "owner"), eq(schema.memberships.role, "admin"))));
    await notify(orgId, owners.map((o) => o.id).slice(0, 3), { kind: "hr.leave_requested", title: subject, body: body.replace(/\n\nApprove or decline: .*$/, ""), link: "/hr/leave", values: { employee: e.name } });
  } catch (err) {
    log.warn("hr_notify_failed", { error: (err as Error).message });
  }
}
