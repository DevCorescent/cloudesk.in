import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Invoicing end to end: settings → invoice → share → client view → payment,
// and a quotation the client accepts online that becomes an invoice.
test("invoice and quote a client, and get paid", async ({ page, browser }) => {
  await signUp(page, "Kiran Mehta", "billing@example.com");
  const origin = new URL(page.url()).origin;
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const { project } = await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "North Studio" }, headers: { origin } })).json();
  const base = `/projects/${project.id}/invoicing`;

  // Business details: a bad GSTIN blocks saving and says why.
  await page.goto(`${base}/settings`);
  await page.getByLabel("GSTIN").fill("29ABCDE1234F1Z5");
  await expect(page.getByText("Fix the GSTIN first")).toBeVisible();
  await page.getByLabel("GSTIN").fill("29ABCDE1234F1ZW");
  await expect(page.getByText("Valid · Karnataka")).toBeVisible();
  await page.getByPlaceholder("yourname@okhdfcbank").fill("north@okhdfcbank");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // A professional design becomes the default.
  await page.goto(`${base}/templates`);
  await page.getByRole("button", { name: "Use" }).nth(1).click();
  await page.waitForURL(/templates\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Make default" }).click();
  await expect(page.getByText("Modern is now your default")).toBeVisible();

  // An invoice with GST worked out live.
  await page.goto(`${base}/invoices/new`);
  await page.getByRole("button", { name: "Save & issue invoice" }).click();
  await expect(page.getByText("Please fix these first")).toBeVisible();
  await page.getByLabel("Contact name *").fill("Ananya Iyer");
  await page.getByLabel("Company").fill("Lotus Hospitality");
  await page.getByLabel("GSTIN").fill("27AAPFU0939F1ZV");
  await page.getByLabel("Item 1 name").fill("Brand identity design");
  await page.getByLabel("Item 1 rate").fill("45000");
  await expect(page.getByText("Different state: charged as IGST.")).toBeVisible();
  await expect(page.getByText("₹53,100.00").first()).toBeVisible();
  await expect(page.frameLocator('iframe[title="Document preview"]').getByText("Brand identity design")).toBeVisible();
  await page.getByRole("button", { name: "Save & issue invoice" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: /^INV\/\d{4}-\d{2}\/0001$/ })).toBeVisible();

  // Sharing: link, WhatsApp text, and what the client sees.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const url = await dialog.locator("span.font-mono").first().innerText();
  expect(url).toMatch(/\/doc\/[\w-]+$/);
  await dialog.getByRole("tab", { name: /WhatsApp/ }).click();
  await expect(dialog.getByRole("textbox", { name: "Message" })).toHaveValue(/Please find invoice INV\/.+ for ₹53,100\.00/);
  await page.keyboard.press("Escape");
  const client = await browser.newPage();
  await client.goto(url);
  await expect(client.getByText("Pay ₹53,100.00 by UPI")).toBeVisible();
  await expect(client.getByText("Fifty Three Thousand One Hundred Rupees Only")).toBeVisible();

  // Recording part of the payment.
  await page.reload();
  await expect(page.getByText("Opened by client")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await page.getByLabel("Amount received").fill("20000");
  await page.getByRole("button", { name: /^Record ₹/ }).click();
  await expect(page.getByText("₹33,100.00 still due")).toBeVisible();
  await client.reload();
  await expect(client.getByText("Part paid")).toBeVisible();

  // A quotation the client accepts online, converted to an invoice.
  await page.goto(`${base}/quotes/new`);
  await page.getByLabel("Find a saved client").click();
  await page.getByRole("button", { name: /Lotus Hospitality/ }).click();
  await page.getByLabel("Item 1 name").fill("Website redesign");
  await page.getByLabel("Item 1 rate").fill("120000");
  await page.getByRole("button", { name: "Save & issue quotation" }).click();
  await page.waitForURL(/quotes\/[0-9a-f-]{36}$/);
  const quote = (await (await page.request.get(`/api/v1/projects/${project.id}/invoicing/documents?type=quote`)).json()).documents[0];
  await client.goto(quote.shareUrl);
  await client.getByPlaceholder("Your name").fill("Ananya Iyer");
  await client.getByRole("button", { name: "Accept quotation" }).click();
  await expect(client.getByText("you've accepted this quotation")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Accepted by", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Convert to invoice" }).click();
  await page.waitForURL(/invoices\/[0-9a-f-]{36}$/);
  await expect(page.getByText("From", { exact: true })).toBeVisible();

  // Reports add it all up.
  await page.goto(`${base}/reports`);
  await expect(page.getByText("Invoiced and collected, last 12 months")).toBeVisible();
  await expect(page.getByText("100%")).toBeVisible();
});
