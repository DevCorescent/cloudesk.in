import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A carrier with a rate card, a shipment priced from it, moved along and
// delivered with proof, the customer's tracking page, and a vehicle's fuel
// log giving its mileage.
test("carrier rates, a shipment to the door, and fuel", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.34" });
  await signUp(page, "Lata Logistics", "lata.lgx@example.com");

  await page.goto("/logistics/carriers");
  await page.getByRole("button", { name: "Carrier", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("VRL Logistics");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByRole("button", { name: "Rate", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Per kg (₹)").fill("10");
  await dlg.getByLabel("Minimum (₹)").fill("100");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Any → Any")).toBeVisible();

  await page.goto("/logistics/shipments");
  await page.getByRole("button", { name: "Shipment", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Consignee").fill("Lumen Labs");
  await dlg.getByLabel(/^State/).fill("Karnataka");
  await dlg.getByLabel("Weight (kg)").fill("50");
  await dlg.getByRole("button", { name: "Estimate from the rate card" }).click();
  await expect(dlg.getByText("Rate card: ₹500")).toBeVisible();
  await dlg.getByRole("button", { name: "Make shipment" }).click();
  await expect(page.getByRole("heading", { name: "SHP-0001 · Lumen Labs" })).toBeVisible();
  await page.getByLabel("Move it along").selectOption({ label: "In transit" });
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("In transit", { exact: true }).first()).toBeVisible();
  const track = (await page.getByTestId("track-url").textContent())!.trim();
  await page.getByRole("button", { name: "Delivered" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Received by").fill("Meera at the store");
  await dlg.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText("Meera at the store").first()).toBeVisible();
  await page.goto(new URL(track).pathname);
  await expect(page.getByRole("heading", { name: "Delivered" })).toBeVisible();
  await expect(page.getByText(/received by Meera at the store/)).toBeVisible();

  await page.goto("/logistics/vehicles");
  await page.getByRole("button", { name: "Vehicle", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Registration number").fill("mh12 ab 1234");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByText("MH12 AB 1234").click();
  for (const [litres, odo] of [["40", "1000"], ["30", "1360"]]) {
    await page.getByRole("button", { name: "Fuel", exact: true }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Litres").fill(litres);
    await dlg.getByLabel("Amount (₹)").fill(String(Number(litres) * 100));
    await dlg.getByLabel(/^Odometer/).fill(odo);
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(dlg).toHaveCount(0);
  }
  await expect(page.getByText("12 km/l")).toBeVisible();
});
