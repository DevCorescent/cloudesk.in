import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Promotions on a real published store: the pop-up script runs under the
// site's security policy, bars count down, and the cart shows free-delivery progress.
test("pop-ups, bars and cart extras work on the live site", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await signUp(page, "Pia Promo", "pia.promo@example.com");
  const origin = new URL(page.url()).origin;
  const H = { origin };
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const pid = (await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "store", name: "Pia's Shop" }, headers: H })).json()).project.id;
  await page.request.post(`/api/v1/projects/${pid}/store/setup`, { data: { name: "Pia's Shop", country: "IN", region: "Kerala", email: "o@example.com", replaceDesign: false }, headers: H });
  await page.request.post(`/api/v1/projects/${pid}/store/products`, { data: { title: "Linen tote", status: "active", variants: [{ options: {}, price: 49900, stock: 10 }] }, headers: H });
  await page.request.post(`/api/v1/projects/${pid}/store/discounts`, { data: { code: "HELLO10", kind: "percent", value: 10 }, headers: H });
  const P = (data: unknown) => page.request.post(`/api/v1/projects/${pid}/promotions`, { data, headers: H });
  const ends = new Date(Date.now() + 2 * 86_400_000).toISOString();
  expect((await P({ kind: "bar", name: "Sale", enabled: true, endsAt: ends, config: { messages: ["Big sale ends in"], countdown: true } })).status()).toBe(201);
  expect((await P({ kind: "popup", name: "Hello", enabled: true, config: { heading: "Here's 10% off", action: "code", code: "HELLO10", buttonLabel: "Shop", buttonHref: "/shop", trigger: { type: "delay", delay: 1 }, frequency: "session" } })).status()).toBe(201);
  expect((await P({ kind: "shipping_goal", name: "Goal", enabled: true, config: {} })).status()).toBe(201);
  const dep = (await (await page.request.post(`/api/v1/projects/${pid}/deployments`, { data: { environment: "production" }, headers: H })).json()).deployment;

  await page.goto(`/sites/${dep.id}/`);
  // The countdown ticks (the script is running under the site's policy).
  const cd = page.locator(".ccp-cd");
  await expect(cd).toHaveText(/\d+d \d\d:\d\d:\d\d/);
  // The pop-up opens on its own after a second, and closes.
  const pop = page.locator(".ccp-pop");
  await expect(pop).toBeVisible({ timeout: 5000 });
  await expect(pop).toContainText("HELLO10");
  await page.keyboard.press("Escape");
  await expect(pop).toBeHidden();
  // Once per visit: it doesn't come back on the next page.
  await page.goto(`/sites/${dep.id}/shop`);
  await page.waitForTimeout(1800);
  await expect(page.locator(".ccp-pop")).toBeHidden();

  // The cart shows how far the shopper is from free delivery (₹999 by default).
  await page.getByRole("link", { name: /Linen tote/ }).first().click();
  await page.getByRole("button", { name: /Add to cart/i }).click();
  await expect(page.locator(".ccp-goal")).toContainText("away from free delivery");
  expect(errors.filter((e) => /Content Security Policy|Refused to execute/i.test(e))).toEqual([]);
});
