import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, db, schema } from "@/db";
import * as me from "@/app/api/v1/auth/me/route";
import * as signup from "@/app/api/v1/auth/signup/route";
import * as docPage from "@/app/doc/[token]/route";
import * as orgProjects from "@/app/api/v1/orgs/[orgId]/projects/route";
import * as invRoute from "@/app/api/v1/projects/[projectId]/invoicing/[[...slug]]/route";
import * as storeRoute from "@/app/api/v1/projects/[projectId]/store/[[...slug]]/route";
import { addPeriod } from "@/lib/invoicing/model";
import { financialYear } from "@/lib/store/gst";
import { applyExtracted } from "@/server/invoicing/extract";
import { PDFDocument } from "pdf-lib";
import { pdfForOwner, runRecurring, runReminders, today } from "@/server/invoicing/service";
import { setMailHttp } from "@/server/services/mail";
import { call, cookieFrom, ORIGIN, resetDb } from "../helpers";

let cookie = "";
let editor = "";
let viewer = "";
let projectId = "";
let clientId = "";
const I = (method: string, path: string, body?: unknown, c = cookie) => call(invRoute[method as "GET"], { method, cookie: c, body, path: `/api/v1/projects/${projectId}/invoicing/${path}`, params: { projectId, slug: path.split("?")[0].split("/").filter(Boolean) } });
const fy = financialYear(new Date());
const t = today();

const party = { name: "Asha Rao", company: "Rao Traders", email: "asha@rao.example", phone: "+91 98450 00000", gstin: "27AAPFU0939F1ZV", billing: { line1: "12 MG Road", line2: "", city: "Pune", state: "Maharashtra", postalCode: "411001", country: "IN" }, shipping: null };
const doc = (patch: Record<string, unknown> = {}) => ({
  type: "invoice",
  clientId,
  client: party,
  issueDate: t,
  dueDate: addPeriod(t, "month"),
  currency: "INR",
  lines: [
    { id: "a", name: "Brand identity", hsn: "998391", quantity: 1, rate: 4500000, taxBps: 1800, unit: "" },
    { id: "b", name: "Printed cards", hsn: "4911", quantity: 500, rate: 1200, taxBps: 1200, unit: "pcs", discount: { kind: "percent", value: 10 } },
  ],
  taxMode: "gst",
  placeOfSupply: "Maharashtra",
  notes: "Thank you!",
  ...patch,
});

beforeAll(async () => {
  await resetDb();
  cookie = cookieFrom(await call(signup.POST, { method: "POST", body: { name: "Kiran Books", email: "kiran@example.com", password: "correct-horse-42" } }));
  const orgId = (await call(me.GET, { cookie })).json.organizations[0].id;
  projectId = (await call(orgProjects.POST, { method: "POST", cookie, params: { orgId }, body: { templateId: "blank", name: "North Studio" } })).json.project.id;
  // A store gives invoicing its defaults (name, state, GSTIN).
  await call(storeRoute.POST, { method: "POST", cookie, path: `/api/v1/projects/${projectId}/store/setup`, params: { projectId, slug: ["setup"] }, body: { name: "North Studio", country: "IN", region: "Karnataka" } });
  for (const [email, role] of [["ed@example.com", "editor"], ["vi@example.com", "viewer"]] as const) {
    const c = cookieFrom(await call(signup.POST, { method: "POST", body: { name: role, email, password: "correct-horse-42" } }));
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
    await db.insert(schema.memberships).values({ orgId, userId: u.id, role });
    if (role === "editor") editor = c;
    else viewer = c;
  }
});
afterAll(closeDb);

