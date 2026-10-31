import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Horeca POS: staff unlock the till with their PIN, ring up a takeaway by
// code and take cash; cancelling a dish already sent to the kitchen needs a
// manager's PIN; the screen locks again on demand.
test("unlock with a PIN, sell on the POS, get a manager's OK and lock the till", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.10" });
  await signUp(page, "Ravi Menon", "ravi.pos@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const { project } = await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "Dosa Point" }, headers })).json();
  const h = (path: string, data?: unknown) => page.request.post(`/api/v1/projects/${project.id}/horeca/${path}`, { data, headers }).then((r) => r.json());

  await page.goto(`/projects/${project.id}/horeca`);
  await page.getByLabel("Venue name").fill("Dosa Point");
  await page.getByRole("button", { name: /Café/ }).click();
  await page.getByLabel("Tables to start with").fill("2");
  await page.getByRole("button", { name: "Set up Dosa Point" }).click();
  await expect(page.getByRole("heading", { name: /Dosa Point/ })).toBeVisible();

  const { category } = await h("categories", { name: "Dosas", station: "kitchen" });
  await h("menu-items", { categoryId: category.id, name: "Masala dosa", price: 12000, diet: "veg", code: "MD" });
  const { staff: owner } = await h("staff", { name: "Lata", role: "manager", pin: "2468" });
  const { staff: waiter } = await h("staff", { name: "Sunil", role: "waiter", pin: "1357" });

  // With staff on the till, the dashboard opens on the lock screen.
  await page.goto(`/projects/${project.id}/horeca/pos`);
  const locked = page.getByRole("dialog", { name: "Locked" });
  await expect(locked).toBeVisible();
  await locked.getByRole("button", { name: /Sunil/ }).click();
  for (const d of "1111") await locked.getByRole("button", { name: d, exact: true }).click();
  await locked.getByRole("button", { name: "Unlock" }).click();
  await expect(locked.getByText("That PIN isn't right")).toBeVisible();
  for (const d of "1357") await locked.getByRole("button", { name: d, exact: true }).click();
  await locked.getByRole("button", { name: "Unlock" }).click();
  await expect(locked).toBeHidden();

  // Takeaway by code: two masala dosas, no service charge, 5% GST.
  await page.getByRole("tab", { name: "Takeaway" }).click();
  const search = page.getByLabel("Search dishes or type a code");
  for (let i = 0; i < 2; i++) {
    await search.fill("MD");
    await search.press("Enter");
  }
  await page.getByRole("button", { name: "Send & pay" }).click();
  const pay = page.getByRole("dialog");
  await pay.getByRole("button", { name: "Cash", exact: true }).click();
  await pay.getByRole("button", { name: "Take ₹252" }).click();
  await expect(page.getByText("Settled", { exact: true })).toBeVisible();

  // A dine-in order; the waiter cancels a dish and a manager approves it.
  const tables = await (await page.request.get(`/api/v1/projects/${project.id}/horeca/tables`)).json();
  const t1 = tables.tables.find((t: { name: string }) => t.name === "T1");
  const item = (await (await page.request.get(`/api/v1/projects/${project.id}/horeca/menu`)).json()).items[0];
  await h("orders", { tableId: t1.id, lines: [{ itemId: item.id, qty: 1 }], staffId: owner.id });
  await page.goto(`/projects/${project.id}/horeca/floor`);
  await page.getByRole("button", { name: /^T1/ }).click();
  await page.getByRole("button", { name: "Update ▾" }).click();
  await page.getByRole("menuitem", { name: "Cancel item" }).click();
  await page.getByRole("button", { name: "Wrong item entered" }).click();
  await page.getByRole("button", { name: "Cancel it" }).click();
  const approval = page.getByRole("dialog", { name: "Manager approval" });
  await expect(approval).toBeVisible();
  for (const d of "2468") await approval.getByRole("button", { name: d, exact: true }).click();
  await approval.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByText("Cancelled: Wrong item entered")).toBeVisible();

  // The till records who did it.
  const events = await (await page.request.get(`/api/v1/projects/${project.id}/horeca/events`)).json();
  expect(JSON.stringify(events)).toContain("Sunil");
  expect(waiter.id).toBeTruthy();

  // Lock the screen.
  await page.getByRole("button", { name: "Lock", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Locked" })).toBeVisible();
});
