import { expect, test } from "@playwright/test";
import { closeDb, signUp } from "./helpers";

// Notes: write one with blocks, a "/" element and formatting; it saves itself;
// and a quick note saved from a module's page shows up there and in Notes.
test.afterAll(closeDb);

test("write a note with elements, and keep notes on any page", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.88.0.8" });
  await signUp(page, "Nora Notes", `nora.${Date.now()}@notes.example`);
  await page.goto("/notes");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Blank Start from nothing/ }).click();
  await page.getByLabel("Title").fill("Launch plan");
  await page.locator("[role=textbox]").first().click();
  await page.keyboard.type("Ship by **Friday**");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/todo");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Write the announcement");
  await page.keyboard.press("Enter");
  await page.keyboard.type("= 1200 * 3");
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("= 3,600").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Title")).toHaveValue("Launch plan");
  await expect(page.locator("strong", { hasText: "Friday" })).toBeVisible();
  await expect(page.getByText("Write the announcement").first()).toBeVisible();

  await page.goto("/crm");
  await page.getByRole("button", { name: "Notes on this page" }).click();
  await page.getByLabel("Note", { exact: true }).fill("Call the three warm leads on Monday");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Notes on this page" }).getByText("Call the three warm leads on Monday")).toBeVisible();
  await page.goto("/notes");
  await expect(page.getByText("Note on CRM").first()).toBeVisible();
});
