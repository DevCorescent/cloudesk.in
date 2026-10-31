import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Two suppliers quote on an RFQ; the cheaper one is picked and ordered; the
// goods arrive with some rejected at inspection, which stay out of stock.
test("RFQ, quote comparison, award, and receiving with rejections", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.24" });
  await signUp(page, "Pooja Procure", "pooja.procure@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const post = async (path: string, data: unknown) => (await page.request.post(`/api/v1/orgs/${orgId}/inventory/${path}`, { data, headers })).json();
  await page.request.get(`/api/v1/orgs/${orgId}/inventory/meta`);
  await post("suppliers", { name: "Apex Packaging" });
  await post("suppliers", { name: "Bharat Boxes" });
  const { item } = await post("items", { name: "Carton 12x12", sku: "CTN-12", unit: "pcs", category: "Packaging", gstRate: 18 });

  await page.goto("/inventory/rfqs");
  await page.getByRole("button", { name: "RFQ", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title").fill("Cartons");
  await dlg.getByLabel("Add an item").selectOption({ label: "Carton 12x12" });
  await dlg.getByLabel("Quantity of Carton 12x12").fill("1000");
  await dlg.getByRole("button", { name: "Apex Packaging" }).click();
  await dlg.getByRole("button", { name: "Bharat Boxes" }).click();
  await dlg.getByRole("button", { name: "Make RFQ" }).click();
  await expect(page.getByRole("heading", { name: "RFQ-0001 · Cartons" })).toBeVisible();

  for (const [supplier, rate] of [["Apex Packaging", "24"], ["Bharat Boxes", "23"]] as const) {
    await page.getByRole("button", { name: `Quote from ${supplier}` }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Rate for Carton 12x12").fill(rate);
    await dlg.getByRole("button", { name: "Save quote" }).click();
    await expect(dlg).toBeHidden();
  }
  await expect(page.getByRole("radio", { name: "Award Carton 12x12 to Bharat Boxes" })).toBeChecked();
  await expect(page.getByText(/best saves ₹1,000/)).toBeVisible();
  await page.getByRole("button", { name: "Award and order" }).click();
  await page.waitForURL(/\/inventory\/orders$/);
  await page.getByText("PO-0001").first().click();
  await expect(page.getByText(/Bharat Boxes/).first()).toBeVisible();

  // 1000 arrive, 40 are crushed.
  await page.getByRole("button", { name: "Receive goods" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Rejected of Carton 12x12").fill("40");
  await dlg.getByLabel("Why Carton 12x12 was rejected").fill("Crushed");
  await dlg.getByRole("button", { name: "Receive", exact: true }).click();
  await expect(dlg).toBeHidden();
  const stock = await (await page.request.get(`/api/v1/orgs/${orgId}/inventory/items/${item.id}`)).json();
  expect(stock.onHand).toBe(960);
});
