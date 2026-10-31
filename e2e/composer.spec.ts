import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Build your app: switch a part of HR off and watch the HR menu follow, and
// make a workspace role limited to some modules.
test("switch module parts on and off, and make a workspace role", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.13" });
  await signUp(page, "Asha Rao", "asha.compose@example.com");

  await page.goto("/settings/features");
  await expect(page.getByRole("heading", { name: "Build your app" })).toBeVisible();
  const preview = page.getByRole("complementary", { name: "Your sidebar" });
  await expect(preview).toContainText("HR & payroll");

  // Payroll off: gone from the HR menu, and its page says so.
  await page.getByRole("switch", { name: "HR & payroll: Payroll on" }).click();
  await expect(page.getByRole("switch", { name: "HR & payroll: Payroll off" })).toBeVisible();
  await page.goto("/hr");
  const hrNav = page.getByRole("navigation", { name: "HR" });
  await expect(hrNav.getByRole("link", { name: "Leave" })).toBeVisible();
  await expect(hrNav.getByRole("link", { name: "Payroll" })).toHaveCount(0);
  await page.goto("/hr/payroll");
  await expect(page.getByText(/This part of HR is switched off/)).toBeVisible();

  // Back on.
  await page.goto("/settings/features");
  await page.getByRole("switch", { name: "HR & payroll: Payroll off" }).click();
  await expect(page.getByRole("switch", { name: "HR & payroll: Payroll on" })).toBeVisible();
  await page.goto("/hr");
  await expect(page.getByRole("navigation", { name: "HR" }).getByRole("link", { name: "Payroll" })).toBeVisible();

  // A whole module off leaves the sidebar preview and the main menu.
  await page.goto("/settings/features");
  await page.getByRole("switch", { name: "CRM on" }).click();
  // Marketing needs CRM, so switching CRM off asks first.
  await page.getByRole("dialog").getByRole("button", { name: "Switch them off" }).click();
  await expect(page.getByRole("switch", { name: "CRM off" })).toBeVisible();
  await expect(preview).not.toContainText("CRM");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "CRM" })).toHaveCount(0);

  // A workspace role limited to Horeca and HR.
  await page.goto("/team");
  await page.getByRole("button", { name: "New role" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Kitchen lead");
  await dlg.getByLabel("Permissions like").selectOption("editor");
  await dlg.getByRole("checkbox", { name: "Cloudesk for Horeca" }).check();
  await dlg.getByRole("checkbox", { name: "HR & payroll" }).check();
  await dlg.getByRole("button", { name: "Create role" }).click();
  await expect(page.getByText("Kitchen lead")).toBeVisible();
  await expect(page.getByText("Editor permissions · 0 people")).toBeVisible();
});
