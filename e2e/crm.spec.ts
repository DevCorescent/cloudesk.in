import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// CRM: add a contact, log a call, open a deal from them, drag it across the
// board, lose one with a reason, and import a spreadsheet.
test("work a lead from contact to won deal, and import contacts", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.11" });
  await signUp(page, "Tara Shah", "tara.crm@example.com");

  await page.goto("/crm");
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening), Tara/ })).toBeVisible();
  await expect(page.getByText("Get going in three steps")).toBeVisible();

  // Add a contact from the New menu.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Contact" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Imran Sheikh");
  await dlg.getByLabel("Company").fill("Delta Labs");
  await dlg.getByLabel("Email").fill("imran@deltalabs.in");
  await dlg.getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByRole("heading", { name: "Imran Sheikh" })).toBeVisible();
  await expect(page.getByText("Delta Labs").first()).toBeVisible();

  // Adding the same email again points to them instead of duplicating.
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "Contact" }).click();
  await page.getByRole("dialog").getByLabel("Email").fill("IMRAN@deltalabs.in");
  await page.getByRole("dialog").getByRole("button", { name: "Add contact" }).click();
  await expect(page.getByText(/is already in your CRM/)).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  // Log a call.
  await page.getByRole("tab", { name: "Call" }).click();
  await page.getByLabel("Details").fill("Wants a pilot for 50 people in December");
  await page.getByRole("button", { name: "Log call" }).click();
  await expect(page.getByText("Wants a pilot for 50 people in December")).toBeVisible();

  // A deal from the contact page.
  await page.getByRole("button", { name: "More" }).first().click();
  await page.getByRole("menuitem", { name: "New deal" }).click();
  await page.getByRole("dialog").getByLabel("Deal name").fill("Delta — December pilot");
  await page.getByRole("dialog").getByLabel(/Value/).fill("150000");
  await page.getByRole("dialog").getByRole("button", { name: "Create deal" }).click();
  await expect(page.getByRole("heading", { name: "Delta — December pilot" })).toBeVisible();
  await expect(page.getByText("₹1,50,000.00").or(page.getByText("₹1,50,000"))).toBeVisible();

  // Drag it on the board from New lead to Qualified.
  await page.goto("/crm/deals");
  const card = page.getByRole("link", { name: "Delta — December pilot" });
  await expect(card).toBeVisible();
  await card.locator("xpath=ancestor::li[1]").dragTo(page.getByRole("region", { name: "Qualified" }));
  await expect(page.getByRole("region", { name: "Qualified" }).getByRole("link", { name: "Delta — December pilot" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Qualified" }).getByRole("link", { name: "Delta — December pilot" })).toBeVisible();

  // Win it from the deal page; the contact becomes a customer.
  await card.click();
  await page.getByRole("button", { name: "Won" }).click();
  await expect(page.getByText(/^Won \d/)).toBeVisible();
  await page.getByRole("link", { name: /Imran Sheikh/ }).click();
  await expect(page.locator("header").getByText("Customer").first()).toBeVisible();

  // Import a spreadsheet.
  await page.goto("/crm/contacts");
  await page.getByRole("button", { name: "Import & export" }).click();
  await page.getByRole("menuitem", { name: "Import a spreadsheet" }).click();
  await page.getByRole("dialog").locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from("Full Name,E-mail,Mobile,Company\nRiya Kapoor,riya@acme.in,9820011111,Acme Foods\nImran S,imran@deltalabs.in,,Delta Labs\n") });
  // Columns are matched by their headings.
  await expect(page.getByRole("combobox", { name: "Column for Name" }).locator("option:checked")).toHaveText("Full Name");
  await expect(page.getByRole("combobox", { name: "Column for Phone" }).locator("option:checked")).toHaveText("Mobile");
  await page.getByRole("button", { name: "Check 2 rows" }).click();
  await page.getByRole("button", { name: "Import 2 contacts" }).click();
  await expect(page.getByText("added")).toBeVisible();
  await expect(page.getByRole("dialog").getByText("1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.locator("tbody").getByText("Riya Kapoor", { exact: true })).toBeVisible();

  // Reports open with the win counted.
  await page.goto("/crm/reports");
  await expect(page.getByText("Win rate").first()).toBeVisible();
  await expect(page.getByText("100%").first()).toBeVisible();
});
