import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// Projects & timesheets: a project with a team, a task on the board, hours on
// the weekly timesheet, sending the week and approving it.
test("plan a project, log a week and approve it", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.17" });
  await signUp(page, "Nisha Lead", "nisha.work@example.com");

  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Projects & time" })).toBeVisible();
  await expect(page.getByText("Start your first project")).toBeVisible();

  // A project.
  await page.getByRole("button", { name: "New project" }).last().click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Lumen website");
  await dlg.getByLabel("Budget (hours)").fill("20");
  await dlg.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Lumen website" })).toBeVisible();
  await expect(page.getByText("PRJ-0001")).toBeVisible();

  // A task, added to the In progress column, then opened.
  await page.getByRole("button", { name: "Add a task to In progress" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Title").fill("Design the home page");
  await dlg.getByLabel("Assignee").selectOption({ label: "Nisha Lead" });
  await dlg.getByLabel("Estimate (hours)").fill("6");
  await dlg.getByRole("button", { name: "Add task" }).click();
  const col = page.getByRole("region", { name: "In progress" });
  await expect(col.getByText("Design the home page")).toBeVisible();
  // Moved to Review through the card's menu.
  await col.getByRole("button", { name: "Move to column" }).click();
  await page.getByRole("menuitem", { name: "Move to Review" }).click();
  await expect(page.getByRole("region", { name: "Review" }).getByText("Design the home page")).toBeVisible();

  // Hours on the timesheet: add the task as a row and type into Monday.
  await page.goto("/work/timesheet");
  await page.getByRole("button", { name: "Add a row" }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Project").selectOption({ label: "PRJ-0001 · Lumen website" });
  await dlg.getByLabel("Task").selectOption({ label: "#1 Design the home page" });
  await dlg.getByRole("button", { name: "Add", exact: true }).click();
  const mon = page.getByRole("textbox", { name: /Design the home page, Mon/ });
  await mon.fill("2h 30m");
  await mon.press("Enter");
  await expect(page.getByText("2:30").last()).toBeVisible();
  await expect(mon).toHaveValue("2:30");
  await page.getByRole("button", { name: "Send for approval" }).click();
  await expect(page.getByText("Waiting for approval")).toBeVisible();
  // Owners and admins can still correct a sent week; others can't (see the integration tests).

  // Approve it.
  await page.goto("/work/approvals");
  await expect(page.getByText("Nisha Lead")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Nothing is waiting for approval.")).toBeVisible();
  await page.goto("/work/timesheet");
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();

  // The task shows the time against its estimate.
  await page.goto("/work/tasks");
  await page.getByRole("link", { name: /Design the home page/ }).click();
  await expect(page.getByText("2.5h").first()).toBeVisible();
});
