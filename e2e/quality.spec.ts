import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A plan for incoming bolts, a receipt that queues an inspection, a failed
// sample that holds the lot in quarantine, and the report closed with the
// goods released.
test("inspection plan, failed lot in quarantine, and the report closed", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.27" });
  await signUp(page, "Kiran Quality", "kiran.qc@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const inv = (p: string) => `/api/v1/orgs/${orgId}/inventory/${p}`;
  const post = async (url: string, data: unknown) => (await page.request.post(url, { data, headers })).json();
  await page.request.get(inv("meta"));
  const { warehouses } = await (await page.request.get(inv("warehouses"))).json();
  const { item } = await post(inv("items"), { name: "Hex bolt M8", sku: "M8", unit: "pcs", category: "Fasteners", gstRate: 18 });
  await post(inv("bins"), { warehouseId: warehouses[0].id, code: "Q-01", kind: "quarantine" });

  await page.goto("/quality/plans");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Incoming bolts");
  await dlg.getByLabel("Item").selectOption({ label: "Hex bolt M8" });
  await dlg.getByLabel("Samples").fill("2");
  await dlg.getByRole("button", { name: "+ Add a check" }).click();
  await dlg.getByLabel("Check 1", { exact: true }).fill("Thread");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Incoming bolts")).toBeVisible();

  await post(inv("receipts"), { warehouseId: warehouses[0].id, date: "2026-10-09", lines: [{ itemId: item.id, qty: 40, rate: 500, gstRate: 18 }] });
  await page.goto("/quality/inspections");
  await page.getByText("QC-0001").click();
  await page.getByRole("switch", { name: "Thread, sample 2" }).click();
  await page.getByRole("button", { name: "Record results" }).click();
  await expect(page.getByText("1 sample failed")).toBeVisible();
  await page.getByRole("link", { name: "Open the report" }).click();
  await expect(page.getByRole("heading", { name: /NCR-0001/ })).toBeVisible();
  await expect(page.getByText("40 held in quarantine", { exact: true })).toBeVisible();
  await page.getByLabel("Root cause").fill("Burr on two threads, cosmetic");
  await page.getByLabel("Disposition").selectOption({ label: "Use as is" });
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page.getByText(/Closed — Released to stock/)).toBeVisible();
  const a = (await (await page.request.get(inv("availability"))).json()).items.find((x: { itemId: string }) => x.itemId === item.id);
  expect(a).toMatchObject({ onHand: 40, quarantined: 0, available: 40 });
});
