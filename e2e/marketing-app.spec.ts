import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A segment previewed and saved, an email campaign written and sent (the
// background worker finishes it), and an event with someone registering on
// its public page and being checked in.
test("segment, email campaign and an event", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.33" });
  await signUp(page, "Maya Marketer", "maya.mkt@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  await page.request.post(`/api/v1/orgs/${orgId}/crm/contacts`, { data: { name: "Asha Nair", email: "asha@lumen.example", marketing: true, tags: ["vip"] }, headers });

  await page.goto("/marketing/segments");
  await page.getByRole("button", { name: "Segment", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("VIPs");
  await dlg.getByLabel("Tagged with any of").fill("vip");
  await dlg.getByRole("button", { name: "Preview" }).click();
  await expect(dlg.getByText(/1 contact · 1 can be emailed/)).toBeVisible();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("tagged vip")).toBeVisible();

  await page.goto("/marketing/campaigns");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Diwali sale");
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Diwali sale" })).toBeVisible();
  await page.getByLabel("To", { exact: true }).selectOption({ label: "VIPs · 1 can be emailed" });
  await page.getByLabel("Subject", { exact: true }).fill("Our Diwali offers");
  await page.getByLabel("Message").fill("Hi {{first_name}}, see https://shop.example/diwali");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Goes to 1 person/)).toBeVisible();
  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByText("Sending to 1 person")).toBeVisible();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("Sent", { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });

  await page.goto("/marketing/campaigns");
  await page.getByRole("button", { name: "Campaign", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Product webinar");
  await dlg.getByLabel("Kind").selectOption({ label: "Event" });
  await dlg.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Product webinar" })).toBeVisible();
  const reg = (await page.getByTestId("reg-url").textContent())!.trim();
  const back = page.url();
  await page.goto(new URL(reg).pathname);
  await page.getByLabel("Your name").fill("Ravi Rao");
  await page.getByLabel("Email").fill("ravi@zen.example");
  await page.getByRole("button", { name: "Register" }).click();
  await expect(page.getByRole("heading", { name: "You're registered" })).toBeVisible();
  await page.goto(back);
  await page.getByRole("button", { name: "Check in Ravi Rao" }).click();
  await expect(page.getByText("Attended", { exact: true })).toBeVisible();
});
