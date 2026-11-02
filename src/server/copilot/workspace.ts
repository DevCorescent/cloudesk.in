// The copilot's reach beyond reports: the person's inbox and calendar, unpaid
// invoices, what's still to set up — read straight away as them — and the
// suggestions it made (lib/copilot/workspace-model.ts), carried out by
// `execute` only when the person confirms, through the module that owns the
// record and with that module's own permission checks.
import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { WORKSPACE_INPUT, type WorkspaceAction } from "@/lib/copilot/workspace-model";
import { ApiError } from "../http/errors";
import type { AuthedContext } from "../http/handler";
import type { Scope } from "./core";

const istDay = (offsetDays = 0) => new Date(Date.now() + 5.5 * 3_600_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

const fmtRupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const ist = (d: string | Date) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

async function mailScope(s: Scope) {
  const { scopeFor } = await import("../mail/access");
  const m = await scopeFor(s.orgId, s.userId);
  if (!m) throw new ApiError("forbidden", "Mail isn't open to this person (switched off, or not in their role).");
  return m;
}

function calScope(s: Scope, user: { name: string; email: string }) {
  if (!s.has("calendar") || !s.ctx.can("calendar:use")) throw new ApiError("forbidden", "Calendar isn't open to this person.");
  return { orgId: s.orgId, userId: s.userId, userName: user.name, userEmail: user.email, has: s.has };
}

async function userOf(s: Scope) {
  const [u] = await db.select({ name: schema.users.name, email: schema.users.email }).from(schema.users).where(eq(schema.users.id, s.userId));
  return u ?? { name: s.name, email: "" };
}

/** Runs one of WORKSPACE_TOOLS; returns the text the model reads. */
export async function readTool(s: Scope, name: string, input: Record<string, unknown>): Promise<string | null> {
  if (name === "mail_accounts") {
    const m = await mailScope(s);
    const { accountsFor } = await import("../mail/access");
    const list = await accountsFor(m);
    return list.length ? list.map((a) => `${a.id} — ${a.address}${a.displayName ? ` (${a.displayName})` : ""}${a.shared ? " — team inbox" : ""}`).join("\n") : "No mailbox is connected yet. They can connect Gmail, Outlook or Zoho in Mail → Add account.";
  }
  if (name === "mail_search") {
    const m = await mailScope(s);
    const { threads } = await import("../mail/core");
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 40);
    const r = await threads(m, { account: "all", view: String(input.view ?? "inbox"), q: String(input.query ?? "") });
    const rows = r.threads.slice(0, limit);
    if (!rows.length) return "No emails match.";
    return rows.map((t) => `thread ${t.id} — “${cut(t.subject || "(no subject)", 120)}” — ${t.participants.map((p) => p.name || p.address).slice(0, 3).join(", ")} — ${ist(t.lastMessageAt)}${t.unread ? " — unread" : ""} — ${cut(t.snippet, 160)}`).join("\n");
  }
  if (name === "mail_read") {
    const id = String(input.threadId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return "Give a thread id from mail_search.";
    const m = await mailScope(s);
    const { detail } = await import("../mail/core");
    const t = await detail(m, id);
    const msgs = t.messages.slice(-6);
    const head = `Thread ${t.thread.id} in mailbox ${t.thread.accountId}: “${t.thread.subject}”${t.contact ? ` — CRM contact ${t.contact.name} (id ${t.contact.id}${t.contact.company ? `, ${t.contact.company}` : ""})` : ""}${t.messages.length > msgs.length ? ` — showing the last ${msgs.length} of ${t.messages.length} messages` : ""}`;
    return [head, ...msgs.map((x) => `--- message ${x.id} — ${x.direction === "out" ? "sent" : "received"} ${ist(x.date)}\nFrom: ${x.from.name ? `${x.from.name} <${x.from.address}>` : x.from.address}\nTo: ${x.to.map((p) => p.address).join(", ")}${x.cc.length ? `\nCc: ${x.cc.map((p) => p.address).join(", ")}` : ""}\nSubject: ${x.subject}\n\n${cut(x.text, 4000)}`)].join("\n");
  }
  if (name === "mail_briefing") {
    const m = await mailScope(s);
    const { briefing } = await import("../mail/ai");
    const b = (await briefing(m)) as { briefing?: string; actions?: { text?: string }[] };
    return [b.briefing ?? "", ...(b.actions ?? []).map((a) => `- ${a.text ?? ""}`)].filter(Boolean).join("\n") || "Nothing new in the inbox.";
  }
  if (name === "calendar_upcoming") {
    const cs = calScope(s, await userOf(s));
    const { range } = await import("../calendar/core");
    const days = Math.min(Math.max(Number(input.days) || 7, 1), 60);
    const now = Date.now();
    const r = await range(cs, { from: new Date(now).toISOString(), to: new Date(now + days * 86_400_000).toISOString() });
    if (!r.events.length) return `Nothing on the calendar in the next ${days} days.`;
    return r.events.slice(0, 60).map((e) => `${ist(e.start)} – ${new Date(e.end).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", timeStyle: "short" })}: ${e.title}${e.meetingUrl ? ` (meeting link)` : ""}`).join("\n");
  }
  if (name === "invoices_list") {
    if (!s.ctx.can("invoices:manage")) throw new ApiError("forbidden", "Invoicing isn't open to this person.");
    const { invoiceBooks } = await import("../org/org");
    const { listDocs } = await import("../invoicing/service");
    const books = await invoiceBooks(s.orgId);
    if (!books.length) return "No invoice books yet — the first invoice creates one.";
    const out: string[] = [];
    for (const b of books.slice(0, 5)) {
      const docs = (await listDocs(b.id, { type: "invoice", status: input.status ? String(input.status) : undefined, q: input.query ? String(input.query) : undefined })) as unknown as { number: string | null; client: { name: string }; total: number; amountPaid: number; dueDate: string | null; displayStatus: string }[];
      for (const d of docs.slice(0, 25)) out.push(`${d.number ?? "draft"} — ${d.client?.name ?? ""} — total ${fmtRupees(d.total)}, due ${fmtRupees(d.total - d.amountPaid)}${d.dueDate ? ` by ${d.dueDate}` : ""} — ${d.displayStatus}${books.length > 1 ? ` — ${b.name}` : ""}`);
    }
    return out.length ? out.join("\n") : "No invoices match.";
  }
  if (name === "setup_status") return setupStatus(s);
  return null;
}

async function setupStatus(s: Scope) {
  const { companies } = await import("../org/org");
  const [co] = await companies(s.orgId);
  const { invoiceBooks } = await import("../org/org");
  const books = await invoiceBooks(s.orgId);
  const { getSettings } = await import("../invoicing/service");
  const inv = books[0] ? await getSettings(books[0].id) : null;
  const [members] = await db.select({ n: count() }).from(schema.memberships).where(eq(schema.memberships.orgId, s.orgId));
  const [invites] = await db.select({ n: count() }).from(schema.invitations).where(and(eq(schema.invitations.orgId, s.orgId), isNull(schema.invitations.acceptedAt)));
  const [boxes] = await db.select({ n: count() }).from(schema.mailAccounts).where(eq(schema.mailAccounts.orgId, s.orgId));
  const [contacts] = s.has("crm") ? await db.select({ n: count() }).from(schema.crmContacts).where(eq(schema.crmContacts.orgId, s.orgId)) : [{ n: -1 }];
  const [items] = s.has("inventory") ? await db.select({ n: count() }).from(schema.invItems).where(eq(schema.invItems.orgId, s.orgId)) : [{ n: -1 }];
  const yes = (b: boolean) => (b ? "done" : "MISSING");
  const lines = [
    `Business name: ${co?.name ?? "—"}`,
    `Legal name: ${co?.legalName ? co.legalName : "MISSING"}`,
    `GSTIN: ${co?.gstin ? co.gstin : "MISSING (skip if not GST-registered)"}`,
    `PAN: ${co?.pan ? co.pan : "MISSING"}`,
    `Address: ${co?.address ? cut(co.address, 120) : "MISSING"}`,
    `Phone and email on invoices: ${yes(!!(inv?.business.phone || inv?.business.email))}`,
    `UPI ID for payments: ${inv?.payment.upiId ? inv.payment.upiId : "MISSING"}`,
    `Mailboxes connected: ${boxes?.n ?? 0}${!boxes?.n ? " — connect one in Mail → Add account (Gmail, Outlook, Zoho)" : ""}`,
    `Team: ${members?.n ?? 1} member(s), ${invites?.n ?? 0} invitation(s) pending`,
    contacts!.n >= 0 ? `CRM contacts: ${contacts!.n}` : "",
    items!.n >= 0 ? `Inventory items: ${items!.n}` : "",
  ].filter(Boolean);
  return `${lines.join("\n")}\n(Today is ${istDay()}.)`;
}

// ── Carrying out a confirmed suggestion ─────────────────────────────────────

export type Done = { id: string; link: string };

/** `messages` is the conversation, for suggestions that use one of its files. */
export async function execute(ctx: AuthedContext, s: Scope, kind: WorkspaceAction, raw: unknown, messages: unknown[] = []): Promise<Done> {
  if (kind === "record_bill" || kind === "inventory_items" || kind === "save_document") return executeFiles(ctx, s, kind, raw, messages);
  if (kind === "send_email") {
    const p = WORKSPACE_INPUT.send_email.parse(raw);
    const { scope } = await import("../mail/access");
    const { accountsFor } = await import("../mail/access");
    const { send } = await import("../mail/send");
    const ms = await scope(ctx, s.orgId);
    const accountId = p.accountId ?? (await accountsFor(ms))[0]?.id;
    if (!accountId) throw new ApiError("conflict", "Connect a mailbox first (Mail → Add account)");
    const r = await send(ms, { accountId, mode: p.mode, ...(p.threadId ? { threadId: p.threadId } : {}), ...(p.replyTo ? { replyTo: p.replyTo } : {}), to: p.to, cc: p.cc, subject: p.subject, body: p.body });
    return { id: r.message.id, link: `/mail/t/${r.message.threadId}` };
  }
  if (kind === "calendar_event") {
    const p = WORKSPACE_INPUT.calendar_event.parse(raw);
    if (Date.parse(p.end) <= Date.parse(p.start)) throw new ApiError("validation_failed", "The event must end after it starts");
    const { calScope } = await import("../calendar/access");
    const { defaultCalendar } = await import("../calendar/access");
    const { createEvent } = await import("../calendar/core");
    const cs = await calScope(ctx, s.orgId);
    const cal = await defaultCalendar(s.orgId, s.userId);
    let mail = null;
    if (p.sendInvite && p.attendees.length) {
      const { scopeFor } = await import("../mail/access");
      mail = await scopeFor(s.orgId, s.userId);
    }
    const r = await createEvent(cs, { calendarId: cal.id, title: p.title, start: p.start, end: p.end, location: p.location, description: p.description, attendees: p.attendees, sendInvite: p.sendInvite && !!mail }, mail);
    return { id: (r.event as { id: string }).id, link: `/calendar?date=${p.start.slice(0, 10)}` };
  }
  if (kind === "crm_contact" || kind === "crm_deal") {
    if (!s.has("crm")) throw new ApiError("forbidden", "The CRM isn't open to you");
    const { scope } = await import("../crm/access");
    const cs = await scope(ctx, s.orgId, "crm:write");
    if (kind === "crm_contact") {
      const p = WORKSPACE_INPUT.crm_contact.parse(raw);
      const { createContact } = await import("../crm/contacts");
      const r = (await createContact(cs, { name: p.name, email: p.email, phone: p.phone, title: p.title, ...(p.companyName ? { companyName: p.companyName } : {}), ownerId: s.userId })) as { contact?: { id: string }; id?: string };
      const id = r.contact?.id ?? r.id ?? "";
      return { id, link: `/crm/contacts/${id}` };
    }
    const p = WORKSPACE_INPUT.crm_deal.parse(raw);
    const { createDeal } = await import("../crm/deals");
    const r = (await createDeal(cs, { title: p.title, value: Math.round(p.value * 100), currency: "INR", contactId: p.contactId, expectedClose: p.expectedClose, ownerId: s.userId })) as { deal?: { id: string }; id?: string };
    const id = r.deal?.id ?? r.id ?? "";
    return { id, link: `/crm/deals/${id}` };
  }
  if (kind === "invoice_draft") {
    const p = WORKSPACE_INPUT.invoice_draft.parse(raw);
    const { requireOrg } = await import("../http/handler");
    await requireOrg(ctx, s.orgId, "invoices:manage");
    const { invoiceBooks } = await import("../org/org");
    let bookId = (await invoiceBooks(s.orgId))[0]?.id;
    if (!bookId) {
      const { createBook } = await import("../invoicing/books");
      const [org] = await db.select({ name: schema.organizations.name }).from(schema.organizations).where(eq(schema.organizations.id, s.orgId));
      bookId = (await createBook(s.orgId, s.userId, org?.name ?? "My business")).id;
    }
    const { createDoc, getSettings } = await import("../invoicing/service");
    const st = await getSettings(bookId);
    const dueDate = p.dueDate ?? istDay(st.dueDays);
    const { docInputSchema } = await import("@/lib/invoicing/model");
    // The same checks and defaults as the invoice form.
    const doc = (await createDoc(bookId, s.userId, docInputSchema.parse({
      type: "invoice",
      clientId: null,
      client: { name: p.client.name, company: p.client.company, email: p.client.email, phone: p.client.phone, gstin: p.client.gstin, billing: { line1: "", line2: "", city: "", state: p.client.state, postalCode: "", country: "IN" }, shipping: null },
      issueDate: istDay(),
      dueDate,
      currency: st.currency || "INR",
      lines: p.lines.map((l, i) => ({ id: `l${i + 1}`, itemId: null, name: l.name, description: "", hsn: l.hsn, quantity: l.quantity, unit: "", rate: Math.round(l.rate * 100), discount: null, taxBps: Math.round(l.taxPercent * 100) })),
      taxMode: st.taxMode,
      inclusive: false,
      placeOfSupply: p.client.state,
      notes: p.notes || st.notes,
      terms: st.terms,
    }))) as { id: string } | { document: { id: string } };
    const id = "id" in doc ? doc.id : doc.document.id;
    return { id, link: `/finance/${bookId}/invoices/${id}` };
  }
  if (kind === "business_profile") {
    const p = WORKSPACE_INPUT.business_profile.parse(raw);
    const { who, companies, saveCompany, invoiceBooks } = await import("../org/org");
    const w = await who(ctx, s.orgId);
    if (!w.admin) throw new ApiError("forbidden", "Only owners and admins can change the business details");
    const [co] = await companies(s.orgId);
    if (co && (p.legalName !== undefined || p.gstin !== undefined || p.pan !== undefined || p.address)) {
      const addr = p.address ? [p.address.line1, p.address.line2, p.address.city, p.address.state, p.address.postalCode].filter(Boolean).join(", ") : co.address;
      await saveCompany(w, co.id, { name: co.name, legalName: p.legalName ?? co.legalName, gstin: p.gstin ?? co.gstin, pan: p.pan ?? co.pan, cin: co.cin, state: co.state, address: addr, baseCurrency: co.baseCurrency, parentId: co.parentId, active: co.active });
    }
    // The same details print on invoices.
    const { getSettings, saveSettings } = await import("../invoicing/service");
    for (const b of await invoiceBooks(s.orgId)) {
      const st = await getSettings(b.id);
      const { saved: _saved, ...cur } = st;
      void _saved;
      await saveSettings(b.id, {
        ...cur,
        business: {
          ...cur.business,
          name: cur.business.name || co?.name || "",
          ...(p.legalName !== undefined ? { legalName: p.legalName } : {}),
          ...(p.gstin !== undefined ? { gstin: p.gstin } : {}),
          ...(p.pan !== undefined ? { pan: p.pan } : {}),
          ...(p.phone !== undefined ? { phone: p.phone } : {}),
          ...(p.email !== undefined ? { email: p.email } : {}),
          ...(p.website !== undefined ? { website: p.website } : {}),
          ...(p.address ? { address: { ...cur.business.address, ...p.address, country: cur.business.address.country || "IN" } } : {}),
        },
        payment: { ...cur.payment, ...(p.upiId !== undefined ? { upiId: p.upiId } : {}) },
      });
    }
    return { id: co?.id ?? s.orgId, link: "/settings/organisation" };
  }
  // invite_member
  const p = WORKSPACE_INPUT.invite_member.parse(raw);
  const { requireOrg } = await import("../http/handler");
  const m = await requireOrg(ctx, s.orgId, "members:manage");
  const { assertUnlimited } = await import("../services/custom-roles");
  const { rateLimit } = await import("../security/rate-limit");
  const { createInvitation } = await import("../services/orgs");
  await assertUnlimited(s.orgId, ctx.user.id);
  await rateLimit(`invite:${s.orgId}`, 50, 24 * 3600_000);
  const { invitation } = await createInvitation(s.orgId, { id: ctx.user.id, role: m.role, name: ctx.user.name }, p.email, p.role);
  return { id: invitation.id, link: "/team" };
}

async function executeFiles(ctx: AuthedContext, s: Scope, kind: "record_bill" | "inventory_items" | "save_document", raw: unknown, messages: unknown[]): Promise<Done> {
  if (kind === "record_bill") {
    const p = WORKSPACE_INPUT.record_bill.parse(raw);
    const { scope } = await import("../accounting/access");
    const { saveBill, recordExpense } = await import("../accounting/bills");
    const as = await scope(ctx, s.orgId);
    if (p.kind === "expense") {
      // Paid already: from the first bank or cash account (they can change it on the expense).
      const [acc] = await db.select({ id: schema.accAccounts.id }).from(schema.accAccounts).where(and(eq(schema.accAccounts.orgId, s.orgId), eq(schema.accAccounts.active, true), inArray(schema.accAccounts.type, ["bank", "cash"]))).limit(1);
      if (!acc) throw new ApiError("conflict", "Add a bank or cash account in Accounts first");
      const r = (await recordExpense(as, { ...p.draft, paidFrom: acc.id })) as { id: string };
      return { id: r.id, link: `/accounts/bills/${r.id}` };
    }
    const r = (await saveBill(as, null, p.draft)) as { id: string };
    return { id: r.id, link: `/accounts/bills/${r.id}` };
  }
  if (kind === "inventory_items") {
    const p = WORKSPACE_INPUT.inventory_items.parse(raw);
    const { scope } = await import("../inventory/access");
    const { saveItem } = await import("../inventory/items");
    const is = await scope(ctx, s.orgId);
    let last = "";
    for (const it of p.items) {
      const r = (await saveItem(is, null, { name: it.name, sku: it.sku, unit: it.unit, category: it.category, hsn: it.hsn, gstRate: it.gstRate, avgCost: Math.round(it.cost * 100) })) as { id?: string; item?: { id: string } };
      last = r.item?.id ?? r.id ?? last;
    }
    return { id: last, link: "/inventory/items" };
  }
  const p = WORKSPACE_INPUT.save_document.parse(raw);
  const { findAttached } = await import("./attachments");
  const f = findAttached(messages, p.attachmentId);
  if (!f) throw new ApiError("not_found", "That file isn't in this conversation any more");
  const { scope } = await import("../documents/access");
  const { upload } = await import("../documents/core");
  const ds = await scope(ctx, s.orgId);
  const row = (await upload(ds, { name: f.name, bytes: f.bytes }, { title: p.title, notes: p.description })) as { id: string };
  return { id: row.id, link: `/documents/file/${row.id}` };
}
