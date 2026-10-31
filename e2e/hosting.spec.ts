import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Hosting & publishing: each external host shows whether it's connected, has a
// step-by-step guide, and connects through a wizard. No real provider is
// called here — the checks below stop at our own validation.
test("connect Cloudflare Pages through the guided setup", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.62" });
  await signUp(page, "Hana Host", "hana.host@example.com");
  const headers = { origin: "http://localhost:3100" };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const pid = (await (await page.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "blank", name: "Hana Site" }, headers })).json()).project.id;
  expect((await page.request.post(`/api/v1/projects/${pid}/deployments`, { data: { environment: "production" }, headers })).ok()).toBe(true);

  await page.goto(`/projects/${pid}/deployments`);
  await expect(page.getByRole("heading", { name: "Hosting & publishing" })).toBeVisible();
  const tile = page.getByTestId("host-cloudflare");
  await expect(tile.getByText("Not connected")).toBeVisible();

  // The guide lays out every step, with links to the provider.
  await tile.getByRole("button", { name: "Cloudflare Pages guide" }).click();
  const guide = page.getByRole("dialog", { name: /Cloudflare Pages: how it works/ });
  await expect(guide.getByText("Find your account ID")).toBeVisible();
  await expect(guide.getByRole("link", { name: /Create a Cloudflare token/ })).toHaveAttribute("href", "https://dash.cloudflare.com/profile/api-tokens");
  await guide.getByRole("button", { name: "Start setup" }).click();

  const wiz = page.getByRole("dialog", { name: "Connect Cloudflare Pages" });
  await wiz.getByRole("button", { name: "I'm ready" }).click();
  await expect(wiz.getByText("Account · Cloudflare Pages · Edit", { exact: false })).toBeVisible();
  await wiz.getByRole("button", { name: "I have a token" }).click();
  await wiz.getByLabel("Access token").fill("cf-test-token");
  await wiz.getByLabel("Account ID").fill("not-an-id");
  await wiz.getByLabel("Project name").fill("hana-site");
  await wiz.getByRole("button", { name: "Check connection" }).click();
  await expect(wiz.getByText(/account ID is 32 letters and numbers/)).toBeVisible();

  await wiz.getByLabel("Account ID").fill("0123456789abcdef0123456789abcdef");
  await wiz.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(wiz.getByText("Cloudflare Pages is connected")).toBeVisible();
  await expect(wiz.getByText("Use your own domain (optional)")).toBeVisible();
  await wiz.getByRole("button", { name: "Done" }).click();

  await expect(tile.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("· Cloudflare Pages · hana-site")).toBeVisible();
  // The token never comes back to the browser.
  const list = await (await page.request.get(`/api/v1/projects/${pid}/export/targets`)).text();
  expect(list).not.toContain("cf-test-token");
});
