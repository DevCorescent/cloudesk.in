import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./helpers";

const PASSWORD = "correct-horse-42";
const OWNER = "shopkeeper@example.com";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(OWNER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/home$/);
}

test.describe.serial("online store", () => {
  let storeUrl = "";
  let liveUrl = "";
  let orderUrl = "";

  test("set up a store from a template, replace the samples and publish", async ({ page }) => {
    await signUp(page, "Meera Shah", OWNER);
    const me = await (await page.request.get("/api/v1/auth/me")).json();
    const created = await page.request.post(`/api/v1/orgs/${me.organizations[0].id}/projects`, { data: { templateId: "blank", name: "Little Joys" }, headers: { origin: new URL(page.url()).origin } });
    const { project } = await created.json();
    storeUrl = `/projects/${project.id}/store`;

    await page.goto(storeUrl);
    // A website project is offered "add it to this website" first; this test redesigns it as a store.
    await expect(page.getByRole("heading", { name: "Add an online store" })).toBeVisible();
    await page.getByRole("button", { name: "redesign this project as a store" }).click();
    await expect(page.getByRole("heading", { name: "Start selling online" })).toBeVisible();
    await page.getByRole("button", { name: /Gifts & hampers/ }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("State").selectOption("Maharashtra");
    await page.getByLabel("Order notification email").fill("orders@example.com");
    // The template replaces the design only after explicit confirmation.
    await expect(page.getByRole("button", { name: "Create my store" })).toBeDisabled();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Create my store" }).click();
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Get ready to sell")).toBeVisible();

    // Samples cannot be sold: confirm one as a real product and delete the rest.
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await expect(page.getByText(/sample products? from your template/)).toBeVisible();
    await page.getByRole("link", { name: /Celebration gift box/ }).click();
    await page.getByRole("switch", { name: "This is my real product" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Product saved")).toBeVisible();
    await page.getByRole("link", { name: "Products", exact: true }).click();
    await page.getByRole("button", { name: "Delete all samples" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete samples" }).click();
    await expect(page.getByRole("link", { name: /Celebration gift box/ })).toBeVisible();
    await expect(page.getByText(/sample products? from your template/)).toHaveCount(0);

    await page.goto(`/projects/${project.id}/deployments`);
    await page.getByRole("button", { name: "Deploy to production" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deploy" }).click();
    await expect(page.getByText("Live in production")).toBeVisible();
    liveUrl = (await page.getByRole("link", { name: /^\/s\// }).getAttribute("href"))!;
  });

  test("a shopper buys with cash on delivery", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(liveUrl);
    await expect(page.getByRole("link", { name: /Celebration gift box/ }).first()).toBeVisible();
    await page.getByRole("link", { name: "Shop all" }).first().click();
    await page.getByRole("link", { name: /Celebration gift box/ }).first().click();
    await expect(page.getByRole("heading", { name: "Celebration gift box" })).toBeVisible();
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
    await page.getByRole("link", { name: "Checkout" }).click();

    await page.getByLabel("Email", { exact: true }).fill("riya@example.com");
    await page.getByLabel("Phone", { exact: true }).fill("9876543210");
    await page.getByLabel("Full name").fill("Riya Iyer");
    await page.getByLabel("Address", { exact: true }).fill("4 Marine Drive");
    await page.getByLabel("City").fill("Mumbai");
    await page.getByLabel("State").selectOption("Maharashtra");
    await page.getByLabel("PIN code").fill("400020");
    await page.getByRole("button", { name: /Continue to delivery/ }).click();
    await expect(page.getByText("Cash on delivery")).toBeVisible();
    await page.getByRole("button", { name: /Place order/ }).click();
    await expect(page.getByRole("heading", { name: "Thank you! Your order is confirmed." })).toBeVisible();
    orderUrl = page.url();
    await ctx.close();
  });

  test("the owner ships it, and the shopper tracks it and asks for a return", async ({ page, browser }) => {
    await signIn(page);
    await page.goto(`${storeUrl}/orders`);
    await page.getByRole("link", { name: /^#\d+$/ }).first().click();
    await expect(page.getByText("Ready to pack (cash on delivery)")).toBeVisible();
    await page.getByRole("button", { name: "Ship with tracking" }).click();
    await page.getByLabel("Tracking number").fill("DL998877");
    await page.getByRole("dialog").getByRole("button", { name: "Mark shipped" }).click();
    await expect(page.getByText("On its way")).toBeVisible();

    const ctx = await browser.newContext();
    const shopper = await ctx.newPage();
    await shopper.goto(orderUrl);
    await expect(shopper.getByText("DL998877")).toBeVisible();
    await shopper.getByText("Request a return").click();
    await shopper.getByLabel(/Quantity to return of Celebration gift box/).selectOption("1");
    await shopper.getByRole("button", { name: "Send return request" }).click();
    await expect(shopper.getByText("Your return request was sent")).toBeVisible();
    await ctx.close();

    await page.goto(`${storeUrl}/returns`);
    await expect(page.getByText("Wrong size or fit")).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Return updated")).toBeVisible();
  });
});
