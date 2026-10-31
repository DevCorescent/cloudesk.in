import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Import suppliers from a file with odd headings, save the columns, see the
// import in the history, and have the saved columns used for the next file.
test("import history and saved columns", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.40" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Dev Data", "dev.data@example.com");
  const csv = (rows: string[]) => ({ name: "parties.csv", mimeType: "text/csv", buffer: Buffer.from(["Ledger Name,Tax Reg No,Cr Days", ...rows].join("\n")) });

  await page.goto("/inventory/suppliers");
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("input[type=file]").setInputFiles(csv(["Apex Packaging,27AAACS1234K1ZH,30", "Bharat Boxes,,15"]));
  await page.getByLabel("Column for Name", { exact: true }).selectOption("0");
  await page.getByLabel("Column for GSTIN", { exact: true }).selectOption("1");
  await page.getByLabel("Name for these columns").fill("Tally parties");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Using saved columns “Tally parties”")).toBeVisible();
  await page.getByRole("button", { name: /^Check 2 rows/ }).click();
  await page.getByRole("button", { name: /^Import 2 suppliers/ }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("Apex Packaging")).toBeVisible();

  await page.goto("/settings/data");
  await expect(page.getByRole("row", { name: /Suppliers.*parties\.csv/ })).toBeVisible();
  await page.getByRole("tab", { name: "Saved columns" }).click();
  await expect(page.getByText("Tally parties")).toBeVisible();

  // The same headings again: the saved columns are used.
  await page.goto("/inventory/suppliers");
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("input[type=file]").setInputFiles(csv(["Chetan Cartons,,45"]));
  await expect(page.getByText("Using saved columns “Tally parties”")).toBeVisible();
});
