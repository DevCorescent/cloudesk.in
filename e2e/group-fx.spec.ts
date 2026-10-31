import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A bill from abroad in dollars, paid with the rupees the bank took (the
// difference is an exchange loss); a second company funded through an
// intercompany entry; the consolidated view shows the balances matching.
test("foreign bills, intercompany entries and consolidation", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.22" });
  await signUp(page, "Uma Group", "uma.group@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const org = (path: string, data: unknown) => page.request.post(`/api/v1/orgs/${orgId}/org/${path}`, { data, headers });
  expect((await org("currencies", { code: "USD", name: "US dollar", symbol: "$" })).ok()).toBe(true);
  expect((await org("rates", { currency: "USD", date: "2026-01-01", rate: 84 })).ok()).toBe(true);
  expect((await org("companies", { name: "Sharma Exports Pvt Ltd" })).ok()).toBe(true);

  // $100 of cloud hosting at ₹84.
  await page.goto("/accounts/bills");
  await page.getByRole("button", { name: "New bill" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Supplier").fill("Amazon Web Services");
  await dlg.getByLabel("Currency").selectOption("USD");
  await dlg.getByLabel("Rate (₹ per USD)").fill("84");
  await dlg.getByLabel("Account 1").selectOption({ label: "5240 · Software and subscriptions" });
  await dlg.getByLabel("GST 1").selectOption("0");
  await dlg.getByLabel("Amount 1").fill("100");
  await expect(dlg.getByText(/≈ ₹8,400/)).toBeVisible();
  await dlg.getByRole("button", { name: "Save bill" }).click();
  await expect(page.getByText(/\$100\.00 at ₹84/)).toBeVisible();

  // The bank took ₹8,520 for it.
  await page.getByRole("button", { name: "Pay" }).click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Paid (USD)")).toHaveValue("100");
  await dlg.getByLabel("Rupees debited (₹)").fill("8520");
  await expect(dlg.getByText(/₹120(\.00)? exchange loss/)).toBeVisible();
  await dlg.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  // ₹50,000 of working capital to the other company.
  await page.goto("/accounts/group");
  await page.getByRole("button", { name: "Intercompany entry" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("To company", { exact: true }).selectOption({ label: "Sharma Exports Pvt Ltd" });
  await dlg.getByLabel("Amount (₹)").fill("50000");
  await dlg.getByLabel("Narration").fill("Working capital");
  await dlg.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("IC-0001", { exact: false })).toBeVisible();

  await page.getByRole("tab", { name: "Consolidated" }).click();
  await expect(page.getByText("Matches")).toBeVisible();
  await expect(page.getByRole("row", { name: /1350 · Due from group companies/ })).toContainText("₹50,000");

  // E-invoices: nothing to businesses yet.
  await page.goto("/accounts/gst/einvoice");
  await expect(page.getByText(/No invoices to businesses with a GSTIN/)).toBeVisible();
});
