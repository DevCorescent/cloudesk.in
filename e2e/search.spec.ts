import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Smart search: pages by the words people use, records across modules, and
// the Ask AI switch (which explains what it needs when no AI is connected).
test("smart search finds pages and records, and Ask AI says what it needs", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.47" });
  await signUp(page, "Sia Search", "sia.search@example.com");
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  await page.request.post(`/api/v1/orgs/${orgId}/crm/contacts`, { data: { name: "Meera Kapoor", email: "meera@kapoor.in" }, headers: { origin: "http://localhost:3100" } });

  await page.goto("/home");
  await page.getByRole("button", { name: "Search or run a command" }).click();
  const dlg = page.getByRole("dialog", { name: "Search" });
  await expect(dlg).toBeVisible();
  // The field takes no heavy focus ring of its own.
  await expect(dlg.getByLabel("Search", { exact: true })).toHaveCSS("outline-style", "none");

  // "salary" finds payroll through the words people use for it.
  await dlg.getByLabel("Search", { exact: true }).fill("salary");
  await expect(dlg.getByRole("option", { name: /HR & payroll/ })).toBeVisible();

  // Records from the workspace, ready to open.
  await dlg.getByLabel("Search", { exact: true }).fill("meera");
  await expect(dlg.getByRole("option", { name: /Meera Kapoor/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/crm\/contacts\/[0-9a-f-]+$/);

  // Ask AI with nothing connected: it says so and offers the fix.
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("switch", { name: "Ask AI" }).click();
  await expect(page.getByText("AI answers need an AI provider connected", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Connect an AI provider/ })).toBeVisible();
});
