import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A website project gets an online store added to it, in its own design.
test("templates by business, then add a store to the website", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.15" });
  await signUp(page, "Leela Iyer", "leela.addstore@example.com");

  // Five templates per business.
  await page.goto("/templates");
  await page.getByRole("radio", { name: /Salons & spas/ }).click();
  await expect(page.getByRole("button", { name: "Use template" })).toHaveCount(5);
  await page.getByRole("button", { name: "Preview Hair & beauty salon" }).click();
  await page.getByRole("dialog").getByLabel("Web app name").fill("Studio Mane");
  await page.getByRole("button", { name: "Create and open builder" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/builder$/);
  const project = page.url().replace(/\/builder$/, "");

  // The store page offers to add it to this website.
  await page.goto(`${project}/store`);
  await expect(page.getByRole("heading", { name: "Add an online store" })).toBeVisible();
  await page.getByRole("button", { name: /Add it to this website/ }).click();
  await expect(page.getByText("A Shop link in your menu")).toBeVisible();
  await page.getByLabel("Start with sample products").selectOption("beauty");
  await page.getByRole("button", { name: "Add the store" }).click();
  await expect(page.getByRole("heading", { name: "Your store is part of your website" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open my store" }).click();
  // The store dashboard now shows instead of the setup.
  await expect(page.getByRole("navigation", { name: "Store" })).toBeVisible();
});
