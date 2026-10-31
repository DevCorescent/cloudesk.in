import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The public site: landing page, features menu, every feature page, and the
// signed-in header.
test("landing and feature pages work for visitors", async ({ page }) => {
  // Visits every feature page; each is heavy with full-size screenshots.
  test.setTimeout(240_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your website, store and business software. Ready in minutes.");
  await expect(page.locator("section.mk-hero").getByRole("link", { name: /Start free/ })).toHaveAttribute("href", "/start");
  await expect(page.locator("section.mk-hero").getByRole("link", { name: /See how a launch works/ })).toHaveAttribute("href", "/features/launch");
  // The hero shows a real screen for each thing you can launch; picking one switches it.
  const tracks = page.getByRole("tablist", { name: "Main features" });
  await tracks.getByRole("tab", { name: "Business software" }).click();
  await expect(tracks.getByRole("tab", { name: "Business software" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("img", { name: /The business dashboard: money owed/ })).toBeVisible();
  for (const h of ["Create your website, store and software in minutes.", "Built for speed. Made for detail.", "One suite. Switch on what you need.", "Made for businesses like yours.", "Works with your tools.", "Good to know."]) await expect(page.getByRole("heading", { name: h })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Built like the business software big companies use/ })).toBeVisible();
  // FAQs open.
  await page.getByText("How do I get paid?").click();
  await expect(page.getByText(/Money goes straight to you/)).toBeVisible();
  // Site search: from the header, or ⌘K.
  await page.getByRole("button", { name: "Search the site" }).first().click();
  const search = page.getByRole("dialog", { name: "Search the site" });
  await search.getByLabel("Search").fill("invoic");
  await expect(search.getByRole("option").first()).toContainText("Invoicing & Finance");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/features\/invoicing$/);
  await page.goto("/");
  // The Products menu, by category.
  await page.getByRole("button", { name: "Products" }).click();
  const menu = page.locator("#menu-products");
  for (const g of ["Build & sell", "Run your business", "Operations", "Industry suites", "AI, data & automation"]) await expect(menu.getByText(g, { exact: true })).toBeVisible();
  await menu.getByRole("link", { name: "Point of sale & barcodes" }).click();
  await expect(page).toHaveURL(/\/features\/point-of-sale$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Beep. Bill. Done. A till that keeps up with your counter.");
  await expect(page.getByText("Good to know")).toBeVisible();

  // Every feature page renders, with its how-it-works and FAQs.
  await page.goto("/features");
  const links = await page.locator('main a[href^="/features/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!))]);
  expect(links).toHaveLength(41);
  for (const href of links) {
    const res = await page.goto(href, { waitUntil: "domcontentloaded" });
    expect(res?.status(), href).toBe(200);
    await expect(page.getByText("Three steps, no surprises")).toBeVisible();
    await expect(page.getByText("Questions people ask")).toBeVisible();
  }
  // The website builder page tells its story with real screenshots, stacked.
  await page.goto("/features/website-builder");
  await expect(page.getByRole("heading", { name: /Every tool, up close/ })).toBeVisible();
  await expect(page.locator("#tour ol > li")).toHaveCount(8);
  await expect(page.getByRole("img", { name: /Branches dialog/ })).toBeAttached();
  await page.goto("/features/invoicing");
  await expect(page.locator("#tour ol > li")).toHaveCount(9);
  await expect(page.getByRole("img", { name: /Finance overview/ }).first()).toBeAttached();
  await page.goto("/features/online-store");
  await expect(page.locator("#tour ol > li")).toHaveCount(5);
  await expect(page.locator("#templates .tpl-card")).toHaveCount(14);
  await page.getByRole("tab", { name: /Glass collection/ }).click();
  await expect(page.locator("#templates .tpl-card")).toHaveCount(9);
  await page.getByRole("button", { name: /Orders/ }).first().click();
  await expect(page.getByRole("button", { name: /Orders/ }).first()).toHaveAttribute("aria-current", "step");
  await page.goto("/features/point-of-sale");
  await expect(page.locator("#tour ol > li")).toHaveCount(7);
  // Phones to flip through on the homepage, each opening its feature.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Open five-minute launch/ })).toHaveAttribute("href", "/features/launch");
  const deck = page.getByRole("region", { name: "Every feature on a phone" });
  await expect(deck.getByRole("group", { name: /^1 of 15/ })).toHaveAttribute("aria-hidden", "false");
  // (The hero slider has its own "Next feature"; this is the phone deck's.)
  await page.locator(".pd").getByRole("button", { name: "Next feature" }).click();
  await expect(deck.getByRole("group", { name: /^2 of 15/ })).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByRole("link", { name: /Open website builder/ })).toHaveAttribute("href", "/features/website-builder");

  // Every other feature has its own screenshot tour and a highlights explorer.
  const tours: Record<string, number> = { launch: 6, bookings: 5, promotions: 5, growth: 2, domains: 3, "ai-ide": 3, automations: 3, chatbot: 3, data: 3, collaboration: 4, horeca: 17, crm: 12, hrms: 12, inventory: 10, accounting: 10 };
  for (const [slug, n] of Object.entries(tours)) {
    await page.goto(`/features/${slug}`);
    await expect(page.locator("#tour ol > li"), slug).toHaveCount(n);
  }
  const tabs = page.getByRole("tablist", { name: "Highlights" }).getByRole("tab");
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await tabs.nth(1).press("ArrowDown");
  await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(2)).toBeFocused();
  expect((await page.goto("/features/not-a-thing"))?.status()).toBe(404);

  // Signing up from the landing page.
  await page.goto("/");
  await page.getByRole("link", { name: "Start free" }).first().click();
  await expect(page).toHaveURL(/\/start$/);
  await expect(page.getByRole("button", { name: "Let's begin" })).toBeVisible();
  // Old sign-up links lead to the same place.
  await page.goto("/signup");
  await expect(page).toHaveURL(/\/start$/);
  await signUp(page, "Visitor Person", "visitor@example.com");
  await page.goto("/");
  await expect(page.getByRole("banner").getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
});
