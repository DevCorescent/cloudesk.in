import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// In-store selling: barcodes, the till with a (simulated) USB scanner, cash
// change, the oversell confirmation, the receipt and the day's summary.
test("sell in the shop with a barcode scanner", async ({ page }) => {
  await signUp(page, "Kiran Till", "till@example.com");
  const origin = new URL(page.url()).origin;
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  const { project } = await (await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "Corner Shop" }, headers: { origin } })).json();
  const store = (method: string, path: string, data?: unknown) => page.request.fetch(`/api/v1/projects/${project.id}/store/${path}`, { method, data, headers: { origin } }).then((r) => r.json());
  await store("POST", "setup", { name: "Corner Shop", template: "home", country: "IN", region: "Karnataka", replaceDesign: true });
  const row = (title: string, price: number, stock: number, sku = "") => ({ title, description: "", category: "", tags: [], vendor: "", images: [], hsn: "", active: true, options: [], variants: [{ options: {}, price, compareAt: null, cost: null, sku, stock, weightGrams: null }] });
  expect(await store("POST", "import/smart", { products: [row("Sage Mug", 45000, 5), row("Brass Diya", 129900, 1, "DIYA-1")] })).toMatchObject({ imported: 2 });

  // Barcodes are generated from Labels & barcodes.
  await page.goto(`/projects/${project.id}/store/labels`);
  await page.getByRole("button", { name: /Create 2 missing barcodes/ }).click();
  await expect(page.getByText("Created 2 barcodes")).toBeVisible();
  // Printing opens an exact preview of the print document first.
  await expect(page.frameLocator('iframe[title="Label preview"]').getByText("Brass Diya")).toBeVisible();
  await page.getByRole("button", { name: "Print 2 labels" }).click();
  const preview = page.getByRole("dialog", { name: "Print preview" });
  await expect(preview.getByText("2 labels · Thermal roll · 50 × 25 mm")).toBeVisible();
  await expect(preview.frameLocator('iframe[title="Labels to print"]').getByText("₹1,299")).toBeVisible();
  await expect(preview.getByRole("button", { name: "Print", exact: true })).toBeEnabled();
  await preview.getByRole("button", { name: "Cancel" }).click();
  const catalog = await store("GET", "pos");
  const mugCode = catalog.products.find((p: { title: string }) => p.title === "Sage Mug").variants[0].barcode as string;
  expect(mugCode).toMatch(/^20\d{11}$/);

  // The till: a scanner types the code and presses Enter.
  await page.locator("#main").getByRole("link", { name: "Point of sale" }).click();
  await page.waitForURL(/\/pos$/);
  await expect(page.getByRole("button", { name: /Sage Mug/ })).toBeVisible();
  await page.keyboard.type(`2*${mugCode}`);
  await page.keyboard.press("Enter");
  await page.keyboard.type("diya-1");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Complete sale · ₹2,199.00" })).toBeVisible();
  await page.getByLabel("Cash received").fill("2000");
  await expect(page.getByText("Short ₹199.00")).toBeVisible();
  await expect(page.getByRole("button", { name: /Complete sale/ })).toBeDisabled();
  await page.getByLabel("Cash received").fill("2500");
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.getByText("Give change: ₹301.00")).toBeVisible();
  await expect(page.getByText(/INV\/\d{4}-\d{2}\/0001/)).toBeVisible();
  const receipt = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Receipt" }).click();
  const r = await receipt;
  await expect(r.getByText("Paid by cash")).toBeVisible();
  await r.close();

  // Scanning straight away starts the next sale. The diya is now out of stock, so selling it again asks first.
  await page.keyboard.type("DIYA-1");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Sale complete")).toBeHidden();
  await expect(page.getByRole("button", { name: "Complete sale · ₹1,299.00" })).toBeVisible();
  await page.getByRole("radio", { name: /Card/ }).click();
  await page.getByRole("button", { name: /Complete sale/ }).click();
  await expect(page.getByText("Sell more than the recorded stock?")).toBeVisible();
  await page.getByRole("button", { name: "Sell anyway" }).click();
  await expect(page.getByText("Sale complete")).toBeVisible();
  await page.getByRole("button", { name: "New sale" }).click();

  await page.getByRole("button", { name: /Today/ }).click();
  const today = page.getByRole("dialog", { name: "Today at the till" });
  await expect(today.getByText("Items sold")).toBeVisible();
  await expect(today.getByText("₹3,498.00").first()).toBeVisible(); // net sales
  await expect(today.getByText("INV/", { exact: false })).toHaveCount(2);
});
