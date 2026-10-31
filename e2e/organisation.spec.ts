import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Organisation: a second company with a branch and a cost centre, set up in
// Settings; an expense charged to them; reports cut by company and cost
// centre; a month closed against further entries.
test("companies, branches and cost centres flow into the books", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.19" });
  await signUp(page, "Tara Group", "tara.org@example.com");

  await page.goto("/settings/organisation");
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  // A second company.
  await page.getByRole("button", { name: "Company", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("Tara Retail");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Tara Retail" })).toBeVisible();
  // A branch under it.
  await page.getByRole("tab", { name: /Branches/ }).click();
  await page.getByRole("button", { name: "Branch", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name", { exact: true }).fill("Pune store");
  await dlg.getByLabel("Company").selectOption({ label: "Tara Retail" });
  await dlg.getByLabel("Type").selectOption({ label: "Store / outlet" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Pune store" })).toBeVisible();
  // A cost centre.
  await page.getByRole("tab", { name: /Cost centres/ }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Code").fill("MKT");
  await dlg.getByLabel("Name", { exact: true }).fill("Marketing");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Marketing" })).toBeVisible();

  // An expense for the Pune store, charged to Marketing.
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Record an expense" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Paid to").fill("Flyer printers");
  await dlg.getByLabel("Branch").selectOption({ label: "Pune store" });
  await expect(dlg.getByLabel("Company")).toHaveValue(/.+/);
  await dlg.getByLabel("Account 1").selectOption({ label: "5200 · Rent" });
  await dlg.getByLabel("Amount 1").fill("2500");
  await dlg.getByLabel("GST 1").selectOption("0");
  await dlg.getByLabel("Cost centre 1").selectOption({ label: "MKT" });
  await dlg.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByRole("heading", { name: "Flyer printers" })).toBeVisible();

  // Reports, cut by company and cost centre.
  await page.goto("/accounts/reports/profit-loss");
  const filters = page.getByRole("group", { name: "Which part of the books" });
  await filters.getByLabel("Cost centre").selectOption({ label: "MKT · Marketing" });
  await expect(page.getByText("2,500").first()).toBeVisible();
  await filters.getByLabel("Company").selectOption({ label: "Tara's workspace" });
  await expect(page.getByText("2,500")).toHaveCount(0);
  await filters.getByLabel("Company").selectOption({ label: "Tara Retail" });
  await expect(page.getByText("2,500").first()).toBeVisible();

  // Close this month for Tara Retail: no more entries dated in it.
  await page.goto("/accounts/settings");
  const month = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);
  await page.getByLabel("Month").fill(month);
  await page.getByLabel("For").selectOption({ label: "Tara Retail" });
  await page.getByRole("button", { name: "Close month" }).click();
  await expect(page.getByText(`${month} closed`)).toBeVisible();
  await page.goto("/accounts");
  await page.getByRole("button", { name: "Record an expense" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Paid to").fill("Late printers");
  await dlg.getByLabel("Company").selectOption({ label: "Tara Retail" });
  await dlg.getByLabel("Account 1").selectOption({ label: "5200 · Rent" });
  await dlg.getByLabel("Amount 1").fill("100");
  await dlg.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByText(/which is closed/)).toBeVisible();
});