describe("setup", () => {
  it("starts from what the project knows, with a Classic template ready", async () => {
    const r = await I("GET", "");
    expect(r.status).toBe(200);
    expect(r.json.settings).toMatchObject({ saved: false, currency: "INR", taxMode: "gst", business: { name: "North Studio", address: { state: "Karnataka" } } });
    expect(r.json.templates.map((x: { name: string }) => x.name)).toEqual(["Classic"]);
    expect(r.json.prebuilt).toHaveLength(8);
    expect(r.json.ai).toBe(false);
  });

  it("keeps people without access out, and editors can't void", async () => {
    expect((await I("GET", "", undefined, viewer)).status).toBe(403);
    expect((await I("GET", "", undefined, editor)).json.canVoid).toBe(false);
  });

  it("saves business, payment and numbering settings", async () => {
    const cur = (await I("GET", "settings")).json.settings;
    const r = await I("PUT", "settings", { ...cur, business: { ...cur.business, gstin: "29ABCDE1234F1Z5", email: "hello@north.example" }, payment: { ...cur.payment, upiId: "north@upi", accountNumber: "0012345678", ifsc: "HDFC0000123" } });
    expect(r.status).toBe(200);
    expect(r.json.settings).toMatchObject({ saved: true, payment: { upiId: "north@upi" }, numbering: { invoice: { prefix: "INV", next: 1 } } });
  });

  it("keeps clients and saved items", async () => {
    const c = await I("POST", "clients", { ...party, notes: "Pays by NEFT" });
    expect(c.status).toBe(201);
    clientId = c.json.client.id;
    expect((await I("POST", "items", { name: "Logo design", hsn: "998391", rate: 2500000, taxBps: 1800, unit: "" })).status).toBe(201);
    expect((await I("GET", "items")).json.items).toHaveLength(1);
    expect((await I("POST", "clients", { ...party, email: "not-an-email" })).status).toBe(422);
  });
});

