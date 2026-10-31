import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";
import * as XLSX from "xlsx";

// Onboarding: pick modules and the parts of them you want; everything picked is
// set up. Then the smart importer: an Excel file with a title row, odd
// headings, a misspelt state and a missing name, fixed before importing.
test("pick modules in onboarding, then import an Excel sheet with fixes", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.16" });
  await signUp(page, "Leela Shah", "leela.import@example.com");

  await page.getByRole("button", { name: "Let's begin" }).click();
  await page.getByPlaceholder("Saffron House").fill("Leela Home");
  await page.getByRole("radio", { name: /Fashion & retail/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "See my plan" }).click();
  // Inventory and accounting come recommended for retail, each with its reason.
  await expect(page.getByRole("switch", { name: "Inventory & purchasing" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You keep stock and buy from suppliers")).toBeVisible();
  // Accounting needs invoicing: switching invoicing off takes accounting with it.
  await page.getByRole("switch", { name: "Invoices & finance" }).click();
  await expect(page.getByRole("switch", { name: "Accounting & GST" })).toHaveAttribute("aria-checked", "false");
  // …and switching accounting on brings invoicing back.
  await page.getByRole("switch", { name: "Accounting & GST" }).click();
  await expect(page.getByRole("switch", { name: "Invoices & finance" })).toHaveAttribute("aria-checked", "true");
  // Leave payroll out of HR.
  await page.getByRole("button", { name: /12 of 12 parts on/ }).click();
  await page.getByRole("group", { name: "Parts of HR & payroll" }).getByRole("button", { name: "Payroll" }).click();
  await page.getByRole("button", { name: /Set up my workspace/ }).click();
  await expect(page.getByText("Inventory — your first store room, ready for stock")).toBeVisible();
  await expect(page.getByText("Your workspace is ready")).toBeVisible({ timeout: 30_000 });

  await page.goto("/settings/features");
  await expect(page.getByRole("switch", { name: "HR & payroll: Payroll off" })).toBeVisible();

  // An Excel file of suppliers, as people really keep them.
  const ws = XLSX.utils.aoa_to_sheet([["Our vendors — updated Oct 2026"], [], ["Vendor Name", "GST No", "State", "Mobile", "Credit Period"], ["Sharma Packaging", "27AAJFS2290K1ZQ", "Maharastra", "98201 33410", "15 days"], ["", "", "Karnataka", "9900177821", "45"]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Vendors");
  const buffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;

  await page.goto("/inventory/suppliers");
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "vendors.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
  await expect(page.getByText("headings found on row 3")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Column for GSTIN" }).locator("option:checked")).toHaveText("GST No");
  await page.getByRole("button", { name: "Check 2 rows" }).click();
  // The misspelt state has a one-click fix; the blank name can be typed in.
  await expect(page.getByText("“Maharastra” isn't a state we know")).toBeVisible();
  await page.getByRole("button", { name: "Maharashtra (MH)" }).click();
  await expect(page.getByText("Name is needed")).toBeVisible();
  await page.getByRole("textbox", { name: "Name, row 5" }).fill("Bengaluru Glaze Supplies");
  await page.getByRole("textbox", { name: "Name, row 5" }).blur();
  await page.getByRole("button", { name: "Import 2 suppliers" }).click();
  await expect(page.getByText("added")).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Bengaluru Glaze Supplies")).toBeVisible();
  await expect(page.getByText(/GSTIN 27AAJFS2290K1ZQ · MH/)).toBeVisible();
});
