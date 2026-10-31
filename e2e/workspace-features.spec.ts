import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Onboarding shapes the dashboard: a restaurant gets Horeca, not an online
// store; a switched-off feature can be switched on where it's needed, and
// Settings → Features changes the sidebar for the whole workspace.
test("a restaurant's workspace only has what it picked, and features switch on and off", async ({ page }) => {
  // Its own network address, so this account doesn't use up the other suites' sign-up allowance.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.11" });
  await signUp(page, "Ravi Nair", "ravi.features@example.com");

  await page.getByRole("button", { name: "Let's begin" }).click();
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
  await page.getByPlaceholder("Saffron House").fill("Masala Lane");
  await page.getByRole("radio", { name: /Restaurant/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("radio", { name: /Small/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "See my plan" }).click();
  await expect(page.getByRole("switch", { name: "Cloudesk for Horeca" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("switch", { name: "Online store" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Preview of your dashboard" })).toContainText("Cloudesk for Horeca");
  await page.getByRole("button", { name: /Set up my workspace/ }).click();

  // The venue is set up for real: tables with QR codes, ready for a menu.
  await expect(page.getByText("Your workspace is ready")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Open Cloudesk for Horeca" }).click();
  await page.waitForURL(/\/projects\/[0-9a-f-]+\/horeca$/);
  await expect(page.getByRole("heading", { name: /Masala Lane/ })).toBeVisible();
  await expect(page.getByText("0/10")).toBeVisible();
  // Inside a web app the sidebar is that web app's tools only.
  const nav = page.getByRole("navigation", { name: "Web app" });
  await expect(nav.getByRole("link", { name: "Restaurant & hotel" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Online store" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "AI IDE" })).toHaveCount(0);

  // A link to a switched-off feature invites you to switch it on.
  const project = page.url().replace(/\/horeca$/, "");
  await page.goto(`${project}/store`);
  await expect(page.getByRole("heading", { name: "Online store" })).toBeVisible();
  await expect(page.getByText("Not switched on")).toBeVisible();
  await page.getByRole("button", { name: "Switch on Online store" }).click();
  await expect(page.getByText("Not switched on")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Online store" })).toBeVisible();

  // Settings → Features switches it off again for the workspace.
  await page.goto("/settings/features");
  await page.getByRole("switch", { name: "Online store on" }).click();
  await expect(page.getByRole("switch", { name: "Online store off" })).toBeVisible();
  await page.goto(`${project}/store`);
  await expect(page.getByText("Not switched on")).toBeVisible();
});