let invoiceId = "";
let token = "";
describe("invoices", () => {
  it("drafts compute totals on the server and number only when issued", async () => {
    const r = await I("POST", "documents", { document: doc() });
    expect(r.status).toBe(201);
    const d = r.json.document;
    // 45,000 + (500 × 12 − 10%) = 45,000 + 5,400; IGST (Karnataka → Maharashtra) 8,100 + 648.
    expect(d).toMatchObject({ status: "draft", number: "", subtotal: 4500000 + 600000, discountTotal: 60000, taxTotal: 810000 + 64800, total: 4500000 + 540000 + 874800 });
    expect(d.taxes.map((x: { label: string }) => x.label)).toEqual(["IGST 12%", "IGST 18%"]);
    invoiceId = d.id;
    token = d.shareToken;
    // Drafts are never visible to clients.
    expect((await docPage.GET(new Request(`${ORIGIN}/doc/${token}`), { params: Promise.resolve({ token }) })).status).toBe(404);
    const issued = await I("POST", `documents/${invoiceId}/issue`);
    expect(issued.json.document).toMatchObject({ number: `INV/${fy}/0001`, status: "sent", displayStatus: "sent" });
    const second = await I("POST", "documents", { document: doc(), issue: true });
    expect(second.json.document.number).toBe(`INV/${fy}/0002`);
    // A number typed by hand can't clash.
    expect((await I("POST", "documents", { document: doc({ number: `INV/${fy}/0002` }), issue: true })).status).toBe(409);
    // A hand-typed number later in the series is skipped by the counter.
    await I("POST", "documents", { document: doc({ number: `INV/${fy}/0003` }), issue: true });
    expect((await I("POST", "documents", { document: doc(), issue: true })).json.document.number).toBe(`INV/${fy}/0004`);
  });

  it("rejects bad documents with clear reasons", async () => {
    expect(JSON.stringify((await I("POST", "documents", { document: doc({ lines: [] }) })).json.error.details)).toMatch(/at least one line/);
    expect((await I("POST", "documents", { document: doc({ dueDate: "2000-01-01" }) })).json.error.message).toMatch(/due date is before/);
    expect((await I("POST", "documents", { document: doc({ clientId: "00000000-0000-4000-8000-000000000000" }) })).status).toBe(422);
  });

  it("opens for the client, counts views, and shows UPI and the PDF button", async () => {
    const res = await docPage.GET(new Request(`${ORIGIN}/doc/${token}`), { params: Promise.resolve({ token }) });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(html).toContain(`INV/${fy}/0001`);
    expect(html).toContain("Download PDF / Print");
    expect(html).toContain("upi://pay?pa=north%40upi");
    const d = (await I("GET", `documents/${invoiceId}`)).json;
    expect(d.document).toMatchObject({ status: "viewed", viewCount: 1 });
    expect(d.events.map((e: { kind: string }) => e.kind)).toContain("viewed");
  });

  it("records part and full payments, and refuses overpayment", async () => {
    const total = (await I("GET", `documents/${invoiceId}`)).json.document.total;
    const part = await I("POST", `documents/${invoiceId}/payments`, { amount: 1000000, method: "upi", paidOn: t, reference: "UTR123" });
    expect(part.json.document).toMatchObject({ amountPaid: 1000000, displayStatus: "partial", balance: total - 1000000 });
    expect((await I("POST", `documents/${invoiceId}/payments`, { amount: total, method: "bank", paidOn: t })).status).toBe(422);
    const full = await I("POST", `documents/${invoiceId}/payments`, { amount: total - 1000000, method: "bank", paidOn: t });
    expect(full.json.document).toMatchObject({ displayStatus: "paid", balance: 0 });
    // Editing can't drop the total below what's been paid.
    expect((await I("PUT", `documents/${invoiceId}`, { document: doc({ lines: [{ id: "x", name: "Small", quantity: 1, rate: 100, taxBps: 0 }] }) })).status).toBe(409);
    // Paid documents can't be voided; editors can't remove payments.
    expect((await I("POST", `documents/${invoiceId}/void`, { reason: "x" })).status).toBe(409);
    expect((await I("DELETE", `documents/${invoiceId}/payments/${full.json.payments[1].id}`, undefined, editor)).status).toBe(403);
    const removed = await I("DELETE", `documents/${invoiceId}/payments/${full.json.payments[1].id}`);
    expect(removed.json.document.displayStatus).toBe("partial");
  });

  it("issues credit notes against invoices, and voids only what's unpaid", async () => {
    const cn = await I("POST", `documents/${invoiceId}/credit-note`);
    expect(cn.json.document).toMatchObject({ type: "credit_note", status: "draft", reference: `INV/${fy}/0001` });
    expect(cn.json.source.id).toBe(invoiceId);
    expect((await I("POST", `documents/${cn.json.document.id}/issue`)).json.document.number).toBe(`CN/${fy}/0001`);
    const fresh = (await I("POST", "documents", { document: doc(), issue: true })).json.document;
    expect((await I("POST", `documents/${fresh.id}/void`, { reason: "Duplicate" }, editor)).status).toBe(403);
    expect((await I("POST", `documents/${fresh.id}/void`, { reason: "Duplicate" })).json.document.displayStatus).toBe("void");
    expect((await I("DELETE", `documents/${fresh.id}`)).status).toBe(409);
    const draft = (await I("POST", "documents", { document: doc() })).json.document;
    expect((await I("DELETE", `documents/${draft.id}`)).status).toBe(200);
  });

  it("emails the link and says honestly that delivery isn't set up", async () => {
    const m = (await I("GET", `documents/${invoiceId}/message`)).json;
    expect(m.subject).toBe(`Invoice INV/${fy}/0001 from North Studio`);
    const r = await I("POST", `documents/${invoiceId}/send`, { to: "asha@rao.example", subject: m.subject, message: m.message });
    expect(r.json.delivered).toBe(false);
    const [mail] = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.to, "asha@rao.example"));
    expect(mail.body).toContain(`/doc/${token}`);
    expect(r.json.events[0].message).toContain("recorded only");
    const shared = await I("POST", `documents/${invoiceId}/shared`, { via: "whatsapp" });
    expect(shared.json.events[0].message).toBe("Shared on WhatsApp");
  });
});

