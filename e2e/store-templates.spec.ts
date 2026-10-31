import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Starting a store straight from the dashboard's Templates page.
test("pick a store template, name the shop, and land in setup with the design chosen", async ({ page }) => {
  await signUp(page, "Tara Iyer", "tara.templates@example.com");

  await page.goto("/templates");
  await page.getByRole("tab", { name: /Online stores/ }).click();
  await page.getByRole("radio", { name: /Glass collection/ }).click();
  await expect(page.locator("article")).toHaveCount(12);
  await page.locator("article", { hasText: "Brewhouse" }).getByRole("button", { name: "Use template" }).click();
  await page.getByLabel("Store name").fill("Bean There");
  await page.getByRole("button", { name: /Continue/ }).click();

  // The wizard opens on the details step, with the chosen design ready to apply.
  await expect(page.getByLabel("Store name")).toHaveValue("Bean There");
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByLabel("State").selectOption("Kerala");
  await page.getByLabel("Order notification email").fill("orders@example.com");
  await page.getByRole("button", { name: "Create my store" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Products", exact: true }).click();
  await expect(page.getByText("House espresso blend, 250 g").first()).toBeVisible();
});
