import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";
import { Pool } from "pg";

// The platform control centre end to end: analytics, health, the go-live
// checklist, maintenance mode reaching a member's screen, sign-up rules,
// people and integrations.
test("run the platform from the control centre", async ({ page, browser }) => {
  const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.71" });
  await signUp(page, "Ola Operator", "ola@operator.example");
  await pool.query("update users set is_platform_admin = true where email = $1", ["ola@operator.example"]);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  // Overview: real counts and charts.
  await expect(page.getByText("Workspaces", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign-ups" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Admin sections" });

  // Health measures the live system.
  await nav.getByRole("button", { name: "Health" }).click();
  await expect(page.getByText("Largest tables")).toBeVisible();
  await expect(page.getByText(/Up to date|Pending/).first()).toBeVisible();

  // Go-live: not ready yet; a manual item can be confirmed.
  await nav.getByRole("button", { name: "Go-live" }).click();
  await expect(page.getByText(/things? to do before going live/)).toBeVisible();
  const backups = page.getByTestId("check-backups");
  await backups.getByRole("button", { name: "Mark done" }).click();
  await expect(backups.getByText(/Confirmed by ola@operator.example/)).toBeVisible();

  // Maintenance mode reaches a member's screen and pauses their changes.
  await nav.getByRole("button", { name: "Notices" }).click();
  await page.getByRole("switch", { name: "Maintenance mode" }).click();
  await page.getByLabel("Message").fill("Database upgrade until 10:15");
  await page.getByTestId("settings-maintenance").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Maintenance mode saved")).toBeVisible();

  const member = await browser.newPage({ extraHTTPHeaders: { "x-forwarded-for": "10.42.0.72" } });
  await signUp(member, "Mo Member", "mo@member.example");
  await member.goto("/home");
  await expect(member.getByRole("alert").filter({ hasText: "Database upgrade until 10:15" })).toBeVisible();
  const orgId = (await (await member.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const w = await member.request.post(`/api/v1/orgs/${orgId}/projects`, { data: { templateId: "blank", name: "Paused" }, headers: { origin: "http://localhost:3100" } });
  expect(w.status()).toBe(503);

  await page.getByRole("switch", { name: "Maintenance mode" }).click();
  await page.getByTestId("settings-maintenance").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Maintenance mode saved").last()).toBeVisible();
  await member.reload();
  await expect(member.getByText("Database upgrade until 10:15")).toHaveCount(0);

  // Sign-up rules.
  await nav.getByRole("button", { name: "Settings" }).click();
  await page.getByLabel("Who can sign up").selectOption("invite");
  await page.getByTestId("settings-signup").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Sign-up saved")).toBeVisible();
  const closed = await browser.newPage({ extraHTTPHeaders: { "x-forwarded-for": "10.42.0.73" } });
  const refused = await closed.request.post("/api/v1/auth/signup", { data: { name: "Uninvited", email: "u@nobody.example", password: "correct-horse-42" }, headers: { origin: "http://localhost:3100" } });
  expect(refused.status()).toBe(403);
  await page.getByLabel("Who can sign up").selectOption("open");
  await page.getByTestId("settings-signup").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Sign-up saved").last()).toBeVisible();

  // People: find the member and see their workspace.
  await nav.getByRole("button", { name: "People" }).click();
  await page.getByLabel("Search people").fill("mo@member");
  await page.getByRole("cell", { name: /Mo Member/ }).click();
  await expect(page.getByRole("dialog").getByText("Mo's workspace")).toBeVisible();
  await page.keyboard.press("Escape");

  // Integrations show what's configured, never values.
  await nav.getByRole("button", { name: "Integrations" }).click();
  await expect(page.getByTestId("integration-database").getByText("Connected")).toBeVisible();
  await expect(page.getByTestId("integration-database").getByRole("button", { name: "Manage" })).toBeVisible();

  // Integrations can be set up from the console with a guide; secrets are never shown back.
  await page.getByTestId("integration-email").getByRole("button", { name: "Set up" }).click();
  const setup = page.getByRole("dialog", { name: "Email delivery" });
  await expect(setup.getByText("Verify your sending domain")).toBeVisible();
  await setup.getByLabel("From address").fill("hello@operator.example");
  await setup.getByRole("button", { name: /^Save/ }).click();
  await expect(page.getByText(/Saved — active on every server/)).toBeVisible();
  await expect(setup.getByText(/Saved here/).first()).toBeVisible();
  await setup.getByRole("button", { name: "Clear" }).first().click();
  await expect(page.getByText("Cleared")).toBeVisible();
  await setup.getByRole("button", { name: "Done" }).click();

  // Revenue, module performance and scalability.
  await nav.getByRole("button", { name: "Revenue" }).click();
  await expect(page.getByText("Platform subscription revenue")).toBeVisible();
  await nav.getByRole("button", { name: "Modules" }).click();
  await expect(page.getByTestId("module-crm")).toBeVisible();
  await nav.getByRole("button", { name: "Scalability" }).click();
  await expect(page.getByRole("heading", { name: "Recommendations" })).toBeVisible();

  await nav.getByRole("button", { name: "Infrastructure" }).click();
  await expect(page.getByText("Ready for several servers?")).toBeVisible();
  await pool.end();
});
