import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A webhook added (its secret shown once), an API key made and used against
// the ERP API, then revoked.
test("webhooks and the ERP API", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.41" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Ira Integrations", "ira.hub@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  await page.request.get(`/api/v1/orgs/${orgId}/crm/meta`);
  await page.request.post(`/api/v1/orgs/${orgId}/crm/contacts`, { data: { name: "Asha Kulkarni", email: "asha@lumen.example" }, headers });

  await page.goto("/settings/integrations");
  await page.getByRole("button", { name: "Add a webhook" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Address (https://…)").fill("https://erp.example.com/cloudesk");
  await dlg.getByText("crm.contact.created").click();
  await dlg.getByRole("button", { name: "Add" }).click();
  await expect(dlg.getByLabel("signing secret")).toHaveValue(/^whsec_/);
  await dlg.getByRole("button", { name: "Done" }).click();
  await expect(page.getByText("https://erp.example.com/cloudesk")).toBeVisible();

  await page.getByRole("tab", { name: "API keys" }).click();
  await page.getByRole("button", { name: "Create a key" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Reporting");
  await dlg.getByText("contacts:read").click();
  await dlg.getByRole("button", { name: "Create" }).click();
  const key = await dlg.getByLabel("API key").inputValue();
  expect(key).toMatch(/^ck_org_/);
  await dlg.getByRole("button", { name: "Done" }).click();

  const res = await page.request.get("/api/v1/erp/contacts", { headers: { authorization: `Bearer ${key}` } });
  expect(res.status()).toBe(200);
  expect(res.headers()["cloudesk-version"]).toBe("2026-10-25");
  expect((await res.json()).data[0]).toMatchObject({ name: "Asha Kulkarni", email: "asha@lumen.example" });

  await page.getByRole("button", { name: "Revoke" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/v1/erp/contacts", { headers: { authorization: `Bearer ${key}` } })).status()).toBe(401);
});
