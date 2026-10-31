import { desc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { route } from "@/server/http/handler";
import { MAIL_PROVIDER_NAMES, mailProvider, redactMailSecrets } from "@/server/services/mail";

// Messages recorded by the development "outbox" mail transport, limited to the
// signed-in user's own address. Outside a development outbox the messages
// really go to the mailbox, so links and codes that sign in or reset a
// password are hidden here: a stolen session must not be able to read a
// password-reset link (or sign-in code) and turn itself into the account.
export const GET = route(async (ctx) => {
  const rows = await db
    .select({ id: schema.outboundEmails.id, subject: schema.outboundEmails.subject, body: schema.outboundEmails.body, createdAt: schema.outboundEmails.createdAt, transport: schema.outboundEmails.transport, status: schema.outboundEmails.status, error: schema.outboundEmails.error })
    .from(schema.outboundEmails)
    .where(sql`lower(${schema.outboundEmails.to}) = ${ctx.user.email.toLowerCase()}`)
    .orderBy(desc(schema.outboundEmails.createdAt))
    .limit(20);
  const provider = mailProvider();
  const reveal = provider === "outbox" && process.env.NODE_ENV !== "production";
  const emails = reveal ? rows : rows.map((r) => ({ ...r, subject: redactMailSecrets(r.subject), body: redactMailSecrets(r.body) }));
  return { provider, providerName: MAIL_PROVIDER_NAMES[provider], emails };
});
