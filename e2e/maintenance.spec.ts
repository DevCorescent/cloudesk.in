import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// An asset with a meter, a plan by usage, a reading that raises the service
// job, the job finished, and a breakdown that marks the asset down.
test("assets, a meter-based plan and a breakdown", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.31" });
  await signUp(page, "Mira Mechanic", "mira.mnt@example.com");

  await page.goto("/maintenance/assets");
  await page.getByRole("button", { name: "Asset", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Air compressor");
  await dlg.getByLabel(/^Meter unit/).fill("hours");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "AST-0001 · Air compressor" })).toBeVisible();

  await page.getByRole("button", { name: "Meter reading" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^Reading/).fill("100");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("100 hours").first()).toBeVisible();

  await page.getByRole("button", { name: "Plan", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Task").fill("Belt check");
  await dlg.getByLabel("Every (hours)").fill("50");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Belt check")).toBeVisible();

  await page.getByRole("button", { name: "Meter reading" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel(/^Reading/).fill("150");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/1 service job raised/)).toBeVisible();

  await page.getByRole("link", { name: /Belt check/ }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Finish" }).click();
  await expect(page.getByText("Done", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "AST-0001 Air compressor" }).click();
  await page.getByRole("button", { name: "Report a problem" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("What's wrong, or what to do").fill("Leaking air");
  await dlg.getByRole("switch", { name: /The asset has stopped/ }).click();
  await dlg.getByRole("button", { name: "Raise" }).click();
  await expect(page.getByText("Down", { exact: true })).toBeVisible();
});
