import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A catalogue made in the dashboard, shared by link, and ordered from.
test("make a catalogue, open its link, choose quantities and check out", async ({ page, browser }) => {
  // Its own network address, so this account doesn't use up the other suites' sign-up allowance.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.7" });
  await signUp(page, "Kiran Rao", "kiran.catalogue@example.com");
  const origin = new URL(page.url()).origin;
  const headers = { origin };
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const { project } = await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "Kora" }, headers })).json();
  const api = (path: string, data: unknown) => page.request.post(`/api/v1/projects/${project.id}/store/${path}`, { data, headers });
  await api("setup", { name: "Kora Ceramics", country: "IN", region: "Karnataka", email: "hi@kora.example", replaceDesign: false });
  await api("products", { title: "Clay mug", status: "active", variants: [{ options: {}, price: 59900, stock: 10 }] });
  await api("products", { title: "Serving bowl", status: "active", variants: [{ options: {}, price: 129900, stock: 5 }] });
  await page.request.post(`/api/v1/projects/${project.id}/deployments`, { data: { environment: "production" }, headers });

  // Create it from the dashboard.
  await page.goto(`/projects/${project.id}/store/catalogues`);
  await page.getByRole("button", { name: "Create your first catalogue" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Autumn pottery");
  await page.getByRole("dialog").getByRole("button", { name: /Editorial/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Create catalogue" }).click();
  await expect(page.getByLabel("Catalogue name")).toHaveValue("Autumn pottery");
  await expect(page.getByText("2 products · live preview")).toBeVisible();
  await expect(page.frameLocator('iframe[title="Catalogue preview"]').getByRole("heading", { name: "Autumn pottery" })).toBeVisible();

  // Sharing: the link is ready to copy.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await page.getByRole("dialog").getByLabel("Catalogue link").inputValue();
  expect(link).toMatch(/\/c\/[\w-]+$/);
  await page.keyboard.press("Escape");

  // A customer opens it, picks quantities and checks out on the store.
  const shopper = await browser.newPage();
  await shopper.goto(link);
  await expect(shopper.getByRole("heading", { name: "Autumn pottery" })).toBeVisible();
  await expect(shopper.getByRole("region", { name: "Your order" })).not.toHaveClass(/\bon\b/);
  await shopper.getByRole("button", { name: "One more Clay mug" }).click();
  await shopper.getByRole("button", { name: "One more Clay mug" }).click();
  await shopper.getByRole("button", { name: "One more Serving bowl" }).click();
  await expect(shopper.locator("#cat-total")).toHaveText("₹2,497");
  await shopper.getByRole("button", { name: /Checkout/ }).click();
  await shopper.waitForURL(/\/checkout$/);
  await expect(shopper.getByText("Clay mug")).toBeVisible();
  await expect(shopper.getByText("Serving bowl")).toBeVisible();
  await shopper.close();
});
