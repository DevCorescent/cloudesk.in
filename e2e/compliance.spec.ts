import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// The statutory calendar added and a filing marked with its ARN, a risk on the
// heat map, a policy published and acknowledged, and an incident reported.
test("calendar, risk, policy and incident", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.39" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Chitra Compliance", "chitra.grc@example.com");

  await page.goto("/compliance/calendar");
  await page.getByRole("button", { name: "Add Indian statutory dates" }).click();
  await expect(page.getByText(/GSTR-3B \(summary return and tax\)/).first()).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "GSTR-3B" }).first().getByRole("button", { name: "Mark" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Reference (ARN, challan or acknowledgement no.)").fill("AA271026123456X");
  await dlg.getByRole("button", { name: "Save" }).click();
  await page.getByRole("tab", { name: "Last 30 and next 60 days" }).click();
  await expect(page.getByText(/AA271026123456X/)).toBeVisible();

  await page.goto("/compliance/risks");
  await page.getByRole("button", { name: "New risk" }).click();
  const r = page.getByRole("dialog");
  await r.getByLabel("Risk", { exact: true }).fill("Customer data leaked from a lost laptop");
  await r.getByLabel("Likelihood (1–5)").selectOption("4");
  await r.getByLabel("Impact (1–5)").selectOption("5");
  await expect(r.getByText("Inherent score 20 — critical")).toBeVisible();
  await r.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: /Customer data leaked/ })).toBeVisible();
  await page.goto("/compliance");
  await expect(page.getByRole("figure", { name: "Risk heat map" })).toBeVisible();
  await expect(page.getByTitle("Likelihood 4, impact 5: 1 risk(s)")).toHaveText("1");

  await page.goto("/compliance/policies");
  await page.getByRole("button", { name: "New policy" }).click();
  const p = page.getByRole("dialog");
  await p.getByLabel("Title").fill("Laptop security");
  await p.getByLabel("Policy", { exact: true }).fill("Encrypt your disk. Lock your screen when you step away.");
  await p.getByRole("button", { name: "Save" }).click();
  await page.getByText("Laptop security").click();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.getByRole("button", { name: "I have read and understood this policy" }).click();
  await expect(page.getByText(/You acknowledged this version/)).toBeVisible();

  await page.goto("/compliance/incidents/new");
  await page.getByLabel("What happened").fill("Laptop stolen from car");
  await page.getByLabel("How serious").selectOption("high");
  await page.getByLabel("Details").fill("Bag taken from the back seat at a petrol pump.");
  await page.getByRole("switch", { name: "Personal data may be involved" }).click();
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Laptop stolen from car" })).toBeVisible();
  await expect(page.getByText(/CERT-In/)).toBeVisible();
});
