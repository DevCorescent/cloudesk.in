import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// HR: add yourself and a colleague, check in, apply for leave and approve it,
// run and finalise payroll, and take an application from the careers page.
test("people, attendance, leave, payroll and hiring", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.12" });
  await signUp(page, "Nisha Rao", "nisha.hr@example.com");

  // Add yourself — the same email links the record to your account.
  await page.goto("/hr/people");
  await page.getByRole("button", { name: "Add the first person" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Full name").fill("Nisha Rao");
  await dlg.getByLabel("Work email").fill("nisha.hr@example.com");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("Designation").fill("Founder");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("CTC per year (₹)").fill("1200000");
  await dlg.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: "Nisha Rao" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Joining checklist/ })).toBeVisible();

  // And a colleague who reports to you.
  await page.goto("/hr/people");
  await page.getByRole("button", { name: "Add person" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Full name").fill("Karan Joshi");
  await dlg.getByLabel("Work email").fill("karan.hr@example.com");
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("Designation").fill("Sales Executive");
  await dlg.getByLabel("Reports to").selectOption({ label: "Nisha Rao" });
  await dlg.getByRole("button", { name: "Next" }).click();
  await dlg.getByLabel("CTC per year (₹)").fill("360000");
  await dlg.getByRole("button", { name: "Add person" }).click();
  await expect(page.getByRole("heading", { name: "Karan Joshi" })).toBeVisible();
  await expect(page.getByText("reports to Nisha Rao")).toBeVisible();

  // Check in and out from Me.
  await page.goto("/hr/me");
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText(/^In since/)).toBeVisible();
  await page.getByRole("button", { name: "Check out" }).click();
  await expect(page.getByRole("button", { name: "Check out" })).toBeHidden();

  // File a day of unpaid leave for Karan on the next working day; as HR it's
  // approved straight away.
  const day = new Date(Date.now() + 5.5 * 3600_000);
  do day.setUTCDate(day.getUTCDate() + 1);
  while (day.getUTCDay() === 0);
  const ymd = day.toISOString().slice(0, 10);
  await page.goto("/hr/leave");
  await page.getByRole("button", { name: "Add for someone" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Person").selectOption({ label: "Karan Joshi" });
  await dlg.getByLabel("Type").selectOption((await dlg.getByLabel("Type").locator("option", { hasText: "Unpaid leave" }).getAttribute("value"))!);
  await dlg.getByLabel("From").fill(ymd);
  await dlg.getByLabel("To").fill(ymd);
  await dlg.getByLabel("Reason (optional)").fill("Family function");
  await dlg.getByRole("button", { name: "Add leave" }).click();
  await page.getByRole("tab", { name: "All requests" }).click();
  await expect(page.getByText("“Family function”")).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();

  // Work out this month's payroll and finalise it.
  await page.goto("/hr/payroll");
  await page.getByRole("button", { name: /^Work out/ }).click();
  await expect(page.getByRole("button", { name: "Finalise" })).toBeVisible();
  await expect(page.getByText("2 people").first()).toBeVisible();
  await page.getByRole("button", { name: "Finalise" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Finalise" }).click();
  await expect(page.getByRole("link", { name: "Bank file" })).toBeVisible();
  await page.getByRole("button", { name: "Mark as paid" }).click();
  await expect(page.getByRole("button", { name: "Mark as paid" })).toBeHidden();

  // Open a role and apply on the public careers page.
  await page.goto("/hr/hiring");
  await page.getByRole("button", { name: "Open a role" }).first().click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Role", { exact: true }).fill("Store Associate");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Store Associate").first()).toBeVisible();
  await page.goto("/hr/hiring");
  const careers = (await page.locator("code").filter({ hasText: "/careers/" }).first().textContent())!.trim();
  const visitor = await page.context().browser()!.newPage();
  await visitor.goto(careers);
  await visitor.getByText("Store Associate").click();
  await visitor.getByLabel("Your name").fill("Meera Iyer");
  await visitor.getByLabel("Email").fill("meera.applicant@example.com");
  await visitor.getByRole("button", { name: "Apply" }).click();
  await expect(visitor.getByText(/Thanks — your application is in/)).toBeVisible();
  await visitor.close();

  await page.getByText("Store Associate").first().click();
  await expect(page.getByRole("region", { name: "Applied" }).getByText("Meera Iyer")).toBeVisible();
});
