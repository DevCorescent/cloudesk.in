// Built-in integrations: notifications (Slack, Discord, Telegram) and
// audience sync (Mailchimp). Credentials are verified when connecting and
// stored encrypted; work happens in the background job queue.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { EventType } from "@/lib/platform/events";
import { ApiError, notFound } from "../http/errors";
import { defineJob, enqueue, PermanentError } from "../jobs/queue";
import { safeRequest, type SafeResponse } from "../net/safe-fetch";
import { decryptSecret, encryptSecret, secretHint } from "../security/secrets";
import { audit } from "../services/audit";
import type { EventEnvelope } from "./webhooks";

export const INTEGRATION_KINDS = ["slack", "discord", "telegram", "mailchimp"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];
type Creds = Record<string, string>;

type Http = (url: string, opts: { method: string; headers: Record<string, string>; body?: string }) => Promise<SafeResponse>;
let http: Http = (url, opts) => safeRequest(url, { ...opts, maxBytes: 64_000, timeoutMs: 10_000 });
/** Test hook. */
export function setIntegrationHttp(fn: Http | null) {
  http = fn ?? ((url, opts) => safeRequest(url, { ...opts, maxBytes: 64_000, timeoutMs: 10_000 }));
}

const NOTIFY_DEFAULT: EventType[] = ["order.paid", "form.submitted", "booking.confirmed"];

