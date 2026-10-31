import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { closeDb, codeFor, signUp as signUpDirect } from "./helpers";

const PASSWORD = "correct-horse-42";
const BRIEF = 'A premium website for my restaurant called "Saffron House" with online reservations, a menu, customer reviews, WhatsApp contact and an admin panel.';

test.afterAll(() => closeDb());

/** The public sign-up: onboarding first, then the account, then the emailed code; then log in. */
async function signUp(page: Page, name: string, email: string) {
  await page.goto("/start");
  await page.getByRole("button", { name: "Let's begin" }).click();
  await page.getByPlaceholder("Saffron House").fill("Saffron House");
  await page.getByRole("radio", { name: /^Restaurant/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "See my features" }).click();
  await page.getByRole("button", { name: "Choose my plan" }).click();
  // Everything is free for the trial; building your own from the features is the default.
  await expect(page.getByText(/Everything is free for 30 days/)).toBeVisible();
  await expect(page.getByRole("radio", { name: /Build your own/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await expect(page.getByLabel("Business name")).toHaveValue("Saffron House");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  // A wrong code says so and keeps the person on the step.
  await page.getByLabel("Digit 1 of 6").fill(String((Number(await codeFor(email)) + 1) % 1_000_000).padStart(6, "0"));
  await expect(page.getByText(/tries? left|wrong/i)).toBeVisible();
  await page.getByLabel("Digit 1 of 6").fill(await codeFor(email));
  await expect(page.getByRole("heading", { name: "You're all set." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/30-day free trial has started/)).toBeVisible();
  // No automatic sign-in: the person logs in with what they just chose.
  await page.getByRole("link", { name: "Log in" }).click();
  await page.waitForURL(/\/login\?email=.*&welcome=1$/);
  await expect(page.getByText("Your workspace is ready")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/home$/);
}

const canvas = (page: Page): FrameLocator => page.frameLocator('iframe[title^="Canvas"]');

test.describe.serial("core journey", () => {
  let projectUrl = "";

  test("sign up at /start with an emailed code, plan from a brief, and create a project", async ({ page }) => {
    await signUp(page, "Asha Rao", "asha@example.com");
    await page.goto("/create");
    await page.getByLabel("What do you want to build?").fill(BRIEF);
    await page.getByRole("button", { name: "Plan my project" }).click();

    await expect(page.getByRole("heading", { name: "Proposed plan" })).toBeVisible();
    // No provider is configured in E2E, and the UI says so instead of pretending.
    await expect(page.getByText("Planned with built-in rules")).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Saffron House");
    await expect(page.getByText("Reservation", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]+\/builder$/);
    projectUrl = page.url().replace(/\/builder$/, "");
    await expect(canvas(page).locator("h1")).toContainText("Saffron House");
  });

  test("edit a section; the change autosaves and survives a reload", async ({ page }) => {
    // Sign in with an emailed code instead of the password.
    await page.goto("/login");
    await page.getByRole("button", { name: "Email me a code instead" }).click();
    await page.getByLabel("Email").fill("asha@example.com");
    const asked = new Date(Date.now() - 1000);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await page.getByLabel("Digit 1 of 6").fill(await codeFor("asha@example.com", asked));
    await page.waitForURL(/\/home$/);

    await page.goto(`${projectUrl}/builder`);
    await canvas(page).locator("h1").click();
    const heading = page.getByLabel("Heading", { exact: true });
    await expect(heading).toBeVisible();
    await heading.fill("Seasonal Indian cooking in the heart of the city");
    await expect(canvas(page).locator("h1")).toHaveText("Seasonal Indian cooking in the heart of the city");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

    await page.reload();
    await expect(canvas(page).locator("h1")).toHaveText("Seasonal Indian cooking in the heart of the city");

    // Undo restores the previous heading.
    await canvas(page).locator("h1").click();
    await page.getByLabel("Heading", { exact: true }).fill("Temporary heading");
    await expect(canvas(page).locator("h1")).toHaveText("Temporary heading");
    await page.locator("body").click({ position: { x: 5, y: 600 } });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(canvas(page).locator("h1")).toHaveText("Seasonal Indian cooking in the heart of the city");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();
  });

  test("the assistant proposes a change, shows a diff, and applies it on accept", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);
    await page.goto(`${projectUrl}/builder`);

    await page.getByRole("button", { name: /Ask AI to change anything/ }).click();
    await page.getByLabel("Ask the assistant").fill("Add a FAQ section");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Recognised as a built-in command")).toBeVisible();
    await page.getByRole("button", { name: "site/site.json" }).click();
    await expect(page.getByText('"type": "faq"').first()).toBeVisible();
    await page.getByRole("button", { name: "Accept changes" }).click();
    await expect(page.getByText("Applied.")).toBeVisible();
    await expect(canvas(page).getByRole("heading", { name: "Frequently asked questions" })).toBeVisible();

    // A model-only request fails clearly when no provider is connected.
    await page.getByRole("button", { name: /New request/ }).click();
    await page.getByLabel("Ask the assistant").fill("Rewrite the hero copy for young families");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("The task failed")).toBeVisible();
    await expect(page.getByText(/needs an AI model/)).toBeVisible();
  });

  test("editor tools: add from the gallery, upload and crop, restyle, review", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);
    await page.goto(`${projectUrl}/builder`);

    // Add a section from the visual gallery.
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Search sections").fill("key figures");
    await page.getByRole("button", { name: /Key figures/ }).click();
    await expect(page.getByText("Key figures added")).toBeVisible();
    await expect(page.getByText("Example content")).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Key figures actions" })).toBeVisible();
    await page.getByRole("toolbar", { name: "Key figures actions" }).getByRole("button", { name: "Delete section" }).click();

    // Edit a headline in place on the canvas and style just that element.
    const h1 = canvas(page).locator(".sec-hero h1").first();
    await h1.click();
    await h1.dblclick();
    await page.keyboard.type("Fresh bread, every single morning");
    await page.keyboard.press("Enter");
    await expect(h1).toHaveText("Fresh bread, every single morning");
    await expect(page.getByText(/Element · heading/i)).toBeVisible();
    await page.getByLabel("Colour hex", { exact: true }).fill("#b45309");
    await expect.poll(() => h1.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(180, 83, 9)");

    // Upload and crop an image.
    await page.getByRole("button", { name: "Media", exact: true }).click();
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==", "base64");
    await page.getByLabel("Upload image").setInputFiles({ name: "storefront.png", mimeType: "image/png", buffer: png });
    await expect(page.getByRole("dialog", { name: "Prepare image" })).toBeVisible();
    await page.getByRole("radio", { name: "1:1" }).click();
    await page.getByRole("dialog", { name: "Prepare image" }).getByRole("button", { name: "Upload" }).click();
    await expect(page.getByText("Image uploaded")).toBeVisible();
    await expect(page.locator('img[src^="/assets/"]').first()).toBeVisible();

    // Restyle in one click.
    await page.getByRole("button", { name: "Style", exact: true }).click();
    await page.getByRole("button", { name: /^Aa Studio\s*Dark tech/ }).click();
    await expect(canvas(page).locator(".hero")).toBeVisible();

    // Design review offers fixes.
    await page.getByRole("button", { name: /^Review/ }).click();
    await expect(page.getByText(/suggestion|looks great/).first()).toBeVisible();
    // Every edit above (including deleting the example section) is saved.
    await expect(page.getByText(/^Saved$/)).toBeVisible();
  });

  test("the same project opens in the IDE with the design document", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);
    await page.goto(`${projectUrl}/ide`);
    // A restaurant's sign-up didn't pick the code editor, so it's switched on here.
    await page.getByRole("button", { name: "Switch on AI code editor" }).click();
    await expect(page.getByRole("tab", { name: /site\.json/ })).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /README\.md/ })).toBeVisible();
    await page.getByRole("tab", { name: "Terminal" }).click();
    // The terminal runs real commands in the sandbox.
    await page.getByLabel("Terminal command").fill("js [1, 2, 3].map((x) => x * 7).join(\"-\")");
    await page.getByLabel("Terminal command").press("Enter");
    await expect(page.getByText("7-14-21", { exact: true })).toBeVisible();
    await page.getByLabel("Terminal command").fill("validate");
    await page.getByLabel("Terminal command").press("Enter");
    await expect(page.getByText(/✓ site\/site\.json is valid/)).toBeVisible();
    await page.getByRole("tab", { name: "Search" }).click();
    await page.getByLabel("Search in files").fill("Seasonal Indian");
    await page.getByLabel("Search in files").press("Enter");
    await expect(page.getByText("site/site.json").last()).toBeVisible();
  });

  test("deploy to production, visit the live site, and submit a booking", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);
    await page.goto(`${projectUrl}/deployments`);

    await page.getByRole("button", { name: "Deploy preview" }).click();
    await expect(page.getByText("Preview ready")).toBeVisible();
    await page.getByRole("button", { name: "Deploy to production" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Deploy" }).click();
    await expect(page.getByText("Live in production")).toBeVisible();
    await expect(page.getByText("Current production")).toBeVisible();

    const liveHref = await page.getByRole("link", { name: /^\/s\// }).getAttribute("href");
    await page.goto(liveHref!);
    // The headline edited in place on the canvas is what visitors see.
    await expect(page.locator("h1")).toHaveText("Fresh bread, every single morning");
    await expect.poll(() => page.locator("h1").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(180, 83, 9)");
    await page.getByLabel("Name").first().fill("Riya");
    await page.getByLabel("Phone or email").fill("riya@example.com");
    await page.getByLabel("Date").fill("2026-11-20");
    await page.getByLabel("Time").fill("19:30");
    await page.getByRole("button", { name: "Request booking" }).click();
    await expect(page.getByText("Thank you — your message was sent.")).toBeVisible();

    await page.goto(projectUrl);
    await page.getByRole("tab", { name: "Form submissions" }).click();
    await expect(page.getByRole("cell", { name: /riya@example\.com/ })).toBeVisible();
  });

  test("try a change on a branch, preview it, then merge it into main", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("asha@example.com");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/home$/);

    await page.goto(`${projectUrl}/builder`);
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Branches…" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Winter menu");
    await page.getByRole("button", { name: "Create from main" }).click();
    await expect(page).toHaveURL(/\/builder\?branch=[0-9a-f-]+$/);
    await expect(page.getByText("the live site is not affected")).toBeVisible();

    await canvas(page).locator("h1").click();
    await page.getByLabel("Heading", { exact: true }).fill("Winter specials, slow-cooked");
    await expect(page.getByRole("status").filter({ hasText: /^Saved$/ })).toBeVisible();

    // Main is untouched until the merge.
    const projectId = projectUrl.split("/").pop();
    const main = await (await page.request.get(`/api/v1/projects/${projectId}/file?path=site/site.json`)).json();
    expect(main.content).not.toContain("Winter specials");

    await page.getByRole("button", { name: "Preview branch" }).click();
    const preview = page.getByRole("link", { name: "Open preview" });
    await expect(preview).toBeVisible();
    const res = await page.request.get((await preview.getAttribute("href"))!);
    expect(await res.text()).toContain("Winter specials, slow-cooked");

    await page.getByRole("button", { name: "Merge into main" }).click();
    const dialog = page.getByRole("dialog", { name: /Merge "Winter menu" into main/ });
    await expect(dialog.getByText("No conflicts.")).toBeVisible();
    await dialog.getByRole("button", { name: "Merge into main" }).click();
    await expect(page).toHaveURL(/\/builder$/);
    await expect(canvas(page).locator("h1")).toHaveText("Winter specials, slow-cooked");
  });

  test("another account cannot open the project", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signUpDirect(page, "Other Person", "other@example.com");
    await page.goto(projectUrl);
    await expect(page.getByText("Project unavailable")).toBeVisible();
    const res = await page.request.get(`/api/v1/projects/${projectUrl.split("/").pop()}/files`);
    expect(res.status()).toBe(404);
    await context.close();
  });
});
