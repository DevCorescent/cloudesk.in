import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Accounting: record an expense, see it in the books and reports, write a
// journal, and import a bank statement that partly matches.
test("expenses, journals, reports and bank reconciliation", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.15" });
  await signUp(page, "Anita Books", "anita.accounts@example.com");

  await page.goto("/accounts");
  await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();

  // An expense paid from the bank: ₹1,000 + 18% GST.
  await page.getByRole("button", { name: "Record an expense" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Paid to").fill("Jio Fiber");
  await dlg.getByLabel("Account 1").selectOption({ label: "5220 · Internet and phone" });
  await dlg.getByLabel("Amount 1").fill("1000");
  await expect(dlg.getByText(/^₹1,180(\.00)?$/)).toBeVisible();
  await dlg.getByRole("button", { name: "Record expense" }).click();
  await expect(page.getByRole("heading", { name: "Jio Fiber" })).toBeVisible();
  await expect(page.getByText("Paid", { exact: true }).first()).toBeVisible();

  // Owner's capital by journal.
  await page.goto("/accounts/journals");
  await page.getByRole("button", { name: "New journal" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Narration").fill("Owner brought in capital");
  await dlg.getByLabel("Account 1").selectOption({ label: "1010 · Bank account" });
  await dlg.getByLabel("Debit 1").fill("50000");
  await dlg.getByLabel("Account 2").selectOption({ label: "3000 · Owner's capital" });
  await dlg.getByLabel("Credit 2").fill("50000");
  await dlg.getByRole("button", { name: "Save journal" }).click();
  await expect(page.getByText("Owner brought in capital")).toBeVisible();

  // Reports: the expense is a cost; the balance sheet balances.
  await page.goto("/accounts/reports/profit-loss");
  await expect(page.getByText("Internet and phone")).toBeVisible();
  await page.getByRole("tab", { name: "Balance sheet" }).click();
  await expect(page.getByText("Liabilities + equity")).toBeVisible();
  await expect(page.getByText("Doesn't balance")).toHaveCount(0);

  // A statement: one line matches the expense, one is a bank charge to post.
  await page.goto("/accounts/bank");
  await page.getByRole("button", { name: "Reconcile" }).first().click();
  await page.getByRole("button", { name: "Import a statement" }).click();
  dlg = page.getByRole("dialog");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10).split("-").reverse().join("/");
  await dlg.getByLabel("Or paste rows").fill(`Date,Narration,Ref,Debit,Credit\n${today},JIO FIBER AUTOPAY,,1180.00,\n${today},OWNER TRANSFER,,,50000.00\n${today},SMS CHARGES,,17.70,`);
  await dlg.getByRole("button", { name: "Use pasted rows" }).click();
  await dlg.getByRole("button", { name: "Check 3 rows" }).click();
  await dlg.getByRole("button", { name: /^Import 3 / }).click();
  await dlg.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("SMS CHARGES")).toBeVisible();
  await expect(page.getByText("JIO FIBER AUTOPAY")).toHaveCount(0);
  await page.getByRole("button", { name: "Post it" }).click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("What it was for")).toHaveValue(/.+/);
  await dlg.getByRole("button", { name: "Post" }).click();
  await expect(page.getByText("Nothing to match")).toBeVisible();

  // GST returns open for the month.
  await page.goto("/accounts/gst/gstr3b");
  await expect(page.getByText("4 Input credit available")).toBeVisible();
});
