import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Paying suppliers: a contractor with a PAN gets 1% TDS suggested on a bill,
// a debit note takes some off, a payment run is approved and paid with a bank
// file, and the TDS is deposited.
test("TDS on a bill, a debit note, a payment run and the TDS deposit", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.21" });
  await signUp(page, "Tara Payables", "tara.payables@example.com");

  // A contractor with PAN, TDS section and bank details.
  await page.goto("/inventory/suppliers");
  await page.getByRole("button", { name: "New supplier" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Sharma Contractors");
  await dlg.getByLabel("PAN").fill("AAAPS1234C");
  await dlg.getByLabel("TDS section").selectOption({ label: "Contractors (194C)" });
  await dlg.getByLabel("Bank account no.").fill("50100123456789");
  await dlg.getByLabel("IFSC").fill("HDFC0001234");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Sharma Contractors")).toBeVisible();

  // A ₹50,000 bill: over the single-bill limit, so 1% TDS is suggested.
  await page.goto("/accounts/bills");
  await page.getByRole("button", { name: "New bill" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Supplier").fill("Sharma Contractors");
  await dlg.getByLabel("Account 1").selectOption({ label: "5290 · Repairs and maintenance" });
  await dlg.getByLabel("Amount 1").fill("50000");
  await expect(dlg.getByLabel("TDS section")).toHaveValue("194C");
  await expect(dlg.getByLabel("TDS to deduct (₹)")).toHaveValue("500");
  await expect(dlg.getByText(/^₹58,500(\.00)?$/)).toBeVisible();
  await dlg.getByRole("button", { name: "Save bill" }).click();
  await expect(page.getByText("TDS 194C at 1%")).toBeVisible();

  // A debit note for ₹10,000 + GST comes off what's owed.
  await page.getByRole("button", { name: "Debit note" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Amount 1").fill("10000");
  await dlg.getByRole("button", { name: "Save debit note" }).click();
  await expect(page.getByRole("heading", { name: "Debit note · Sharma Contractors" })).toBeVisible();
  await page.getByRole("link", { name: "that bill" }).click();
  await expect(page.getByText("Debit notes", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: /^₹46,700(\.00)?$/ })).toBeVisible();

  // A payment run: no approval rule, so it's approved straight away.
  await page.goto("/accounts/payments");
  await page.getByRole("button", { name: "New run" }).first().click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("checkbox", { name: /Pay BL-/ }).check();
  await expect(dlg.getByText(/1 bill · ₹46,700(\.00)?/)).toBeVisible();
  await dlg.getByRole("button", { name: "Save run" }).click();
  await expect(page.getByRole("heading", { name: "PR-0001" })).toBeVisible();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Bank file" })).toBeVisible();
  await page.getByRole("button", { name: "Mark paid" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Mark paid" }).click();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  // The TDS shows as owed for the quarter, and is deposited.
  await page.goto("/accounts/tds");
  await expect(page.getByRole("row", { name: /Contractors \(194C\) ₹500(\.00)? ₹0(\.00)? ₹500/ })).toBeVisible();
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Challan no.").fill("00123");
  await dlg.getByRole("button", { name: "Record deposit" }).click();
  await expect(page.getByRole("row", { name: /Contractors \(194C\) ₹500(\.00)? ₹500(\.00)? ₹0/ })).toBeVisible();
  await expect(page.getByText(/challan 00123/)).toBeVisible();
});
