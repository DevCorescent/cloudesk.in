import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";
import { config } from "dotenv";
import { Pool } from "pg";

// A customer signs in with the emailed link and sees what they owe and raises
// a request; a supplier signs in, acknowledges an order and sends an invoice,
// which the team books as a bill from the portal's list.
config({ path: ".env.local", quiet: true });
const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(() => pool.end());
async function linkFor(email: string) {
  for (let i = 0; i < 20; i++) {
    const r = await pool.query("select body from outbound_emails where \"to\" = $1 and subject like 'Your sign-in link%' order by created_at desc limit 1", [email]);
    if (r.rows[0]) return new URL(/https?:\/\/\S+/.exec(r.rows[0].body)![0]);
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error("No link");
}

test("customers and suppliers sign in by email and use their portal", async ({ page, browser }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.38" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Parul Portal", "parul.portal@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const book = (await (await page.request.post("/api/v1/finance/books", { data: { orgId, name: "Main" }, headers })).json()).book.id;
  const billing = { line1: "", line2: "", city: "", state: "Maharashtra", postalCode: "", country: "IN" };
  const client = (await (await page.request.post(`/api/v1/finance/books/${book}/clients`, { data: { name: "Kavya", company: "Kavya Foods", email: "kavya@foods.example", billing, notes: "" }, headers })).json()).client.id;
  await page.request.post(`/api/v1/finance/books/${book}/documents`, { data: { document: { type: "invoice", clientId: client, client: { name: "Kavya", company: "Kavya Foods", billing }, issueDate: "2026-10-01", dueDate: "2026-10-15", currency: "INR", taxMode: "none", lines: [{ id: "a", name: "Catering", quantity: 1, rate: 4500000, taxBps: 0 }] }, issue: true }, headers });
  const inv = (p: string) => `/api/v1/orgs/${orgId}/inventory/${p}`;
  await page.request.get(inv("meta"));
  const wh = (await (await page.request.get(inv("warehouses"))).json()).warehouses[0].id;
  const sup = (await (await page.request.post(inv("suppliers"), { data: { name: "Sunrise Packaging", email: "orders@sunrise.example", state: "MH" }, headers })).json()).supplier.id;
  const item = (await (await page.request.post(inv("items"), { data: { name: "Food box", sku: "FB-1", unit: "pcs", gstRate: 18 }, headers })).json()).item.id;
  const po = (await (await page.request.post(inv("orders"), { data: { supplierId: sup, warehouseId: wh, orderDate: "2026-10-20", lines: [{ itemId: item, qty: 500, rate: 1200, gstRate: 18 }] }, headers })).json()).order;
  await page.request.post(inv(`orders/${po.id}/send`), { data: { email: true }, headers });

  await page.goto("/portals");
  const customerUrl = new URL(await page.getByLabel("customers portal address").inputValue());

  // The customer.
  const cust = await browser.newPage();
  await cust.goto(customerUrl.pathname + customerUrl.search);
  await cust.getByLabel("Email").fill("kavya@foods.example");
  await cust.getByRole("button", { name: "Email me a link" }).click();
  await expect(cust.getByText("Check your email")).toBeVisible();
  const link = await linkFor("kavya@foods.example");
  await cust.goto(link.pathname + link.search);
  await expect(cust.getByText("₹45,000").first()).toBeVisible();
  await expect(cust.getByText("overdue").first()).toBeVisible();
  await cust.getByRole("tab", { name: "Support" }).click();
  await cust.getByLabel("Subject").fill("Need a GST invoice");
  await cust.getByLabel("Details").fill("Please add our GSTIN to the October invoice.");
  await cust.getByRole("button", { name: "Send request" }).click();
  await expect(cust.getByText("Request Need a GST invoice sent")).toBeVisible();
  await expect(cust.getByRole("link", { name: /HD-0001 · Need a GST invoice/ })).toBeVisible();
  await cust.close();
  // The link worked once: elsewhere it's refused.
  const again = await browser.newPage();
  await again.goto(link.pathname + link.search);
  await expect(again.getByText(/expired or was already used/)).toBeVisible();
  await again.close();

  // The supplier.
  const supp = await browser.newPage();
  await supp.goto(customerUrl.pathname + "?kind=supplier");
  await supp.getByLabel("Email").fill("orders@sunrise.example");
  await supp.getByRole("button", { name: "Email me a link" }).click();
  const slink = await linkFor("orders@sunrise.example");
  await supp.goto(slink.pathname + slink.search);
  await expect(supp.getByText("Signed in for")).toBeVisible();
  await supp.getByRole("tab", { name: "Purchase orders" }).click();
  await supp.getByLabel("We'll deliver by").fill("2026-10-30");
  await supp.getByRole("button", { name: "Acknowledge" }).click();
  await expect(supp.getByText("Acknowledged", { exact: true })).toBeVisible();
  await supp.getByRole("tab", { name: "Invoices & payments" }).click();
  await supp.getByLabel("Invoice number").fill("SP-2041");
  await supp.getByLabel("Total with GST (₹)").fill("7080");
  await supp.getByLabel("Against purchase order").selectOption({ label: po.number });
  await supp.locator("input[type=file]").setInputFiles({ name: "SP-2041.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") });
  await supp.getByRole("button", { name: "Send invoice" }).click();
  await expect(supp.getByText("Invoice SP-2041 sent.")).toBeVisible();
  await supp.close();

  // The team sees the acknowledgement and books the invoice.
  await page.goto(`/inventory/orders/${po.id}`);
  await expect(page.getByText(/promises delivery by/)).toBeVisible();
  await page.goto("/portals/invoices");
  await expect(page.getByText(/Sunrise Packaging · SP-2041 · ₹7,080/)).toBeVisible();
  await page.getByRole("link", { name: "Book as a bill" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText("The supplier gave only a total")).toBeVisible();
  await expect(dlg.getByLabel("Their bill / invoice no.")).toHaveValue("SP-2041");
});
