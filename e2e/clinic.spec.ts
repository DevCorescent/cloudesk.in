import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Register a patient, book a token, see them through the queue, write and
// sign a consultation, print the prescription, and bill.
test("a patient's visit from the front desk to the prescription", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.44" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Dr Kavita Rao", "kavita.clinic@example.com");

  await page.goto("/clinic/patients");
  await page.getByRole("button", { name: "Register a patient" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Suresh Menon");
  await dlg.getByLabel("Phone").fill("9876543210");
  await dlg.getByLabel("Or age (years)").fill("58");
  await dlg.getByLabel("Allergies").fill("Sulfa drugs");
  await dlg.getByRole("switch").click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Suresh Menon" })).toBeVisible();
  await expect(page.getByText("Allergies: Sulfa drugs")).toBeVisible();

  await page.getByRole("button", { name: "Book" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Book" }).click();
  await expect(page.getByText(/Booked — token 1/)).toBeVisible();

  await page.goto("/clinic");
  await page.getByRole("button", { name: "Arrived" }).click();
  await expect(page.getByText("Waiting")).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("With doctor")).toBeVisible();

  await page.getByRole("link", { name: "Suresh Menon" }).click();
  await page.getByRole("button", { name: "New consultation" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("BP systolic").fill("160");
  await dlg.getByLabel("BP diastolic").fill("100");
  await expect(dlg.getByText("High blood pressure")).toBeVisible();
  await dlg.getByLabel("Diagnosis").fill("Hypertension");
  await dlg.getByLabel("Medicine 1").fill("Telmisartan");
  await dlg.getByLabel("Strength 1").fill("40 mg");
  await dlg.getByLabel("Dose 1").fill("1-0-0");
  await dlg.getByLabel("Days 1").fill("30");
  await dlg.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await dlg.getByRole("button", { name: "Sign" }).click();
  await expect(page.locator("#main").getByText("Signed", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Prescription" }).click();
  await expect(page.getByText("Telmisartan 40 mg — 1-0-0 × 30 days")).toBeVisible();

  await page.goBack();
  await page.getByRole("button", { name: "Bill" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Make bill · ₹500/ }).click();
  await page.getByRole("button", { name: "Take payment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("paid", { exact: true })).toBeVisible();
});
