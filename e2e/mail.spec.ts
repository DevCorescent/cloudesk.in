import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Connecting a mailbox: the guided wizard for a custom server, and a server
// that doesn't answer explained in plain words. No real mail provider is
// contacted — the test points at a closed local port.
test("the connect wizard guides a custom mailbox and explains an unreachable server", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.201" });
  await signUp(page, "Mira Mail", "mira.mail@example.com");

  await page.goto("/mail");
  await page.getByRole("button", { name: "Connect your first mailbox" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Which email address do you want to connect?")).toBeVisible();
  await dialog.getByRole("button", { name: /Other \(IMAP \/ SMTP\)/ }).click();
  await dialog.getByRole("button", { name: /Continue/ }).click();

  // The provider's own steps, then the sign-in form with the server settings open.
  await expect(dialog.getByText("Find your server settings")).toBeVisible();
  await dialog.getByRole("button", { name: /I'm ready|Done — next/ }).click();
  await dialog.getByLabel("Email address").fill("mira@shop.example");
  await dialog.getByLabel("Password", { exact: true }).fill("not-a-real-password");
  await dialog.getByLabel("Incoming (IMAP) server").fill("127.0.0.1");
  await dialog.getByLabel("Outgoing (SMTP) server").fill("127.0.0.1");
  await dialog.getByLabel("Port").nth(0).fill("1");
  await dialog.getByLabel("Port").nth(1).fill("1");
  await dialog.getByRole("button", { name: /Test the connection/ }).click();

  // Local and private addresses are refused before any connection is tried (SSRF protection).
  await expect(dialog.getByText(/127\.0\.0\.1 isn't a public server/)).toHaveCount(2, { timeout: 30_000 });
  await expect(dialog.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Looks good/ })).toHaveCount(0);
});
