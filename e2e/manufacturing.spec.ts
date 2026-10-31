import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A recipe written on screen, a work order released, materials issued and the
// output finished into stock at its cost.
test("recipe, work order, materials issued and output finished", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.26" });
  await signUp(page, "Meher Maker", "meher.maker@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const inv = (p: string) => `/api/v1/orgs/${orgId}/inventory/${p}`;
  const post = async (url: string, data: unknown) => (await page.request.post(url, { data, headers })).json();
  await page.request.get(inv("meta"));
  const { warehouses } = await (await page.request.get(inv("warehouses"))).json();
  const { item: stool } = await post(inv("items"), { name: "Stool", sku: "STL", unit: "pcs", gstRate: 18 });
  const { item: leg } = await post(inv("items"), { name: "Leg", sku: "LEG", unit: "pcs", gstRate: 18 });
  const { item: seat } = await post(inv("items"), { name: "Seat", sku: "SEAT", unit: "pcs", gstRate: 18 });
  await post(inv("receipts"), { warehouseId: warehouses[0].id, date: "2026-10-08", lines: [{ itemId: leg.id, qty: 40, rate: 5000, gstRate: 18 }, { itemId: seat.id, qty: 10, rate: 20000, gstRate: 18 }] });

  await page.goto("/manufacturing/boms/new");
  await page.getByLabel("Item", { exact: true }).selectOption({ label: "Stool" });
  await page.getByRole("button", { name: "+ Add a component" }).click();
  await page.getByLabel("Component 1", { exact: true }).selectOption({ label: "Leg" });
  await page.getByLabel("Quantity of component 1").fill("3");
  await page.getByRole("button", { name: "+ Add a component" }).click();
  await page.getByLabel("Component 2", { exact: true }).selectOption({ label: "Seat" });
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Stool").first()).toBeVisible();

  await page.goto("/manufacturing/work-orders");
  await page.getByRole("button", { name: "Work order", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Make").selectOption({ label: "Stool" });
  await dlg.getByLabel("Quantity").fill("4");
  await dlg.getByRole("button", { name: "Draft it" }).click();
  await expect(page.getByRole("heading", { name: "MO-0001 · 4 Stool" })).toBeVisible();
  await page.getByRole("button", { name: "Release" }).click();
  await page.getByRole("button", { name: "Issue all materials" }).click();
  await expect(page.getByText("In production").first()).toBeVisible();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finish" }).click();
  // 3 legs × ₹50 + 1 seat × ₹200 = ₹350 each.
  await expect(page.getByText(/at ₹350(\.00)? each/)).toBeVisible();
  const s = await (await page.request.get(inv(`items/${stool.id}`))).json();
  expect(s.onHand).toBe(4);
});
