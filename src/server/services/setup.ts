// "What's left to set up" for a project, worked out from real data (never from
// what the owner clicked), and ordered by what they told us they need.
import { and, count, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { SITE_DOC_PATH } from "@/lib/site/model";

export type SetupItem = { id: string; title: string; detail: string; done: boolean; href: string; minutes: number };

export async function projectSetup(project: { id: string; productionDeploymentId: string | null; kind?: string }, goals: string[] = []) {
  const pid = project.id;
  const [[store], [anyProducts], [products], [samples], [payments], [rates], [domains], [verified], [edits], [posSales], [services], [activeServices], [invoices]] = await Promise.all([
    db.select({ email: schema.stores.email }).from(schema.stores).where(eq(schema.stores.projectId, pid)),
    db.select({ n: count() }).from(schema.storeProducts).where(eq(schema.storeProducts.projectId, pid)),
    db.select({ n: count() }).from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, pid), eq(schema.storeProducts.isSample, false), eq(schema.storeProducts.status, "active"))),
    db.select({ n: count() }).from(schema.storeProducts).where(and(eq(schema.storeProducts.projectId, pid), eq(schema.storeProducts.isSample, true))),
    db.select({ n: count() }).from(schema.storePaymentProviders).where(and(eq(schema.storePaymentProviders.projectId, pid), eq(schema.storePaymentProviders.enabled, true))),
    db.select({ n: count() }).from(schema.storeShippingRates).where(eq(schema.storeShippingRates.projectId, pid)),
    db.select({ n: count() }).from(schema.siteDomains).where(eq(schema.siteDomains.projectId, pid)),
    db.select({ n: count() }).from(schema.siteDomains).where(and(eq(schema.siteDomains.projectId, pid), eq(schema.siteDomains.status, "verified"))),
    // Edits the owner made to the design after it was created.
    db.select({ n: count() }).from(schema.fileRevisions).where(and(eq(schema.fileRevisions.projectId, pid), eq(schema.fileRevisions.path, SITE_DOC_PATH), eq(schema.fileRevisions.source, "user"), sql`${schema.fileRevisions.revision} > 2`)),
    db.select({ n: count() }).from(schema.storeOrders).where(and(eq(schema.storeOrders.projectId, pid), eq(schema.storeOrders.channel, "pos"))),
    db.select({ n: count() }).from(schema.bookingServices).where(eq(schema.bookingServices.projectId, pid)),
    db.select({ n: count() }).from(schema.bookingServices).where(and(eq(schema.bookingServices.projectId, pid), eq(schema.bookingServices.active, true))),
    db.select({ n: count() }).from(schema.invoiceDocuments).where(and(eq(schema.invoiceDocuments.projectId, pid), sql`${schema.invoiceDocuments.status} not in ('draft','void')`)),
  ]);
  // A store record alone doesn't make a shop: a clinic taking bookings has one too.
  const isStore = !!store && (project.kind === "store" || anyProducts.n > 0);
  const base = `/projects/${pid}`;
  const items: SetupItem[] = [];
  items.push({ id: "publish", title: "Publish your site", detail: "Put it online so anyone can visit", done: !!project.productionDeploymentId, href: `${base}/deployments`, minutes: 1 });
  items.push({ id: "design", title: "Make the design yours", detail: "Edit any text, photo or colour in the builder", done: edits.n > 0, href: `${base}/builder`, minutes: 5 });
  if (isStore) {
    items.push({ id: "products", title: "Add your products", detail: samples.n ? `${samples.n} sample product${samples.n === 1 ? "" : "s"} still to replace` : "Import a spreadsheet or add them one by one", done: products.n > 0 && samples.n === 0, href: `${base}/store/products`, minutes: 3 });
    items.push({ id: "payments", title: "Turn on payments", detail: "Cash on delivery, UPI, or cards through Razorpay, Stripe or PayPal", done: payments.n > 0, href: `${base}/store/payments`, minutes: 2 });
    items.push({ id: "shipping", title: "Set delivery rates", detail: "Where you deliver and what it costs", done: rates.n > 0, href: `${base}/store/shipping`, minutes: 2 });
    items.push({ id: "contact", title: "Add a contact email", detail: "For order alerts and customer replies", done: !!store.email, href: `${base}/store/settings`, minutes: 1 });
  }
  if (isStore && goals.includes("pos")) items.push({ id: "pos", title: "Make your first sale at the counter", detail: "Print labels, then scan them at the till", done: posSales.n > 0, href: `${base}/pos`, minutes: 3 });
  if (goals.includes("bookings") || services.n > 0) items.push({ id: "bookings", title: "Set up bookings", detail: "Set prices and opening hours for your services", done: activeServices.n > 0, href: `${base}/store/bookings`, minutes: 3 });
  if (goals.includes("invoicing") || invoices.n > 0) items.push({ id: "invoicing", title: "Send your first invoice or quotation", detail: "Pick a design or upload your own format, then share by link, email or WhatsApp", done: invoices.n > 0, href: `${base}/invoicing`, minutes: 3 });
  items.push({ id: "domain", title: "Connect your domain", detail: domains.n && !verified.n ? "Waiting for your DNS records" : "Use your own address, like yourbrand.com", done: verified.n > 0, href: `${base}/deployments`, minutes: 5 });
  const done = items.filter((i) => i.done).length;
  return { kind: isStore ? ("store" as const) : ("website" as const), items, done, total: items.length };
}
