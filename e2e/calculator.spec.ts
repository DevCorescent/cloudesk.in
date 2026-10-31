import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("calculator: business percentages, a formula, and history that comes back", async ({ page }) => {
  await signUp(page, "Calc Person", "calc.person@example.com");
  await page.goto("/calculator");
  const input = page.getByLabel("Calculation");
  await input.fill("1,25,000 + 18%");
  await expect(page.getByText("= 1,47,500")).toBeVisible();
  await input.press("Enter");
  await expect(page.getByText("Rupees One Lakh Forty Seven Thousand Five Hundred Only")).toBeVisible();
  // A mistake is explained, not guessed at.
  await input.fill("(2 + 3");
  await input.press("Enter");
  await expect(page.getByText("A bracket isn't closed")).toBeVisible();

  await page.getByRole("tab", { name: /Business formulas/ }).click();
  await page.getByRole("button", { name: /Add GST/ }).click();
  await expect(page.getByText("₹11,800.00").first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved to history")).toBeVisible();

  // History survives a reload, and opening an entry puts it back.
  await page.reload();
  const history = page.getByRole("complementary").filter({ hasText: "History" });
  await expect(history.getByText("Total with GST: ₹11,800.00")).toBeVisible();
  await history.getByRole("button", { name: /1,25,000 \+ 18%/ }).click();
  await expect(page.getByLabel("Calculation")).toHaveValue("1,25,000 + 18%");
});
