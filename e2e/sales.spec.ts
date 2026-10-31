import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A standard price set on the price list, an order whose price fills in by
// itself, confirmed, delivered on a challan (stock goes out) and invoiced.
test("price list, sales order, delivery challan and invoice", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.23" });
  await signUp(page, "Vani Sales", "vani.sales@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const post = async (url: string, data: unknown) => (await page.request.post(url, { data, headers })).json();
  const { book } = await post("/api/v1/finance/books", { orgId, name: "Main" });
  await post(`/api/v1/finance/books/${book.id}/clients`, { name: "Meera", company: "Lumen Labs", billing: { line1: "4 Residency Road", line2: "", city: "Bengaluru", state: "Karnataka", postalCode: "560025", country: "IN" }, notes: "" });
  await page.request.get(`/api/v1/orgs/${orgId}/inventory/meta`);
  const { warehouses } = await (await page.request.get(`/api/v1/orgs/${orgId}/inventory/warehouses`)).json();
  const { item } = await post(`/api/v1/orgs/${orgId}/inventory/items`, { name: "Steel shelf", sku: "SH-1", unit: "pcs", gstRate: 18, hsn: "94032090" });
  await post(`/api/v1/orgs/${orgId}/inventory/adjust`, { itemId: item.id, warehouseId: warehouses[0].id, qty: 20, reason: "opening" });

  // The standard price.
  await page.goto("/sales/price-lists");
  await page.getByRole("button", { name: /Standard prices/ }).click();
  await page.getByLabel("Item", { exact: true }).selectOption({ label: "Steel shelf · SH-1" });
  await page.getByLabel("Price (₹)").fill("12500");
  await page.getByRole("button", { name: "Set price" }).click();
  await expect(page.getByRole("row", { name: /Steel shelf/ })).toContainText("₹12,500");

  // An order: the price fills in.
  await page.goto("/sales/orders/new");
  await page.getByLabel("Customer", { exact: true }).selectOption({ label: "Lumen Labs" });
  await page.getByLabel("Item 1").selectOption({ label: "Steel shelf · SH-1" });
  await expect(page.getByLabel("Rate 1")).toHaveValue("12500");
  await page.getByLabel("Quantity 1").fill("4");
  await expect(page.getByText(/₹59,000/)).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByRole("heading", { name: "SO-0001 · Lumen Labs" })).toBeVisible();
  await page.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect(page.getByText("Confirmed", { exact: true }).first()).toBeVisible();

  // Delivered on a challan, then invoiced.
  await page.getByRole("button", { name: "Deliver" }).click();
  await page.getByRole("dialog").getByLabel("Vehicle no.").fill("ka01ab1234");
  await page.getByRole("dialog").getByRole("button", { name: "Make challan" }).click();
  await expect(page.getByText("DC-0001")).toBeVisible();
  await expect(page.getByText("Delivered", { exact: true }).first()).toBeVisible();
  const stock = await (await page.request.get(`/api/v1/orgs/${orgId}/inventory/items/${item.id}`)).json();
  expect(stock.onHand).toBe(16);
  await page.getByRole("button", { name: "Invoice", exact: true }).click();
  await page.waitForURL(/\/finance\/.+\/invoices\//);
  await expect(page.getByText("Lumen Labs").first()).toBeVisible();
});
