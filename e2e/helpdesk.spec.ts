import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A phone ticket logged, answered by email, the customer replying and rating
// it on their own link (which never shows internal notes), and a saved reply.
test("log a ticket, reply, and the customer answers and rates it on their link", async ({ page, browser }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.37" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Hari Helpdesk", "hari.hd@example.com");

  await page.goto("/helpdesk/canned");
  await page.getByRole("button", { name: "New saved reply" }).click();
  await page.getByLabel("Title").fill("Sorted");
  await page.getByLabel("Reply").fill("Hi {{name}}, {{ticket}} is sorted now.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Hi {{name}}, {{ticket}} is sorted now.")).toBeVisible();

  await page.goto("/helpdesk/tickets/new");
  await page.getByLabel("Subject").fill("Printer offline at billing counter");
  await page.getByLabel("What they said").fill("The receipt printer shows offline since morning.");
  await page.getByLabel("Customer name").fill("Meera Iyer");
  await page.getByLabel("Customer email").fill("meera@cafe.example");
  await page.getByLabel("Priority").selectOption("high");
  await page.getByRole("button", { name: "Log ticket" }).click();
  await expect(page.getByRole("heading", { name: "Printer offline at billing counter" })).toBeVisible();

  await page.getByRole("tab", { name: "Internal note" }).click();
  await page.getByLabel("Note", { exact: true }).fill("Checked the cable — internal only");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText("Checked the cable — internal only")).toBeVisible();
  await page.getByRole("tab", { name: "Reply to customer" }).click();
  await page.getByLabel("Saved reply").selectOption({ label: "Sorted" });
  await expect(page.getByLabel("Reply", { exact: true })).toHaveValue(/Hi Meera, HD-0001 is sorted now\./);
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Waiting on customer").first()).toBeVisible();

  // The customer's link, opened without signing in.
  const link = await page.evaluate(async () => {
    const id = location.pathname.split("/").pop();
    const org = (await (await fetch("/api/v1/auth/me")).json()).organizations[0].id;
    return (await (await fetch(`/api/v1/orgs/${org}/helpdesk/tickets/${id}`)).json()).link as string;
  });
  const guest = await browser.newPage();
  await guest.goto(new URL(link).pathname);
  await expect(guest.getByRole("heading", { name: "Printer offline at billing counter" })).toBeVisible();
  await expect(guest.getByText("Hi Meera, HD-0001 is sorted now.")).toBeVisible();
  await expect(guest.getByText("internal only")).toHaveCount(0);
  await guest.getByLabel("Your reply").fill("Works now, thank you!");
  await guest.getByRole("button", { name: "Send" }).click();
  await expect(guest.getByText("Works now, thank you!")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Works now, thank you!")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("ticket.png") });
  await page.getByLabel("Status", { exact: true }).selectOption("resolved");
  await expect(page.getByText("Open → Resolved").first()).toBeVisible();

  await guest.reload();
  await guest.getByRole("radio", { name: "5 out of 5" }).click();
  await guest.getByRole("button", { name: "Send rating" }).click();
  await expect(guest.getByRole("heading", { name: "Thanks for your rating" })).toBeVisible();
  await guest.close();

  await page.goto("/helpdesk/reports");
  await expect(page.getByText("5/5 (1 rated)")).toBeVisible();
});
