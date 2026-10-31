import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A trip asked for, approved, given a per diem, the claim approved and the trip
// settled; then a company-card spend from an imported statement explained.
test("trips and company cards", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.30" });
  await signUp(page, "Ravi Traveller", "ravi.travel@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const meRes = await (await page.request.get("/api/v1/auth/me")).json();
  const orgId = meRes.organizations[0].id;
  const hr = (p: string) => `/api/v1/orgs/${orgId}/hr/${p}`;
  const emp = (await (await page.request.post(hr("people"), { data: { name: "Ravi Traveller", email: "ravi.travel@example.com", designation: "Consultant", joinDate: "2024-01-01", ctc: 900000_00 }, headers })).json()).employee;
  await page.request.post(hr(`people/${emp.id}/link`), { data: { userId: meRes.user.id }, headers });
  const meta = await (await page.request.get(hr("meta"))).json();
  await page.request.put(hr("settings"), { data: { expenses: { ...meta.settings.expenses, perDiem: { domestic: 1000_00, international: 0 } } }, headers });
  await page.request.get(`/api/v1/orgs/${orgId}/accounts/meta`);

  await page.goto("/hr/trips");
  await page.getByRole("button", { name: "New trip" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Destination").fill("Pune");
  await dlg.getByLabel("Purpose").fill("Client workshop");
  await dlg.getByLabel("Leaving").fill("2026-10-05");
  await dlg.getByLabel("Back").fill("2026-10-07");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: /Pune · TR-0001/ })).toBeVisible();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await page.getByRole("button", { name: "Approve trip" }).click();
  await page.getByRole("button", { name: /Per diem · ₹3,000/ }).click();
  await expect(page.getByText("Per diem", { exact: true })).toBeVisible();

  await page.goto("/hr/claims");
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("No claims waiting.")).toBeVisible();

  await page.goto("/hr/trips");
  await page.getByRole("tab", { name: "Mine" }).click();
  await page.getByText(/Pune/).first().click();
  await page.getByRole("button", { name: "Settle trip" }).click();
  dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: /Settle: pay ₹3,000/ })).toBeVisible();
  await dlg.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Settled").first()).toBeVisible();

  await page.goto("/hr/cards");
  await page.getByRole("button", { name: "Add card" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Card name").fill("HDFC Corporate");
  await dlg.getByLabel("Last four digits").fill("4321");
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(page.getByText(/HDFC Corporate ··4321/)).toBeVisible();
  const imp = await (await page.request.post(hr("card-txns-import"), { data: { rows: [{ date: "2026-10-12", amount: 2400_00, merchant: "IndiGo 6E-512", card: "4321", reference: "A1" }], mode: "add" }, headers })).json();
  expect(imp.created).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Explain IndiGo 6E-512" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("What was it for?").fill("Flight to Pune");
  await dlg.getByRole("button", { name: "Send" }).click();
  await page.getByRole("tab", { name: "All spends" }).click();
  await expect(page.getByText("Explained", { exact: true })).toBeVisible();
});
