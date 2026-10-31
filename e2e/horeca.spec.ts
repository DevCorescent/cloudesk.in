import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Cloudesk for Horeca: set up a café, a guest orders from the table's QR menu,
// the kitchen cooks it, and the bill is settled on the floor screen.
test("set up a café, order from a table QR, cook it and settle the bill", async ({ page, browser }) => {
  // Its own network address, so this account doesn't use up the other suites' sign-up allowance.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.9" });
  await signUp(page, "Meera Iyer", "meera.horeca@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const { project } = await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "Filter House" }, headers })).json();
  const h = (path: string, data?: unknown) => page.request.post(`/api/v1/projects/${project.id}/horeca/${path}`, { data, headers }).then((r) => r.json());

  // First-time setup from the dashboard.
  await page.goto(`/projects/${project.id}/horeca`);
  await page.getByLabel("Venue name").fill("Filter House");
  await page.getByRole("button", { name: /Café/ }).click();
  await page.getByLabel("Tables to start with").fill("4");
  await page.getByRole("button", { name: "Set up Filter House" }).click();
  await expect(page.getByRole("heading", { name: /Filter House/ })).toBeVisible();

  const { category } = await h("categories", { name: "Coffee", station: "bar" });
  await h("menu-items", { categoryId: category.id, name: "Filter coffee", price: 9000, diet: "veg" });
  const tables = await (await page.request.get(`/api/v1/projects/${project.id}/horeca/tables`)).json();
  const t1 = tables.tables.find((t: { name: string }) => t.name === "T1");

  // A guest scans T1's code and orders a coffee.
  const guest = await browser.newPage();
  await guest.goto(t1.url);
  await expect(guest.getByRole("heading", { name: "Filter House" })).toBeVisible();
  await guest.locator("article", { hasText: "Filter coffee" }).getByRole("button", { name: "ADD" }).click();
  await guest.locator("#item-panel").getByRole("button", { name: /^Add/ }).click();
  await guest.locator("#cartbar").click();
  await guest.locator("#place").click();
  await expect(guest.locator("#track")).toContainText(/Order #1/);

  // The kitchen display has the ticket; cook it and serve it.
  await page.goto(`/projects/${project.id}/horeca/kitchen`);
  await expect(page.getByText("Filter coffee")).toBeVisible();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: "Mark ready" }).click();
  await page.getByRole("button", { name: "Served" }).click();
  await expect(page.getByText("All caught up")).toBeVisible();

  // Settle on the floor: menu prices are before 5% GST, rounded to the rupee.
  await page.goto(`/projects/${project.id}/horeca/floor`);
  await page.getByRole("button", { name: /^T1/ }).click();
  await expect(page.getByText("Total", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Settle ₹95" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Cash/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Take ₹95" }).click();
  await expect(page.getByText("Settled — table is free")).toBeVisible();
  await guest.close();
});
