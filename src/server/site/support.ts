// A support request from a published site becomes a Helpdesk ticket: numbered,
// response targets set, assigned, and the customer emailed a reference — the
// same intake as tickets that arrive by email.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isOn } from "@/lib/workspace/modules";
import { intake } from "../helpdesk/core";
import { log } from "../log";

export async function supportTicket(projectId: string, data: Record<string, string>) {
  const [p] = await db.select({ orgId: schema.projects.orgId, modules: schema.organizations.modules, name: schema.projects.name }).from(schema.projects).innerJoin(schema.organizations, eq(schema.organizations.id, schema.projects.orgId)).where(eq(schema.projects.id, projectId));
  if (!p || !isOn(p.modules, "helpdesk")) return null;
  try {
    return await intake(p.orgId, { subject: data.subject || `Request from ${p.name}`, body: data.message ?? "", name: data.name ?? "", email: data.email ?? "", channel: "web", tags: ["website"] }, { acknowledge: true });
  } catch (e) {
    // The submission is already saved; a failed ticket shouldn't lose it.
    log.error("site.support_ticket_failed", { projectId, error: String(e) });
    return null;
  }
}