/** A short, human message for notification channels. */
export function describeEvent(evt: Pick<EventEnvelope, "type" | "data">, projectName: string): string {
  const d = evt.data as Record<string, string & Record<string, string>>;
  switch (evt.type) {
    case "order.placed":
      return `🧾 ${projectName}: new order ${d.label} from ${d.customerName || d.email} — ${d.currency} ${d.total} (${d.paymentMethod})`;
    case "order.paid":
      return `💸 ${projectName}: ${d.customerName || d.email} paid ${d.currency} ${d.total} for order ${d.label}`;
    case "order.shipped":
      return `📦 ${projectName}: order ${d.label} shipped${d.trackingNumber ? ` (${d.carrier ?? ""} ${d.trackingNumber})` : ""}`;
    case "order.cancelled":
      return `✖️ ${projectName}: order ${d.label} cancelled`;
    case "form.submitted": {
      const data = (d.data ?? {}) as Record<string, string>;
      return `✉️ ${projectName}: new ${d.formId} form — ${data.name ?? ""} ${data.email ? `<${data.email}>` : data.contact ?? ""}${data.message ? `\n“${data.message.slice(0, 300)}”` : ""}`;
    }
    case "booking.confirmed":
      return `📅 ${projectName}: ${d.name} booked ${d.service} for ${new Date(d.startsAt).toUTCString().replace(":00 GMT", " UTC")}`;
    case "booking.cancelled":
      return `📅 ${projectName}: booking for ${d.service} by ${d.name} was cancelled`;
    case "row.created":
    case "row.updated":
    case "row.deleted":
      return `🗂️ ${projectName}: row ${evt.type.slice(4)} in ${d.table}`;
    case "webhook.test":
      return `✅ ${projectName}: test message from Cloudesk`;
  }
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await http(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
  if (r.status >= 400) throw new PermanentError(`HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  return r;
}

const mailchimpBase = (apiKey: string) => {
  const dc = apiKey.split("-")[1];
  if (!dc || !/^[a-z]{2,4}\d{1,3}$/.test(dc)) throw new ApiError("validation_failed", "A Mailchimp API key ends with a data-centre code like -us21", { apiKey: ["Invalid key"] });
  return `https://${dc}.api.mailchimp.com/3.0`;
};
const mcAuth = (apiKey: string) => ({ Authorization: `Basic ${Buffer.from(`any:${apiKey}`).toString("base64")}` });

async function send(kind: IntegrationKind, creds: Creds, text: string) {
  if (kind === "slack") await postJson(creds.webhookUrl, { text });
  else if (kind === "discord") await postJson(creds.webhookUrl, { content: text.slice(0, 2000), allowed_mentions: { parse: [] } });
  else if (kind === "telegram") {
    const r = await postJson(`https://api.telegram.org/bot${creds.botToken}/sendMessage`, { chat_id: creds.chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
    const j = JSON.parse(r.text || "{}") as { ok?: boolean; description?: string };
    if (!j.ok) throw new PermanentError(j.description ?? "Telegram refused the message");
  }
}

/** Checks credentials with the provider before saving them. */
async function verify(kind: IntegrationKind, creds: Creds, settings: Record<string, unknown>) {
  switch (kind) {
    case "slack":
      if (!/^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(creds.webhookUrl ?? "")) throw new ApiError("validation_failed", "Paste a Slack incoming-webhook URL (https://hooks.slack.com/services/…)", { webhookUrl: ["Invalid URL"] });
      // Slack webhooks can only be checked by posting.
      await send("slack", creds, "✅ Connected to Cloudesk. You'll get notifications here.");
      return;
    case "discord": {
      if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(creds.webhookUrl ?? "")) throw new ApiError("validation_failed", "Paste a Discord webhook URL (https://discord.com/api/webhooks/…)", { webhookUrl: ["Invalid URL"] });
      const r = await http(creds.webhookUrl, { method: "GET", headers: {} });
      if (r.status !== 200) throw new ApiError("validation_failed", "Discord didn't recognise that webhook", { webhookUrl: ["Not found"] });
      return;
    }
    case "telegram": {
      if (!/^\d{5,}:[\w-]{30,}$/.test(creds.botToken ?? "")) throw new ApiError("validation_failed", "That doesn't look like a bot token from @BotFather", { botToken: ["Invalid token"] });
      if (!/^-?\d{3,}$|^@\w{4,}$/.test(creds.chatId ?? "")) throw new ApiError("validation_failed", "Use a numeric chat id or an @channel name", { chatId: ["Invalid chat"] });
      const r = await http(`https://api.telegram.org/bot${creds.botToken}/getMe`, { method: "GET", headers: {} });
      if (!(JSON.parse(r.text || "{}") as { ok?: boolean }).ok) throw new ApiError("validation_failed", "Telegram didn't accept that bot token", { botToken: ["Rejected"] });
      await send("telegram", creds, "✅ Connected to Cloudesk.");
      return;
    }
    case "mailchimp": {
      const base = mailchimpBase(creds.apiKey ?? "");
      if (!/^\w{4,20}$/.test(String(settings.listId ?? ""))) throw new ApiError("validation_failed", "Enter the audience (list) id", { listId: ["Required"] });
      const r = await http(`${base}/lists/${settings.listId}`, { method: "GET", headers: mcAuth(creds.apiKey) });
      if (r.status === 401) throw new ApiError("validation_failed", "Mailchimp rejected the API key", { apiKey: ["Rejected"] });
      if (r.status !== 200) throw new ApiError("validation_failed", "Mailchimp couldn't find that audience", { listId: ["Not found"] });
      return;
    }
  }
}

export async function listIntegrations(projectId: string) {
  const rows = await db.select().from(schema.integrations).where(eq(schema.integrations.projectId, projectId));
  return rows.map((r) => {
    const creds = JSON.parse(decryptSecret(r.credsEnc)) as Creds;
    return { id: r.id, kind: r.kind as IntegrationKind, enabled: r.enabled, settings: r.settings, lastError: r.lastError, lastUsedAt: r.lastUsedAt, createdAt: r.createdAt, hint: secretHint(creds.webhookUrl ?? creds.botToken ?? creds.apiKey ?? "") };
  });
}

export async function connectIntegration(project: { id: string; orgId: string }, userId: string, kind: IntegrationKind, creds: Creds, settings: Record<string, unknown>) {
  const s = kind === "mailchimp" ? { listId: String(settings.listId ?? ""), doubleOptIn: settings.doubleOptIn !== false, sources: Array.isArray(settings.sources) ? settings.sources : ["newsletter", "customers"] } : { events: Array.isArray(settings.events) && settings.events.length ? settings.events : NOTIFY_DEFAULT };
  await verify(kind, creds, s);
  await db
    .insert(schema.integrations)
    .values({ projectId: project.id, kind, credsEnc: encryptSecret(JSON.stringify(creds)), settings: s, createdBy: userId })
    .onConflictDoUpdate({ target: [schema.integrations.projectId, schema.integrations.kind], set: { credsEnc: encryptSecret(JSON.stringify(creds)), settings: s, enabled: true, lastError: null } });
  await audit({ orgId: project.orgId, actorId: userId, action: "integration.connected", targetType: "integration", targetId: kind });
}

export async function updateIntegration(projectId: string, kind: string, patch: { enabled?: boolean; events?: string[] }) {
  const [i] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.projectId, projectId), eq(schema.integrations.kind, kind)));
  if (!i) throw notFound("Integration");
  await db
    .update(schema.integrations)
    .set({ ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), ...(patch.events ? { settings: { ...(i.settings as object), events: patch.events } } : {}) })
    .where(eq(schema.integrations.id, i.id));
}