describe("PDF", () => {
  it("makes a real PDF of the document, page after page for long ones", async () => {
    const r = await I("GET", `documents/${invoiceId}/pdf`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toMatch(/^inline; filename=".+0001\.pdf"$/);
    expect(r.text.startsWith("%PDF-")).toBe(true);
    const f = await pdfForOwner(projectId, invoiceId);
    const pdf = await PDFDocument.load(f.bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain(`INV/${fy}/0001`);
    // 80 lines with long descriptions, emoji and a rupee sign: more pages, nothing fails.
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `l${i}`, name: `Item ${i + 1} — hand-thrown stoneware 🍵 ₹`, description: "Glazed in ash white; packed in recycled board. ".repeat(3), hsn: "6912", quantity: 2, rate: 85000, taxBps: 1200, unit: "pcs" }));
    const long = (await I("POST", "documents", { document: doc({ lines: many }) })).json.document;
    const lp = await PDFDocument.load((await pdfForOwner(projectId, long.id)).bytes);
    expect(lp.getPageCount()).toBeGreaterThan(2);
  });

  it("goes with the emailed invoice, unless you leave it off", async () => {
    const keep = { MAIL_FROM: process.env.MAIL_FROM, RESEND_API_KEY: process.env.RESEND_API_KEY, MAIL_PROVIDER: process.env.MAIL_PROVIDER };
    Object.assign(process.env, { MAIL_FROM: "billing@north.example", RESEND_API_KEY: "re_test", MAIL_PROVIDER: "resend" });
    const bodies: { attachments?: { filename: string; content: string; content_type: string }[] }[] = [];
    setMailHttp(async (_u, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ id: `re_${bodies.length}` });
    });
    try {
      const r = await I("POST", `documents/${invoiceId}/send`, { to: "asha@rao.example", subject: "Your invoice", message: "Hi Asha" });
      expect(r.json.delivered).toBe(true);
      const a = bodies[0]!.attachments!;
      expect(a).toHaveLength(1);
      expect(a[0]!.filename).toMatch(/\.pdf$/);
      expect(a[0]!.content_type).toBe("application/pdf");
      expect(Buffer.from(a[0]!.content, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      await I("POST", `documents/${invoiceId}/send`, { to: "asha@rao.example", subject: "Link only", message: "Hi", attachPdf: false });
      expect(bodies[1]!.attachments).toBeUndefined();
    } finally {
      setMailHttp(fetch);
      for (const [k, v] of Object.entries(keep)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  });
});

describe("quotations", () => {
  it("can be accepted by the client and converted to an invoice", async () => {
    const q = (await I("POST", "documents", { document: doc({ type: "quote", dueDate: addPeriod(t, "month") }), issue: true })).json.document;
    expect(q.number).toBe(`QT/${fy}/0001`);
    const form = (decision: string, name: string) => {
      const f = new FormData();
      f.set("decision", decision);
      f.set("name", name);
      return new Request(`${ORIGIN}/doc/${q.shareToken}`, { method: "POST", body: f, headers: { origin: ORIGIN } });
    };
    expect((await docPage.POST(form("accept", ""), { params: Promise.resolve({ token: q.shareToken }) })).headers.get("location")).toContain("m=error");
    const ok = await docPage.POST(form("accept", "Asha Rao"), { params: Promise.resolve({ token: q.shareToken }) });
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toContain("m=accepted");
    // A second answer is refused.
    expect((await docPage.POST(form("decline", "Someone"), { params: Promise.resolve({ token: q.shareToken }) })).headers.get("location")).toContain("already");
    const accepted = (await I("GET", `documents/${q.id}`)).json.document;
    expect(accepted).toMatchObject({ status: "accepted", decidedBy: "Asha Rao" });
    const conv = await I("POST", `documents/${q.id}/convert`, { to: "invoice" });
    expect(conv.json.document).toMatchObject({ type: "invoice", status: "draft", reference: q.number, total: q.total });
    expect((await I("GET", `documents/${q.id}`)).json.document.status).toBe("converted");
  });

  it("can't be accepted once expired", async () => {
    const old = (await I("POST", "documents", { document: doc({ type: "quote", issueDate: "2026-01-01", dueDate: "2026-01-15" }), issue: true })).json.document;
    const f = new FormData();
    f.set("decision", "accept");
    f.set("name", "Late");
    const r = await docPage.POST(new Request(`${ORIGIN}/doc/${old.shareToken}`, { method: "POST", body: f, headers: { origin: ORIGIN } }), { params: Promise.resolve({ token: old.shareToken }) });
    expect(decodeURIComponent(r.headers.get("location")!)).toContain("expired");
  });
});

describe("recurring invoices and reminders", () => {
  it("creates the next invoice on schedule and moves the schedule on", async () => {
    const src = (await I("POST", "documents", { document: doc({ recurring: { every: "month", nextRun: t, endsOn: null, autoSend: true } }), issue: true })).json.document;
    const before = (await I("GET", "documents?type=invoice")).json.documents.length;
    expect(await runRecurring(t)).toBe(1);
    expect(await runRecurring(t)).toBe(0); // not twice
    const after = (await I("GET", "documents?type=invoice")).json.documents;
    expect(after.length).toBe(before + 1);
    const made = after.find((d: { sourceId: string }) => d.sourceId === src.id);
    expect(made).toMatchObject({ status: "sent", total: src.total });
    expect((await I("GET", `documents/${src.id}`)).json.document.recurring.nextRun).toBe(addPeriod(t, "month"));
    const mails = await db.select().from(schema.outboundEmails).where(eq(schema.outboundEmails.subject, `Invoice ${made.number} from North Studio`));
    expect(mails).toHaveLength(1);
  });

  it("sends a reminder on the chosen day after the due date, once", async () => {
    const cur = (await I("GET", "settings")).json.settings;
    await I("PUT", "settings", { ...cur, reminders: { enabled: true, beforeDays: 3, afterDays: [5] } });
    const late = (await I("POST", "documents", { document: doc({ issueDate: addPeriod(t, "month", -1), dueDate: (() => { const d = new Date(`${t}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 5); return d.toISOString().slice(0, 10); })() }), issue: true })).json.document;
    expect(await runReminders(t)).toBeGreaterThanOrEqual(1);
    expect(await runReminders(t)).toBe(0);
    const ev = (await I("GET", `documents/${late.id}`)).json.events;
    expect(ev.some((e: { kind: string }) => e.kind === "reminder")).toBe(true);
  });
});

describe("reports and exports", () => {
  it("adds up real documents and payments only", async () => {
    const r = (await I("GET", `reports?from=${t.slice(0, 4)}-01-01&to=${t}`)).json;
    const docs = (await I("GET", "documents?type=invoice")).json.documents.filter((d: { status: string; issueDate: string }) => !["draft", "void"].includes(d.status) && d.issueDate >= `${t.slice(0, 4)}-01-01`);
    expect(r.kpis.invoiced).toBe(docs.reduce((a: number, d: { total: number }) => a + d.total, 0));
    expect(r.kpis.collected).toBe(1000000);
    expect(r.kpis.overdue).toBeGreaterThan(0);
    expect(r.aging.d1_30).toBeGreaterThan(0);
    expect(r.quotes).toMatchObject({ count: 2, won: 1, conversion: 0.5 });
    expect(r.gst.igst).toBeGreaterThan(0);
    expect(r.months).toHaveLength(12);
    expect(r.methods).toEqual([{ method: "upi", amount: 1000000, count: 1 }]);
  });

  it("exports CSVs safe to open in spreadsheets", async () => {
    await I("POST", "documents", { document: doc({ client: { ...party, name: "=HYPERLINK(\"x\")", company: "" } }), issue: true });
    const csv = (await I("GET", `export/documents?from=${t.slice(0, 4)}-01-01&to=${t}`)).text;
    expect(csv.split("\n")[0]).toContain("Number");
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    const tax = (await I("GET", `export/tax?from=${t.slice(0, 4)}-01-01&to=${t}`)).text;
    expect(tax).toContain("Credit note");
    expect(tax).toMatch(/-\d+\.\d{2}/);
  });
});

describe("templates", () => {
  it("adds prebuilt designs, protects the default, and stores an uploaded format", async () => {
    const m = await I("POST", "templates", { name: "Modern", from: "modern" });
    expect(m.json.template.config.layout).toBe("modern");
    const cur = (await I("GET", "settings")).json.settings;
    await I("PUT", "settings", { ...cur, defaultTemplateId: m.json.template.id });
    expect((await I("DELETE", `templates/${m.json.template.id}`)).status).toBe(409);
    // No AI key: the file is kept for side-by-side matching, and the response says so.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const f = new FormData();
    f.set("file", new File([png], "my-invoice.png", { type: "image/png" }));
    const res = await invRoute.POST(new Request(`${ORIGIN}/api/v1/projects/${projectId}/invoicing/templates/read`, { method: "POST", body: f, headers: { cookie, origin: ORIGIN } }), { params: Promise.resolve({ projectId, slug: ["templates", "read"] }) });
    const j = await res.json();
    expect(res.status).toBe(201);
    expect(j).toMatchObject({ ai: false, template: { source: "uploaded", name: "Matched from my-invoice.png" } });
    const ref = await I("GET", `templates/${j.template.id}/reference`);
    expect(ref.headers.get("content-type")).toBe("image/png");
    // A file pretending to be a PDF is refused.
    const bad = new FormData();
    bad.set("file", new File([Buffer.from("hello")], "x.pdf", { type: "application/pdf" }));
    expect((await invRoute.POST(new Request(`${ORIGIN}/api/v1/projects/${projectId}/invoicing/templates/read`, { method: "POST", body: bad, headers: { cookie, origin: ORIGIN } }), { params: Promise.resolve({ projectId, slug: ["templates", "read"] }) })).status).toBe(422);
  });
});

it("turns what was read from an uploaded invoice into a template and suggestions", () => {
  const r = applyExtracted({
    layout: "compact",
    colors: { accent: "#0a3d62", ink: undefined, tableHeader: "#e5e5e5" },
    font: "serif",
    paper: "A4",
    logoPosition: "right",
    tableStyle: "boxed",
    columns: { unit: true, discount: false },
    labels: { title: "TAX INVOICE", item: "Particulars", total: "Grand Total" },
    show: { upiQr: false, taxSummary: true },
    business: { name: "Shree Traders", gstin: "24AAACS1234F1Z9", city: "Surat" },
    bank: { bankName: "SBI", accountNumber: "30012345678", ifsc: "SBIN0001234" },
    terms: "Goods once sold will not be taken back.",
    notes: undefined,
    footer: "Subject to Surat jurisdiction",
    numberExample: "ST/2025-26/0142",
    currency: "INR",
    uncertain: [],
  });
  expect(r.config).toMatchObject({ layout: "compact", font: "serif", logo: { position: "right" }, table: { style: "boxed", columns: { unit: true, discount: false, amount: true } }, labels: { invoice: "TAX INVOICE", item: "Particulars", total: "Grand Total", billTo: "Bill to" }, show: { upiQr: false, taxSummary: true }, footerText: "Subject to Surat jurisdiction" });
  expect(r.config.colors.accent).toBe("#0a3d62");
  expect(r.suggestions.numbering).toEqual({ prefix: "ST", yearly: true, pad: 4 });
  expect(r.suggestions.business).toEqual({ name: "Shree Traders", gstin: "24AAACS1234F1Z9", city: "Surat" });
  expect(r.suggestions.payment.ifsc).toBe("SBIN0001234");
});
