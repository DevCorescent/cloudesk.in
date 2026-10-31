import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import { Pool } from "pg";
import { closeDb, codeFor, PASSWORD } from "./helpers";

// The partner program from the outside: apply on /partners with an emailed
// code, get approved, open the partner dashboard, and a partner link that
// remembers the code. (Commission, payouts and admin actions are covered by
// tests/integration/partners.test.ts.)
config({ path: ".env.local", quiet: true });
const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(async () => {
  await pool.end();
  await closeDb();
});

test("apply as an influencer, get approved, and use the partner dashboard", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.77.0.7" });
  const email = `creator.${Date.now()}@partners.example`;
  await page.goto("/partners");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Recommend Cloudesk");
  await page.getByRole("link", { name: /Become a partner/ }).first().click();
  await page.getByRole("button", { name: /^Influencer Creators on/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name or brand").fill("Riya Creates");
  await page.getByLabel("Phone").fill("+91 98765 43210");
  await page.getByLabel("City").fill("Mumbai");
  await page.getByLabel("Main platform").selectOption("Instagram");
  await page.getByLabel("Profile link").fill("https://instagram.com/riyacreates");
  await page.getByLabel("Followers").selectOption("50k–250k");
  await page.getByLabel("What's your content about?").fill("Small business money");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name", { exact: true }).fill("Riya Shah");
  await page.getByLabel("Email").fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Digit 1 of 6").fill(await codeFor(email));
  await expect(page.getByText("Application sent")).toBeVisible();

  await page.request.post("/api/v1/auth/login", { data: { email, password: PASSWORD }, headers: { origin: "http://localhost:3100" } });
  await page.goto("/partner");
  await expect(page.getByText("Your application is being reviewed")).toBeVisible();

  // A platform admin approves it (the console's buttons are covered by the integration tests).
  const { rows } = await pool.query<{ code: string }>("update partners set status = 'approved', approved_at = now() where email = $1 returning code", [email]);
  const code = rows[0]!.code;
  await page.reload();
  await expect(page.getByText("Available to withdraw")).toBeVisible();
  await expect(page.getByText(code).first()).toBeVisible();
  await page.getByRole("tab", { name: /Coupons & links/ }).click();
  await expect(page.getByRole("heading", { name: "Your coupon codes" })).toBeVisible();
  await page.getByRole("tab", { name: /Payouts/ }).click();
  await expect(page.getByRole("button", { name: "Withdraw" })).toBeDisabled();

  // The partner's link counts the visit and remembers the code.
  const visitor = await page.context().browser()!.newContext({ baseURL: "http://localhost:3100" });
  const v = await visitor.newPage();
  await v.goto(`/go/${code}?c=e2e&to=/pricing`);
  await expect(v).toHaveURL(/\/pricing$/);
  expect((await visitor.cookies()).find((c) => c.name === "cc_ref")?.value).toBe(encodeURIComponent(`${code}|e2e`));
  await visitor.close();
});
