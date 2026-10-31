import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A PDF uploaded to the library, sent for signature, signed by link (no
// account needed), and a contract registered and approved.
test("upload, sign by link, and a contract approved", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.32" });
  await signUp(page, "Dev Docs", "dev.docs@example.com");

  await page.goto("/documents/library");
  await page.getByRole("button", { name: "Upload" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("File").setInputFiles({ name: "Service agreement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n") });
  await expect(dlg.getByLabel("Title")).toHaveValue("Service agreement");
  await dlg.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByRole("heading", { name: "Service agreement" })).toBeVisible();

  await page.getByRole("button", { name: "Send for signature" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Signer 1 name").fill("Rohan Mehta");
  await dlg.getByLabel("Signer 1 email").fill("rohan@lumen.example");
  await dlg.getByRole("button", { name: "Send" }).click();
  await expect(dlg.getByText("Email isn't set up — send these links yourself")).toBeVisible();
  const url = (await dlg.getByText(/\/sign\//).textContent())!.trim();
  await dlg.getByRole("button", { name: "Done" }).click();

  await page.goto(new URL(url).pathname);
  await expect(page.getByRole("heading", { name: "Service agreement" })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open" }).click();
  await (await popup).close();
  await page.getByLabel("Type your full name to sign").fill("Rohan Mehta");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Sign", exact: true }).click();
  await expect(page.getByText("You've signed")).toBeVisible();

  await page.goto("/documents/signatures");
  await page.getByRole("tab", { name: "Signed" }).click();
  await page.getByText("Service agreement").click();
  await expect(page.getByRole("link", { name: "Certificate" })).toBeVisible();

  await page.goto("/documents/contracts");
  await page.getByRole("button", { name: "Contract", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title").fill("Office lease");
  await dlg.getByLabel("Counterparty").fill("Shree Estates");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Office lease" })).toBeVisible();
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Approved", { exact: true }).first()).toBeVisible();
});
