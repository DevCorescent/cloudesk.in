import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A project's schedule (linking tasks and pushing the late one), an expense
// with markup, a change request approved, and booking someone on Resources.
test("schedule, expenses, changes and resources", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.29" });
  await signUp(page, "Tara Planner", "tara.plan@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const w = (p: string) => `/api/v1/orgs/${orgId}/work/${p}`;
  const project = (await (await page.request.post(w("projects"), { data: { name: "Harbour app", billing: "fixed", fee: 200000_00, budgetHours: 50, dueDate: "2026-12-31" }, headers })).json()).project;
  for (const [title, startDate, dueDate] of [["Design", "2026-11-02", "2026-11-10"], ["Build", "2026-11-05", "2026-11-20"]]) await page.request.post(w("tasks"), { data: { projectId: project.id, title, startDate, dueDate }, headers });

  await page.goto(`/work/projects/${project.id}/schedule`);
  await expect(page.getByRole("table", { name: "Gantt chart" })).toBeVisible();
  await page.getByRole("button", { name: "Link tasks" }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("This task").selectOption({ label: "#2 Build" });
  await dlg.getByLabel("Waits on").selectOption({ label: "#1 Design" });
  await dlg.getByRole("button", { name: "Link", exact: true }).click();
  await expect(page.getByText(/1 task starts before what it waits on allows/)).toBeVisible();
  await page.getByRole("button", { name: "Push them later" }).click();
  await expect(page.getByText(/starts before what it waits on/)).toHaveCount(0);
  await expect(page.getByLabel(/^Build: 11 Nov to 26 Nov, critical$/)).toBeVisible();

  await page.getByRole("tab", { name: "Expenses" }).click();
  await page.getByRole("button", { name: "Expense", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Amount (₹)").fill("1000");
  await dlg.getByLabel("Description").fill("Test devices");
  await dlg.getByLabel("Markup %").fill("10");
  await expect(dlg.getByText(/Charged ₹1,100/)).toBeVisible();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Travel: Test devices")).toBeVisible();

  await page.getByRole("tab", { name: "Risks & changes" }).click();
  await page.getByRole("button", { name: "Change request", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("What's changing").fill("Add offline mode");
  await dlg.getByLabel("Budget hours").fill("12");
  await dlg.getByLabel("Due date moves (days)").fill("14");
  await dlg.getByRole("button", { name: "Save draft" }).click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByText("Due 14 Jan 2027")).toBeVisible();

  await page.goto("/work/resources");
  await page.getByRole("button", { name: "Book someone" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Hours a day").fill("4");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/HRB|Harbour app/).first()).toBeVisible();
  await expect(page.getByText(/h of \d+h/).first()).toBeVisible();
});
