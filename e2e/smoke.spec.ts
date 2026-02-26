import { test, expect } from "@playwright/test";

test("landing page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Grounded Study")).toBeVisible();
  await expect(page.getByText("Turn your textbooks")).toBeVisible();
});