export async function disconnectIntegration(project: { id: string; orgId: string }, userId: string, kind: string) {
  const r = await db.delete(schema.integrations).where(and(eq(schema.integrations.projectId, project.id), eq(schema.integrations.kind, kind))).returning({ id: schema.integrations.id });
  if (!r.length) throw notFound("Integration");
  await audit({ orgId: project.orgId, actorId: userId, action: "integration.disconnected", targetType: "integration", targetId: kind });
}

/** Which integrations care about this event; queues their work. */
export async function fanOutIntegrations(evt: EventEnvelope) {
  const rows = await db.select().from(schema.integrations).where(and(eq(schema.integrations.projectId, evt.projectId), eq(schema.integrations.enabled, true)));
  for (const i of rows) {
    const s = i.settings as { events?: string[]; sources?: string[] };
    const wants =
      i.kind === "mailchimp"
        ? (evt.type === "form.submitted" && (evt.data as { formId?: string }).formId === "newsletter" && s.sources?.includes("newsletter")) || (evt.type === "order.paid" && s.sources?.includes("customers"))
        : evt.type === "webhook.test" || !!s.events?.includes(evt.type);
    if (wants) await enqueue("integration.run", { integrationId: i.id, event: evt }, { projectId: evt.projectId, maxAttempts: 6 });
  }
}

async function mailchimpSubscribe(projectId: string, creds: Creds, settings: { listId: string; doubleOptIn: boolean }, evt: EventEnvelope) {
  let email = "";
  let name = "";
  if (evt.type === "form.submitted") {
    email = String((evt.data.data as Record<string, string>)?.email ?? "");
  } else {
    email = String(evt.data.email ?? "");
    name = String(evt.data.customerName ?? "");
    // Customers are added only if they agreed to marketing at checkout.
    const [c] = await db.select({ ok: schema.storeCustomers.acceptsMarketing }).from(schema.storeCustomers).where(and(eq(schema.storeCustomers.projectId, projectId), sql`lower(${schema.storeCustomers.email}) = ${email.toLowerCase()}`));
    if (!c?.ok) return { skipped: "no marketing consent" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { skipped: "no email" };
  const hash = createHash("md5").update(email.toLowerCase()).digest("hex");
  const r = await http(`${mailchimpBase(creds.apiKey)}/lists/${settings.listId}/members/${hash}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...mcAuth(creds.apiKey) },
    body: JSON.stringify({ email_address: email, status_if_new: settings.doubleOptIn ? "pending" : "subscribed", ...(name ? { merge_fields: { FNAME: name.split(" ")[0] } } : {}) }),
  });
  if (r.status === 429 || r.status >= 500) throw new Error(`Mailchimp HTTP ${r.status}`);
  if (r.status >= 400) throw new PermanentError(`Mailchimp: ${(JSON.parse(r.text || "{}") as { detail?: string }).detail ?? r.status}`);
  return { subscribed: email, status: settings.doubleOptIn ? "pending" : "subscribed" };
}

defineJob<{ integrationId: string; event: EventEnvelope }>(
  "integration.run",
  async ({ integrationId, event }, { job }) => {
    const [i] = await db.select().from(schema.integrations).where(eq(schema.integrations.id, integrationId));
    if (!i || !i.enabled) return { skipped: true };
    const creds = JSON.parse(decryptSecret(i.credsEnc)) as Creds;
    try {
      let out: unknown;
      if (i.kind === "mailchimp") out = await mailchimpSubscribe(i.projectId, creds, i.settings as { listId: string; doubleOptIn: boolean }, event);
      else {
        const [p] = await db.select({ name: schema.projects.name }).from(schema.projects).where(eq(schema.projects.id, i.projectId));
        await send(i.kind as IntegrationKind, creds, describeEvent(event, p?.name ?? "Your site"));
        out = { sent: true };
      }
      await db.update(schema.integrations).set({ lastUsedAt: new Date(), lastError: null }).where(eq(schema.integrations.id, i.id));
      return out;
    } catch (e) {
      if (e instanceof PermanentError || job.attempts >= job.maxAttempts) await db.update(schema.integrations).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(schema.integrations.id, i.id));
      throw e;
    }
  },
  { timeoutMs: 20_000 },
);
