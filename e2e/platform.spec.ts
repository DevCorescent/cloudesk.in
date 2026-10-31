import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";
import { config } from "dotenv";
import { Pool } from "pg";

// Identity (a domain to verify with its DNS record), the workspace page
// (export, support access), and the platform console for a platform admin.
config({ path: ".env.local", quiet: true });
const pool = new Pool({ connectionString: process.env.E2E_DATABASE_URL });
test.afterAll(() => pool.end());

test("identity, workspace lifecycle and the platform console", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.42" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Priya Platform", "priya@platformco.example");

  await page.goto("/settings/identity");
  await page.getByLabel("Domain", { exact: true }).fill("platformco.example");
  await page.getByRole("button", { name: "Add domain" }).click();
  await expect(page.getByLabel("TXT name for platformco.example")).toHaveValue("_cloudesk.platformco.example");
  await expect(page.getByLabel("TXT value for platformco.example")).toHaveValue(/^cloudesk-verify=/);
  await page.getByRole("button", { name: "Check now" }).click();
  await expect(page.getByText(/No TXT record _cloudesk.platformco.example/)).toBeVisible();

  await page.goto("/settings/workspace");
  await page.getByLabel("Why").fill("Testing support access");
  await page.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText(/“Testing support access”/)).toBeVisible();
  await page.getByRole("button", { name: "Make an export" }).click();
  await expect(page.getByText("being made…").or(page.getByRole("link", { name: "Download" }))).toBeVisible();

  // The console doesn't exist until this person is a platform admin.
  await page.goto("/admin");
  await expect(page.getByText("Not available")).toBeVisible();
  await pool.query("update users set is_platform_admin = true where email = $1", ["priya@platformco.example"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();
  await page.getByRole("navigation", { name: "Admin sections" }).getByRole("button", { name: "Workspaces" }).click();
  await page.getByLabel("Search workspaces").fill("priya");
  await page.getByRole("cell", { name: /Priya/ }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/Support access until/)).toBeVisible();
  // The workspace's subscription: on the free trial; extend it from the Subscriptions drawer.
  await expect(dlg.getByTestId("subscription-summary")).toContainText("Free trial");
  await dlg.getByRole("button", { name: "Manage subscription" }).click();
  const drawer = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Extend trial" }) });
  await drawer.getByRole("button", { name: "+7" }).click();
  await drawer.getByRole("button", { name: "Extend trial" }).click();
  await expect(page.getByText("Trial extended by 7 days")).toBeVisible();
});
