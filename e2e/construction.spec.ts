import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A contract from the BOQ to money received: add an item, measure it, prepare
// RA-1, submit and certify it, record the receipt, and write the site diary.
test("a contract's measurement book becomes a certified, paid RA bill", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.45" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Imran Qureshi", "imran.construction@example.com");

  await page.goto("/construction");
  await page.getByRole("button", { name: "New contract" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Contract", { exact: true }).fill("Community hall, Ward 12");
  await dlg.getByLabel("Client", { exact: true }).fill("Municipal Corporation");
  await dlg.getByLabel("Work order no.").fill("WO/2026/118");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByText("Community hall, Ward 12").click();
  await expect(page.getByRole("heading", { name: "Community hall, Ward 12" })).toBeVisible();

  await page.getByRole("button", { name: "Add an item" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Item code").fill("2.1");
  await dlg.getByLabel("Description").fill("PCC 1:4:8 in foundations");
  await dlg.getByLabel("Quantity").fill("100");
  await dlg.getByLabel("Rate (₹)").fill("5000");
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("cell", { name: "PCC 1:4:8 in foundations" })).toBeVisible();

  await page.getByRole("tab", { name: "Measurements" }).click();
  await page.getByLabel("BOQ item").selectOption({ label: "2.1 PCC 1:4:8 in foundations" });
  await page.getByLabel("Location").fill("Grid A1–A4");
  await page.getByLabel("L", { exact: true }).fill("10");
  await page.getByLabel("B", { exact: true }).fill("5");
  await page.getByLabel("D", { exact: true }).fill("0.5");
  await page.getByRole("button", { name: "Add 25" }).click();
  await expect(page.getByText("= 25 cum")).toBeVisible();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page.locator("#main").getByText("Checked", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "RA bills" }).click();
  await page.getByRole("button", { name: "Prepare the next RA bill" }).click();
  // ₹1,25,000 of work − 5% retention + 18% GST − 2% TDS (no advance taken yet).
  await expect(page.getByText("net ₹1,38,750")).toBeVisible();
  await page.getByRole("button", { name: "Submit" }).click();
  await page.getByRole("button", { name: "Record certification" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Client's reference").fill("MB-44");
  await dlg.getByRole("button", { name: "Record" }).click();
  await expect(page.locator("#main").getByText("certified", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Money received" }).click();
  await page.getByLabel("Bill", { exact: true }).selectOption({ index: 1 });
  await expect(page.getByLabel("Amount (₹)")).toHaveValue("138750");
  await page.getByLabel("Reference").fill("RTGS 99812");
  await page.getByRole("button", { name: "Record" }).click();
  await expect(page.getByText("₹1,38,750").last()).toBeVisible();

  await page.getByRole("tab", { name: "Site diary" }).click();
  await page.getByLabel("Weather").fill("Clear");
  await page.getByLabel("Labour").fill("Mason 8, Helper 12");
  await page.getByLabel("Work done").fill("PCC in grid A completed");
  await page.getByRole("button", { name: "Save the day" }).click();
  await expect(page.getByText("Mason 8, Helper 12")).toBeVisible();
});
