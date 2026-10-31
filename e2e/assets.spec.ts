import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Fixed assets and spread journals: a laptop bought on a bill is added to the
// register and its completed months of depreciation are posted; a year's
// insurance is spread over twelve months; the cash flow statement adds up.
test("fixed assets, spreads and the cash flow statement", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.20" });
  await signUp(page, "Ira Assets", "ira.assets@example.com");

  await page.goto("/accounts/assets");
  await expect(page.getByText("No fixed assets yet")).toBeVisible();
  await page.getByRole("button", { name: "Asset", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("MacBook Pro 14");
  await dlg.getByLabel("Cost (₹)").fill("180000");
  await dlg.getByLabel("Bought on").fill("2026-04-05");
  await dlg.getByLabel("In use from").fill("2026-04-05");
  await dlg.getByLabel("Useful life (years)").fill("3");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "FA-0001 · MacBook Pro 14" })).toBeVisible();
  // April from the 5th (26 of 30 days), then ₹5,000 a month.
  await expect(page.getByRole("row", { name: /Apr 2026 ₹4,333\.33/ })).toBeVisible();
  await expect(page.getByText("Posted").first()).toBeVisible();

  // A year's insurance spread over twelve months.
  await page.goto("/accounts/schedules");
  await page.getByRole("button", { name: "Spread a payment" }).click();
  const s = page.getByRole("dialog");
  await s.getByLabel("Name").fill("Annual insurance");
  await s.getByLabel("Total (₹)").fill("36000");
  await s.getByLabel("First month").fill("2026-04-01");
  await s.getByLabel("Spread to").selectOption({ label: "5900 · Other expenses" });
  await expect(s.getByText(/₹3,000(\.00)? a month until Mar 2027/)).toBeVisible();
  await s.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Annual insurance")).toBeVisible();

  // The cash flow statement adds up (no warning about a difference).
  await page.goto("/accounts/reports/cash-flow");
  await expect(page.getByText("Cash from operations")).toBeVisible();
  await expect(page.getByText("Add back: Depreciation")).toBeVisible();
  await expect(page.getByText(/Off by/)).toHaveCount(0);
});
