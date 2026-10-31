// Bringing tickets over from another helpdesk (a CSV or Excel export). Each
// gets a new number; the old one is kept as a "ref:" tag so the same row
// isn't brought in twice. Nobody is emailed. Tickets still open get response
// targets from today; finished ones are history, with no targets.
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { addBusinessMinutes, DONE, type Priority, type Status } from "@/lib/helpdesk/model";
import { target } from "@/lib/import/targets";
import { runImport, str } from "../import/run";
import { getSettings, nextCounter, requireWrite, type Scope } from "./access";

export async function importTickets(s: Scope, raw: unknown) {
  requireWrite(s);
  const st = await getSettings(s.orgId);
  return runImport(target("helpdesk.tickets"), raw, async (v) => {
    const ref = str(v.reference).trim().slice(0, 40);
    if (ref) {
      const [dup] = await db.select({ id: schema.hdTickets.id }).from(schema.hdTickets).where(and(eq(schema.hdTickets.orgId, s.orgId), sql`${schema.hdTickets.tags} ? ${`ref:${ref}`}`));
      if (dup) return "skipped";
    }
    const status = (str(v.status) || "open") as Status;
    const priority = (str(v.priority) || "normal") as Priority;
    const done = DONE.includes(status);
    const created = /^\d{4}-\d{2}-\d{2}$/.test(str(v.createdOn)) ? new Date(`${str(v.createdOn)}T10:00:00+05:30`) : new Date();
    const now = new Date();
    const paused = status === "pending" || status === "on_hold";
    const tags = [...new Set([...str(v.tags).split(",").map((x) => x.trim().slice(0, 30)).filter(Boolean), ...(ref ? [`ref:${ref}`] : [])])].slice(0, 12);
    const number = `${st.prefix}${String(await nextCounter(s.orgId, "ticket")).padStart(4, "0")}`;
    const target_ = st.sla[priority];
    const [t] = await db
      .insert(schema.hdTickets)
      .values({
        orgId: s.orgId,
        number,
        subject: str(v.subject).slice(0, 200),
        status,
        priority,
        channel: "manual",
        customerName: str(v.customerName).slice(0, 120),
        customerEmail: str(v.customerEmail).toLowerCase(),
        customerPhone: str(v.customerPhone).slice(0, 30),
        tags,
        firstResponseDue: done ? null : addBusinessMinutes(now, target_.first, st.hours, st.holidays),
        resolveDue: done || paused ? null : addBusinessMinutes(now, target_.resolve, st.hours, st.holidays),
        pausedAt: paused ? now : null,
        remainingMins: paused ? target_.resolve : null,
        // Already answered in the old system, so the first-reply clock doesn't start again.
        firstRespondedAt: status === "open" ? null : created,
        resolvedAt: done ? created : null,
        closedAt: status === "closed" ? created : null,
        createdBy: s.userId,
        createdAt: created,
      })
      .returning();
    const body = str(v.description).trim();
    if (body) await db.insert(schema.hdMessages).values({ orgId: s.orgId, ticketId: t.id, kind: "customer", body: body.slice(0, 20_000), fromName: t.customerName, fromEmail: t.customerEmail, createdAt: created });
    await db.insert(schema.hdMessages).values({ orgId: s.orgId, ticketId: t.id, kind: "event", body: `Imported${ref ? ` (was ${ref})` : ""}`, authorId: s.userId });
    return "created";
  });
}
