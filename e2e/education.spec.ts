import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A class and a student, a fee plan raised and paid with a receipt,
// attendance marked, and marks turned into a report card.
test("students, fees, attendance and a report card", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.43" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Shalini School", "shalini.edu@example.com");

  await page.goto("/school/classes");
  await page.getByRole("button", { name: "Add a class" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Class", { exact: true }).fill("Class 6");
  await dlg.getByLabel("Section").fill("B");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Class 6 – B")).toBeVisible();

  await page.goto("/school/students");
  await page.getByRole("button", { name: "Add a student" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Aarav Shah");
  await dlg.getByLabel("Class").selectOption({ index: 1 });
  await dlg.getByLabel("Roll no.").fill("1");
  await dlg.getByLabel("Guardian", { exact: true }).fill("Nisha Shah");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Aarav Shah")).toBeVisible();

  await page.goto("/school/fees");
  await page.getByRole("button", { name: "New fee plan" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Plan").fill("Annual fees");
  await dlg.getByRole("button", { name: "Class 6 – B" }).click();
  await dlg.getByLabel("Amount 1").fill("24000");
  await dlg.getByLabel("Due 1").fill("2026-06-10");
  await dlg.getByLabel("Due 2").fill("2026-12-10");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Fee plans" }).click();
  await page.getByRole("button", { name: "Raise fees" }).click();
  await expect(page.getByText("2 fee(s) raised, ₹24,000")).toBeVisible();
  await page.getByRole("tab", { name: "To collect" }).click();
  await page.getByRole("button", { name: "Take payment" }).first().click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByLabel("Amount (₹)")).toHaveValue("12000");
  await dlg.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByText(/Received — receipt RCT-00001/)).toBeVisible();

  await page.goto("/school/attendance");
  await page.getByRole("button", { name: "Everyone present" }).click();
  await page.getByRole("button", { name: "Save attendance" }).click();
  await expect(page.getByText("Attendance saved")).toBeVisible();

  await page.goto("/school/exams");
  await page.getByRole("button", { name: "Add an exam" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Exam").fill("Unit test 1");
  await dlg.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByLabel("Maths for Aarav Shah").fill("88");
  await page.getByLabel("English for Aarav Shah").fill("74");
  await page.getByRole("button", { name: "Save marks" }).click();
  await expect(page.getByRole("cell", { name: "81" })).toBeVisible();
  await page.getByRole("button", { name: "Aarav Shah" }).click();
  await expect(page.getByRole("dialog").getByText("Result:")).toContainText("Pass");
});
