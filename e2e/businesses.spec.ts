import { expect, test } from "@playwright/test";

// Business pages: reachable from the menu, each with its real-screenshot
// tour, and "Start free" carries the business into onboarding.
const DAYS: Record<string, number> = { fashion: 5, "bakery-cafe": 5, "restaurants-hotels": 7, "salon-spa": 4, jewellery: 4, studios: 4, clinics: 4, "home-decor": 4, fitness: 4 };

test("business pages from the menu, and onboarding starts with that business", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Industries" }).hover();
  const menu = page.locator("#menu-industries");
  await expect(menu.getByRole("link", { name: /Salons & spas/ })).toBeVisible();
  await menu.getByRole("link", { name: /Salons & spas/ }).click();
  await expect(page).toHaveURL(/\/for\/salon-spa$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A fully booked week");

  // Every business page loads with its own day-in-the-life tour.
  for (const [slug, n] of Object.entries(DAYS)) {
    const res = await page.goto(`/for/${slug}`);
    expect(res?.status(), slug).toBe(200);
    await expect(page.locator("#day ol > li"), slug).toHaveCount(n);
  }
  await page.goto("/for");
  await expect(page.locator('main a[href^="/for/"]')).toHaveCount(9);
  expect((await page.goto("/for/not-a-business"))?.status()).toBe(404);

  // Starting from a business page pre-picks it in onboarding.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.13" });
  await page.goto("/for/clinics");
  await page.getByRole("link", { name: "Start free as a clinic" }).click();
  await page.waitForURL(/\/start\?industry=clinic$/);
  await page.getByRole("button", { name: "Let's begin" }).click();
  await expect(page.getByRole("radio", { name: /Clinic & healthcare/ })).toHaveAttribute("aria-checked", "true");
});
