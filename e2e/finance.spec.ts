import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Finance on its own: books for a business with no website or store.
test("set up standalone books from the sidebar and invoice a client", async ({ page }) => {
  await signUp(page, "Ravi Desai", "ravi@example.com");
  await page.goto("/home");
  // The sidebar groups open like dropdowns.
  await page.getByRole("button", { name: "Money" }).click();
  await page.getByRole("link", { name: "Invoices & finance" }).click();
  await expect(page.getByText("Invoicing and your financials, in one calm place.")).toBeVisible();
  await page.getByLabel("Your business name").fill("Desai Advisory");
  await page.getByRole("button", { name: "Set up my books" }).click();
  await page.waitForURL(/\/finance\/[0-9a-f-]{36}$/);
  await expect(page.getByText("You're owed", { exact: true })).toBeVisible();
  await expect(page.getByText("Desai Advisory").first()).toBeVisible();

  await page.getByRole("link", { name: "New invoice" }).click();
  await page.getByLabel("Contact name *").fill("Neha Kapoor");
  await page.getByLabel("Item 1 name").fill("Tax advisory retainer");
  await page.getByLabel("Item 1 rate").fill("25000");
  await page.getByRole("button", { name: "Save & issue invoice" }).click();
  await page.waitForURL(/\/finance\/[0-9a-f-]{36}\/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /^INV\/\d{4}-\d{2}\/0001$/ })).toBeVisible();

  // The dashboard reflects it; no project was created along the way.
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByText("₹29,500.00").first()).toBeVisible();
  const projects = await (await page.request.get(`/api/v1/orgs/${(await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id}/projects`)).json();
  expect(projects.total).toBe(0);

  // Settings: rename the books.
  await page.getByRole("link", { name: "Settings" }).last().click();
  await page.getByRole("textbox", { name: "Name" }).first().fill("Desai & Co");
  await page.getByRole("button", { name: "Rename" }).click();
  await expect(page.getByText("Renamed").first()).toBeVisible();
});
