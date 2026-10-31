import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Without an AI provider the copilot says so plainly and can't be asked
// anything; with the module off it isn't in the menu. (Answers themselves are
// covered by integration tests against a stand-in model — no real API calls.)
test("the copilot asks for a provider before anything else", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.36" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Cora Copilot", "cora.copilot@example.com");

  await page.goto("/copilot");
  await expect(page.getByRole("heading", { name: "Ask the copilot" })).toBeVisible();
  await expect(page.getByText("No AI provider is connected")).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect a provider" })).toHaveAttribute("href", "/settings/ai");
  await expect(page.getByLabel("Your question")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  await page.getByRole("link", { name: "Conversations" }).click();
  await expect(page.getByText("No conversations yet.")).toBeVisible();

  // Accounts doesn't offer to read bills without a provider either.
  await page.goto("/accounts/bills");
  await expect(page.getByRole("button", { name: "New bill" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Read a bill" })).toHaveCount(0);
});
