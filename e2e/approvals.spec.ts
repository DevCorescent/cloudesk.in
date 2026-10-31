import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Approvals: an owner writes a rule in Settings, a journal waits for approval
// instead of going into the books, shows in My work and the bell, and is
// posted once approved. (In a one-person workspace the owner is the only
// possible approver, so they approve their own — with anyone else there, they couldn't.)
test("a rule holds a journal until it's approved from My work", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.18" });
  await signUp(page, "Rhea Owner", "rhea.approvals@example.com");

  // A rule: manual journals from ₹10,000 need the owner.
  await page.goto("/settings/approvals");
  await expect(page.getByText("No approval rules yet")).toBeVisible();
  await page.getByRole("button", { name: "New rule" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("What needs approval").selectOption({ label: "Manual journals" });
  await dlg.getByLabel("Name").first().fill("Journals over ₹10,000");
  await dlg.getByLabel("Journal total from (₹)").fill("10000");
  await dlg.getByRole("textbox", { name: "Name" }).nth(1).fill("Owner");
  await dlg.getByLabel("Role").selectOption("owner");
  await dlg.getByRole("button", { name: "Save rule" }).click();
  await expect(page.getByText("Journals over ₹10,000")).toBeVisible();

  // A journal over the limit waits.
  await page.goto("/accounts/journals");
  await page.getByRole("button", { name: "New journal" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Narration").fill("Owner brought in capital");
  await dlg.getByLabel("Account 1").selectOption({ label: "1010 · Bank account" });
  await dlg.getByLabel("Debit 1").fill("50000");
  await dlg.getByLabel("Account 2").selectOption({ label: "3000 · Owner's capital" });
  await dlg.getByLabel("Credit 2").fill("50000");
  await dlg.getByRole("button", { name: "Save journal" }).click();
  await expect(page.getByText("Sent for approval — it's posted once approved")).toBeVisible();
  await expect(page.getByRole("region", { name: "Journals waiting for approval" })).toBeVisible();

  // The bell and My work have it.
  await expect(page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible();
  await page.goto("/inbox");
  await expect(page.getByText("To approve · 1")).toBeVisible();
  await expect(page.getByText("Journal · Owner brought in capital")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing waiting on you")).toBeVisible();

  // Now it's in the books.
  await page.goto("/accounts/journals");
  await expect(page.getByRole("region", { name: "Journals waiting for approval" })).toHaveCount(0);
  await expect(page.getByText("Owner brought in capital")).toBeVisible();
  await page.goto("/inbox");
  await page.getByRole("tab", { name: "My requests" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
});
