import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

// The builder's direct-manipulation tools: drag a section from the gallery
// onto the page, move one by its handle, copy and paste it, and add live
// sections from the Connect panel.
async function order(page: Page) {
  const list = page.getByRole("list", { name: /Sections on/ });
  // The rail button toggles: open Layers only when it isn't showing already.
  if (!(await list.isVisible())) await page.getByRole("button", { name: "Layers", exact: true }).click();
  const items = list.locator(":scope > li");
  await expect(items.first()).toBeVisible();
  return (await items.allInnerTexts()).map((x) => x.split("\n")[0].split(" · ")[0].trim());
}

test("drag, move, copy and paste sections, add live sections from Connect, and set search options", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.61" });
  await signUp(page, "Bea Builder", "bea.builder@example.com");
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const pid = (await (await page.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "saas-platform", name: "Acme" }, headers: { origin: "http://localhost:3100" } })).json()).project.id;
  await page.goto(`/projects/${pid}/builder`);
  await expect(page.locator('iframe[title^="Canvas"]')).toBeVisible();

  const start = await order(page);
  expect(start[0]).toMatch(/Navigation/i);

  // Drag Pricing from the gallery onto the upper part of the page.
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const main = page.locator("main").last();
  const mb = (await main.boundingBox())!;
  await page.getByRole("button", { name: /^Pricing/ }).first().dragTo(main, { targetPosition: { x: mb.width / 2, y: 330 } });
  await expect(page.getByText("Pricing added")).toBeVisible();
  const dropped = await order(page);
  expect(dropped.length).toBe(start.length + 1);
  // It went where it was dropped — near the top, not at the end.
  expect(dropped.indexOf("Pricing")).toBeLessThan(dropped.length - 2);
  expect(dropped[dropped.length - 1]).toBe(start[start.length - 1]);

  // Move the FAQ section up the page with its drag handle.
  const before = dropped.indexOf("FAQ");
  await page.getByRole("list", { name: /Sections on/ }).getByText(/^FAQ/).first().click();
  const handle = page.getByRole("button", { name: "Drag to move" });
  await expect(handle).toBeVisible();
  // Selecting scrolls the page smoothly; take the handle once it has stayed put.
  let hb = (await handle.boundingBox())!;
  for (let still = 0; still < 3; ) {
    await page.waitForTimeout(200);
    const next = (await handle.boundingBox())!;
    still = Math.abs(next.y - hb.y) < 1 ? still + 1 : 0;
    hb = next;
  }
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width / 2, Math.max(mb.y + 150, hb.y - 260), { steps: 12 });
  await expect(page.getByText("Move here")).toBeVisible();
  await page.mouse.up();
  await expect.poll(async () => (await order(page)).indexOf("FAQ")).toBeLessThan(before);

  // Copy and paste it: a second FAQ appears right after it.
  await page.getByRole("toolbar", { name: /FAQ actions/ }).getByRole("button", { name: "More section actions" }).click();
  await page.getByRole("menuitem", { name: /Copy section/ }).click();
  await page.keyboard.press("ControlOrMeta+v");
  await expect(page.getByText("Section pasted")).toBeVisible();
  const pasted = await order(page);
  expect(pasted.filter((x) => x === "FAQ").length).toBe(2);

  // Connect: HR is on for a new workspace, so open jobs can be added.
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("HR — Hiring", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add open jobs" }).click();
  await expect(page.getByText(/added/).first()).toBeVisible();
  await expect.poll(async () => (await order(page)).some((x) => /jobs|careers/i.test(x))).toBe(true);
  await expect(page.getByText(/^Saved$/)).toBeVisible();

  // Search & sharing: hide this page from search engines and turn on business details.
  await page.keyboard.press("Escape");
  await expect(page.getByText("Whole site · search & sharing")).toBeVisible();
  await page.getByRole("switch", { name: "Hide from search engines" }).click();
  await page.getByRole("switch", { name: "Business details for search results" }).click();
  await page.getByLabel("Kind of business").selectOption("LocalBusiness");
  await page.getByLabel("Phone").fill("+91 98000 00000");
  await expect(page.getByText(/^Saved$/)).toBeVisible();
  const doc = JSON.parse((await (await page.request.get(`/api/v1/projects/${pid}/file?path=site/site.json`)).json()).content);
  expect(doc.pages[0].seo).toMatchObject({ noindex: true });
  expect(doc.seo.org).toMatchObject({ type: "LocalBusiness", phone: "+91 98000 00000" });
});
