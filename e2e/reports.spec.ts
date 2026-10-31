import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

// A report built from deals — grouped by owner and stage, value totalled,
// shown as bars — saved, emailed on a schedule, and put on a dashboard.
test("build a report, chart it, schedule it, and put it on a dashboard", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": "10.42.0.35" });
  await page.setViewportSize({ width: 1400, height: 900 });
  await signUp(page, "Ritu Reports", "ritu.bi@example.com");
  const headers = { origin: new URL(page.url()).origin };
  const orgId = (await (await page.request.get("/api/v1/auth/me")).json()).organizations[0].id;
  const crm = (p: string) => `/api/v1/orgs/${orgId}/crm/${p}`;
  const stages = (await (await page.request.get(crm("meta"))).json()).pipelines[0].stages as { id: string; name: string }[];
  for (const [title, value, stage] of [["Annual catering", 500000_00, 0], ["Pilot", 120000_00, 2], ["Office lunch", 80000_00, 2], ["Event", 260000_00, 3]] as const) {
    const d = (await (await page.request.post(crm("deals"), { data: { title, value }, headers })).json()).deal;
    if (stage) await page.request.post(crm(`deals/${d.id}/move`), { data: { stageId: stages[stage].id }, headers });
  }

  await page.goto("/reports/new");
  await page.getByLabel("Data").selectOption({ label: "Deals" });
  await page.getByRole("button", { name: "Group", exact: true }).click();
  await page.getByLabel("Group 1", { exact: true }).selectOption({ label: "Stage" });
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  await page.getByLabel("Measure 2", { exact: true }).selectOption({ label: "Value" });
  await page.getByRole("button", { name: "Bars" }).click();
  await page.getByLabel("Dates", { exact: true }).selectOption({ label: "All time" });
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByRole("img", { name: "Bar chart" })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("report-bars.png") });
  await page.getByRole("button", { name: "Show the table" }).click();
  await expect(page.getByRole("row", { name: /Qualified/ })).toContainText("₹2,00,000");
  await expect(page.getByRole("row", { name: /^Total/ })).toContainText("₹9,60,000");

  await page.getByRole("button", { name: "Save", exact: true }).click();
  let dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Pipeline by stage");
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Pipeline by stage" })).toBeVisible();

  await page.getByRole("button", { name: "Email it" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Schedule" }).click();
  await page.goto("/reports/schedules");
  await expect(page.getByRole("link", { name: "Pipeline by stage" })).toBeVisible();

  await page.goto("/reports/dashboards");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  dlg = page.getByRole("dialog");
  await dlg.getByLabel("Name").fill("Sales week");
  await dlg.getByRole("button", { name: "Add a report" }).click();
  await dlg.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "Sales week" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Bar chart" })).toBeVisible();
});
