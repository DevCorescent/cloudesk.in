import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A bin is set up and stock put away; a confirmed sales order is picked in a
// wave by scanning barcodes, and dispatched as a delivery challan.
test("bins, putaway, and a wave picked by scanning and dispatched", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.25" });
  await signUp(page, "Wasim Floor", "wasim.floor@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const post = async (url: string, data: unknown) => (await page.request.post(url, { data, headers })).json();
  const inv = (p: string) => `/api/v1/orgs/${orgId}/inventory/${p}`;
  await page.request.get(inv("meta"));
  const { warehouses } = await (await page.request.get(inv("warehouses"))).json();
  const { item } = await post(inv("items"), { name: "Steel shelf", sku: "SH-1", barcode: "8901234567890", unit: "pcs", gstRate: 18 });
  await post(inv("receipts"), { warehouseId: warehouses[0].id, date: "2026-10-07", lines: [{ itemId: item.id, qty: 10, rate: 10000, gstRate: 18 }] });
  const { book } = await post("/api/v1/finance/books", { orgId, name: "Main" });
  const { client } = await post(`/api/v1/finance/books/${book.id}/clients`, { name: "Meera", company: "Lumen Labs", billing: { line1: "", line2: "", city: "", state: "Karnataka", postalCode: "", country: "IN" }, notes: "" });
  await page.request.get(`/api/v1/orgs/${orgId}/sales/meta`);
  const { order } = await post(`/api/v1/orgs/${orgId}/sales/orders`, { ownerId: book.id, clientId: client.id, date: "2026-10-07", lines: [{ id: "a", itemId: item.id, name: "Steel shelf", qty: 3, rate: 15000, taxBps: 1800 }] });
  await post(`/api/v1/orgs/${orgId}/sales/orders/${order.id}/confirm`, {});

  // A bin, and the shelves put away into it.
  await page.goto("/inventory/bins");
  await page.getByRole("button", { name: "Bin", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Code").fill("a-01");
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText("A-01")).toBeVisible();
  await page.getByRole("button", { name: "Put away" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("To").selectOption({ label: "A-01" });
  await dlg.getByRole("button", { name: "Move" }).click();
  await expect(page.getByText("Not put away")).toBeHidden();

  // A wave for the order, picked by scanning three times.
  await page.goto("/inventory/waves");
  await page.getByRole("button", { name: "Wave", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("checkbox", { name: /Pick SO-0001/ }).check();
  await dlg.getByRole("button", { name: "Start picking" }).click();
  await expect(page.getByRole("heading", { name: "WV-0001" })).toBeVisible();
  await expect(page.getByLabel("Bin for Steel shelf")).toHaveValue(/.+/);
  for (let i = 0; i < 3; i++) {
    await page.getByLabel("Scan").fill("8901234567890");
    await page.getByLabel("Scan").press("Enter");
    await expect(page.getByLabel("Picked of Steel shelf")).toHaveValue(String(i + 1));
  }
  await page.getByRole("button", { name: "Dispatch" }).click();
  await expect(page.getByText(/Dispatched — DC-0001/)).toBeVisible();
  const stock = await (await page.request.get(inv(`items/${item.id}`))).json();
  expect(stock.onHand).toBe(7);
  expect(stock.reserved).toBe(0);
});
