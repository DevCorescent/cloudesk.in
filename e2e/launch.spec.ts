import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The five-minute launch: a messy spreadsheet in, a live store out.
test("launch a store from a spreadsheet in one guided flow", async ({ page }) => {
  await signUp(page, "Asha Launch", "launch@example.com");

  // Onboarding: name and industry, then the features its dashboard gets.
  await expect(page.getByText("Welcome, Asha")).toBeVisible();
  await page.getByRole("button", { name: "Let's begin" }).click();
  await page.getByPlaceholder("Saffron House").fill("Tea Leaf Co");
  await page.getByPlaceholder(/A bakery in Pune/).fill("Single-estate teas packed fresh in Darjeeling, and a small tea shop counter in town.");
  // The one-line description suggests the industry, and what it picked up shows.
  await expect(page.getByRole("radio", { name: /Bakery & food brand/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("has a counter").first()).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  // Quick questions, pre-answered: they sell at a counter and online.
  await expect(page.getByRole("heading", { name: "A few quick questions" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /At a counter/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: /At tables/ })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "See my plan" }).click();
  // The plan says why each feature is there.
  await expect(page.getByRole("switch", { name: "Point of sale" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("You bill customers at a counter")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Cloudesk for Horeca" })).toHaveCount(0);
  // Not needed here: switch promotions off.
  await page.getByRole("switch", { name: "Promotions" }).click();
  await expect(page.getByRole("switch", { name: "Promotions" })).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: /Set up my workspace/ }).click();
  await expect(page.getByText("Your workspace is ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Build my online store" }).click();
  await page.waitForURL(/\/launch\?from=onboarding&kind=store$/);
  await expect(page.getByRole("heading", { name: "Tell us about your store" })).toBeVisible();
  await expect(page.getByPlaceholder("Saanjh Studio")).toHaveValue("Tea Leaf Co");
  await page.getByPlaceholder("Saanjh Studio").fill("Tea Leaf Co");
  await page.getByPlaceholder(/Handwoven everyday wear/).fill("Single-estate teas, packed fresh in Darjeeling.");
  await page.getByRole("button", { name: /Bakery & café/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();

  // A sheet with its own headings, a title row and one product missing its price.
  const csv = ["Tea Leaf Co price list", "", "Item;Rate (₹);Pack;Qty", "First Flush Darjeeling;₹ 650;100 g;20", "First Flush Darjeeling;₹ 1.200;250 g;8", "Masala Chai;;250 g;30"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "teas.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText("Found 2 products in teas.csv")).toBeVisible();
  await expect(page.getByText("Add a price")).toBeVisible();
  const chai = page.locator("article").filter({ has: page.locator('input[value="Masala Chai"]') });
  await chai.getByLabel("Price").fill("320");
  await expect(page.getByText("Add a price")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("Pick the look you love")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Connect a domain I own/ }).click();
  await page.getByLabel("Your domain").fill("www.tealeaf-e2e.in");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /Launch my store/ }).click();
  await expect(page.getByText("Tea Leaf Co is live")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Connect www.tealeaf-e2e.in")).toBeVisible();
  await expect(page.getByText("_creationcloud.www.tealeaf-e2e.in")).toBeVisible();
  const liveHref = await page.getByRole("link", { name: /Visit/ }).getAttribute("href");

  // The dashboard opens with the tour; it walks through and can be finished.
  await page.getByRole("button", { name: /Open my dashboard/ }).click();
  const tour = page.getByRole("dialog", { name: "Tea Leaf Co tour" });
  await expect(tour.getByText("Welcome to Tea Leaf Co")).toBeVisible();
  await tour.getByRole("button", { name: "Show me" }).click();
  await expect(tour.getByText("Your site is live")).toBeVisible();
  for (let i = 0; i < 12 && (await tour.getByRole("button", { name: "Next" }).count()); i++) await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("You're ready")).toBeVisible();
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toHaveCount(0);
  // The sidebar has what was picked, and nothing that wasn't.
  const nav = page.getByRole("navigation", { name: "Web app" });
  await expect(nav.getByRole("link", { name: "Online store" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Invoices & quotes" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Promotions" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Restaurant & hotel" })).toHaveCount(0);
  // The checklist reflects real state and what was asked for.
  await expect(page.getByText("Make your first sale at the counter")).toBeVisible();
  await expect(page.getByText("www.tealeaf-e2e.in — waiting for DNS records")).toBeVisible();

  const live = liveHref;
  await page.goto(`${live}/shop`);
  await expect(page.getByText("First Flush Darjeeling").first()).toBeVisible();
  await expect(page.getByText("Masala Chai").first()).toBeVisible();
  // Pack sizes became variants, and "₹ 1.200" in the sheet is twelve hundred rupees.
  await page.goto(`${live}/product/first-flush-darjeeling`);
  await expect(page.locator("option", { hasText: "250 g — ₹1,200" })).toHaveCount(1);
  await expect(page.locator("option", { hasText: "100 g — ₹650" })).toHaveCount(1);
});
