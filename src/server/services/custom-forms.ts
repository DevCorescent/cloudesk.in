// Submissions for custom forms built in the site builder. The form definition
// comes from the deployed site document (never from the request), so only the
// fields the owner published are accepted, each validated by its type.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SiteDoc } from "@/lib/site/model";
import { customFormId, fieldName, FORM_FIELD_TYPES } from "@/lib/site/sections-extra";
import { getTable, insertRows } from "../data/tables";
import { emitEvent } from "../events/bus";
import { ApiError } from "../http/errors";
import { log } from "../log";
import { sendMail } from "./mail";

type P = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

export function findCustomForm(doc: SiteDoc, formId: string) {
  for (const page of doc.pages) for (const s of page.sections) if (s.type === "form" && customFormId(s.id) === formId) return s;
  return null;
}

/** Validates the posted values against the published definition. */
export function validateCustomForm(fields: P[], form: FormData) {
  const data: Record<string, string> = {};
  const errors: string[] = [];
  fields.slice(0, 25).forEach((f, i) => {
    const name = fieldName(f, i);
    const type = (FORM_FIELD_TYPES as readonly string[]).includes(str(f.type)) ? str(f.type) : "text";
    let v = str(form.get(name)).trim().slice(0, type === "textarea" ? 4000 : 500);
    const label = str(f.label) || name;
    if (type === "checkbox") v = v ? "yes" : "no";
    if (f.required && (!v || (type === "checkbox" && v === "no"))) return void errors.push(`${label} is required`);
    if (!v) return void (data[name] = "");
    const opts = str(f.options).split(",").map((o) => o.trim()).filter(Boolean);
    if ((type === "select" || type === "radio") && !opts.includes(v)) return void errors.push(`${label}: choose one of the options`);
    if (type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return void errors.push(`${label}: enter a valid email`);
    if (type === "number" && !Number.isFinite(Number(v))) return void errors.push(`${label}: enter a number`);
    if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return void errors.push(`${label}: enter a date`);
    if (type === "time" && !/^\d{2}:\d{2}$/.test(v)) return void errors.push(`${label}: enter a time`);
    if (type === "url" && !/^https?:\/\/\S+$/i.test(v)) return void errors.push(`${label}: enter a web address`);
    if (type === "tel" && !/^[+\d][\d\s().-]{5,24}$/.test(v)) return void errors.push(`${label}: enter a phone number`);
    data[name] = v;
  });
  return { data, errors };
}

export async function submitCustomForm(projectId: string, deploymentId: string, formId: string, artifact: Record<string, string>, form: FormData, page: string) {
  let doc: SiteDoc;
  try {
    doc = JSON.parse(artifact["/__doc"] ?? "null");
  } catch {
    throw new ApiError("not_found", "Form not found");
  }
  const section = doc && findCustomForm(doc, formId);
  if (!section) throw new ApiError("not_found", "Form not found");
  const p = section.props;
  const { data, errors } = validateCustomForm(Array.isArray(p.fields) ? (p.fields as P[]) : [], form);
  if (errors.length) throw new ApiError("validation_failed", errors[0], { fields: errors });
  await db.insert(schema.formSubmissions).values({ projectId, deploymentId, formId, data });
  await emitEvent(projectId, "form.submitted", { formId, formName: str(p.heading) || "Custom form", page, data, submittedAt: new Date().toISOString() });

  // Optional: a row in a data table, matching field keys to the table's fields.
  const tableRef = str(p.table).trim();
  if (tableRef) {
    try {
      const t = await getTable(projectId, tableRef);
      const row: Record<string, unknown> = {};
      for (const f of t.fields) if (f.key in data && data[f.key] !== "") row[f.key] = data[f.key];
      await insertRows(projectId, t, [row]);
    } catch (e) {
      // The submission is safe in the inbox; the owner sees the reason in the log.
      log.warn("custom_form_table_failed", { projectId, formId, error: (e as Error).message });
    }
  }

  // Optional: email — only to people in the project's organisation or the store's address.
  const to = str(p.notifyEmail).trim().toLowerCase();
  if (to && (await isTeamAddress(projectId, to))) {
    const body = Object.entries(data)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    await sendMail({ to, subject: `${doc.name}: new “${str(p.heading) || "form"}” submission`, body: `${body}\n\nPage: ${page || "/"}`, replyTo: Object.values(data).find((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) }).catch(() => {});
  }
}

async function isTeamAddress(projectId: string, email: string) {
  const [proj] = await db.select({ orgId: schema.projects.orgId }).from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!proj) return false;
  const [m] = await db.select({ id: schema.users.id }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, proj.orgId), eq(schema.users.email, email)));
  if (m) return true;
  const [st] = await db.select({ email: schema.stores.email }).from(schema.stores).where(eq(schema.stores.projectId, projectId));
  return !!st?.email && st.email.toLowerCase() === email;
}
