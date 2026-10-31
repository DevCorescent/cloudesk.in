import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Fields of your own on items with a rule, a bulk change and its undo, and an
// object of your own whose records link to items (shown on both ends).
test("custom fields, a rule, a bulk change undone, and a custom object linking to items", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.46" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Farah Fields", "farah.custom@example.com");

  const origin = { origin: "http://localhost:3100" };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const fan = (await (await page.request.post(`/api/v1/orgs/${orgId}/inventory/items`, { data: { name: "Ceiling fan", sku: "FAN-1" }, headers: origin })).json()).item.id;
  await page.request.post(`/api/v1/orgs/${orgId}/inventory/items`, { data: { name: "Wall clock", sku: "CLK-1" }, headers: origin });

  // Two fields on items.
  await page.goto("/settings/customise?entity=inventory.item");
  await page.getByRole("button", { name: "Add a field" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Grade");
  await dlg.getByLabel("Type").selectOption({ label: "One of a list" });
  await dlg.getByLabel("Choices").fill("A\nB\nC");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("grade · One of a list · A, B, C")).toBeVisible();
  await page.getByRole("button", { name: "Add a field" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Warranty months");
  await dlg.getByLabel("Type").selectOption({ label: "Number" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("warranty_months · Number")).toBeVisible();

  // A rule.
  await page.getByRole("tab", { name: "Rules" }).click();
  await page.getByRole("button", { name: "Add a rule" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Rule name").fill("Grade A needs a year");
  await dlg.getByRole("button", { name: "Add a condition" }).first().click();
  await dlg.getByLabel("When (all of these) field 1").selectOption({ label: "Grade" });
  await dlg.getByLabel("When (all of these) test 1").selectOption({ label: "is" });
  await dlg.getByLabel("When (all of these) value 1").fill("A");
  await dlg.getByLabel("Then this must be true field 1").selectOption({ label: "Warranty months" });
  await dlg.getByLabel("Then this must be true test 1").selectOption({ label: "is at least" });
  await dlg.getByLabel("Then this must be true value 1").fill("12");
  await dlg.getByLabel("Message when it isn't").fill("Grade A items carry at least 12 months' warranty");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("When Grade is A, Warranty months is at least 12.")).toBeVisible();

  // Filling them in on the item, with the rule refusing a short warranty.
  await page.goto(`/inventory/items/${fan}`);
  const card = page.getByLabel("Your fields");
  await card.getByRole("button", { name: "Edit" }).click();
  await card.getByLabel("Grade").selectOption("A");
  await card.getByLabel("Warranty months").fill("6");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Grade A items carry at least 12 months' warranty")).toBeVisible();
  await card.getByLabel("Warranty months").fill("12");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(card.getByText("12", { exact: true })).toBeVisible();

  // A bulk change on both items, then undone.
  await page.goto("/settings/customise?entity=inventory.item");
  await page.getByRole("tab", { name: "Records & bulk changes" }).click();
  await page.getByLabel("Select all").check();
  await page.getByRole("button", { name: "Change 2 selected" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Field").selectOption({ label: "Warranty months" });
  await dlg.getByLabel("Set it to").fill("24");
  await dlg.getByRole("button", { name: "Change 2" }).click();
  await expect(dlg.getByText("Changed 2.")).toBeVisible();
  await dlg.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("cell", { name: "24" })).toHaveCount(2);
  await page.getByRole("tab", { name: "Bulk history" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByText("Put back 2")).toBeVisible();
  await expect(page.getByText("Undone", { exact: true })).toBeVisible();

  // An object of our own whose records link to items.
  await page.goto("/objects");
  await page.getByRole("button", { name: "New object" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("One is called").fill("Site visit");
  await dlg.getByLabel("Several are called").fill("Site visits");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Site visits" })).toBeVisible();
  await page.getByRole("button", { name: "Add a field" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Site");
  await dlg.getByRole("switch").click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("site · Text")).toBeVisible();
  await page.getByRole("button", { name: "Add a field" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Item installed");
  await dlg.getByLabel("Type").selectOption({ label: "Link to a record" });
  await dlg.getByLabel("Links to").selectOption({ label: "Items" });
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("item_installed · Link to a record → Items")).toBeVisible();
  await page.getByRole("button", { name: "Settings" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Records are named by").selectOption({ label: "Site" });
  await dlg.getByRole("button", { name: "Save" }).click();

  await page.getByRole("tab", { name: /Records/ }).click();
  await page.getByRole("button", { name: "New site visit" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(dlg.getByText("Site is needed")).toBeVisible();
  await dlg.getByLabel("Site *").fill("Baner");
  await dlg.getByLabel("Item installed").fill("fan");
  await dlg.getByRole("option", { name: /Ceiling fan/ }).click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Baner" })).toBeVisible();
  await expect(page.locator("#main").getByText(/SIT-0001 · updated/)).toBeVisible();
  await page.getByRole("link", { name: "Ceiling fan" }).click();
  await expect(page.getByLabel("Your fields").getByRole("link", { name: "Site visit: Baner" })).toBeVisible();
});
