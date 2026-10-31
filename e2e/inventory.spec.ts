import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Inventory: add an item and a supplier, raise a purchase order, send it
// (honestly not emailed without a mail service), receive the goods, and count.
test("buy, receive and count stock", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.14" });
  await signUp(page, "Ravi Stock", "ravi.inventory@example.com");

  await page.goto("/inventory");
  await expect(page.getByRole("heading", { name: "Inventory", exact: true })).toBeVisible();
  await expect(page.getByText("Add items by hand")).toBeVisible();

  // An item.
  await page.getByRole("button", { name: "New item" }).first().click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Shipping box — medium");
  await dlg.getByLabel("SKU").fill("BOX-M");
  await dlg.getByLabel("Reorder at").fill("50");
  await dlg.getByLabel("Order this many").fill("200");
  await dlg.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("heading", { name: "Shipping box — medium" })).toBeVisible();

  // A supplier.
  await page.goto("/inventory/suppliers");
  await page.getByRole("button", { name: "New supplier" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Sharma Packaging");
  await dlg.getByLabel("GSTIN").fill("27AAJFS2290K1ZQ");
  await expect(dlg.getByLabel("State code")).toHaveValue("MH");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Sharma Packaging")).toBeVisible();

  // A purchase order: 200 boxes at ₹24 + 18% GST.
  await page.goto("/inventory/orders/new");
  await page.getByLabel("Supplier").selectOption({ label: "Sharma Packaging" });
  await page.getByLabel("Add an item").selectOption({ label: "Shipping box — medium — running low" });
  await page.getByLabel("Rate for Shipping box — medium").fill("24");
  await expect(page.getByText("₹5,664", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create purchase order" }).click();
  await expect(page.getByRole("heading", { name: "PO-0001" })).toBeVisible();

  // Sending without a mail service says so.
  await page.getByRole("button", { name: "Send to supplier" }).click();
  await expect(page.getByText("Marked as sent — not emailed")).toBeVisible();

  // Receive 150 of 200.
  await page.getByRole("button", { name: "Receive goods" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Received of Shipping box — medium").fill("150");
  await dlg.getByRole("button", { name: "Receive" }).click();
  await expect(page.getByText("Part received").first()).toBeVisible();
  await page.goto("/inventory/items");
  const row = page.getByRole("row", { name: /Shipping box — medium/ });
  await expect(row).toContainText("150");
  await expect(row).toContainText("50"); // still on order

  // Count: 148 on the shelf.
  await page.goto("/inventory/counts");
  await page.getByLabel("Counted Shipping box — medium").fill("148");
  await expect(page.getByText(/−₹48/)).toBeVisible();
  await page.getByRole("button", { name: "Save count" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save count" }).click();
  await page.goto("/inventory/items");
  await expect(page.getByRole("row", { name: /Shipping box — medium/ })).toContainText("148");
});
