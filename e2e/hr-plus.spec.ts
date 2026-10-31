import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A night shift on the roster, overtime added for someone, a document that's
// expiring, and a position in the workforce plan opened for hiring.
test("roster, overtime, documents and the workforce plan", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.28" });
  await signUp(page, "Hari People", "hari.people@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const hr = (p: string) => `/api/v1/orgs/${orgId}/hr/${p}`;
  const meta = await (await page.request.get(hr("meta"))).json();
  await page.request.put(hr("settings"), { data: { overtime: { ...meta.settings.overtime, enabled: true } }, headers });
  await page.request.post(hr("people"), { data: { name: "Asha Nair", designation: "Engineer", joinDate: "2024-01-01", ctc: 1200000_00 }, headers });

  await page.goto("/hr/roster");
  await page.getByRole("button", { name: "Shift", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Night");
  await dlg.getByLabel("Starts").fill("22:00");
  await dlg.getByLabel("Ends").fill("06:00");
  await dlg.getByRole("button", { name: "Add" }).click();
  const cell = page.getByRole("combobox", { name: /^Asha Nair on / }).first();
  await cell.selectOption({ label: "Night" });
  await expect(cell).toHaveValue(/.{36}/);

  await page.goto("/hr/overtime");
  await page.getByRole("button", { name: "Add overtime" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Hours").fill("1.5");
  await dlg.getByRole("button", { name: "Add" }).click();
  await page.getByRole("tab", { name: "All" }).click();
  await expect(page.getByText(/Asha Nair/).first()).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();

  await page.goto("/hr/documents");
  await page.getByRole("button", { name: "Document", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Kind").selectOption({ label: "Visa / work permit" });
  await dlg.getByLabel("Title").fill("Work permit");
  await dlg.getByLabel("Valid to").fill("2026-11-15");
  await dlg.getByRole("button", { name: "Add" }).click();
  await page.getByRole("switch", { name: "Expiring in 30 days" }).click();
  await expect(page.getByText("Work permit", { exact: true })).toBeVisible();

  await page.goto("/hr/workforce");
  await page.getByRole("button", { name: "Position" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Role").fill("Engineer");
  await dlg.getByLabel("How many").fill("3");
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("row", { name: /Engineer/ })).toContainText("2");
  await page.getByRole("button", { name: "Hire" }).click();
  await page.waitForURL(/\/hr\/hiring$/);
  await expect(page.getByText("Engineer").first()).toBeVisible();
});
