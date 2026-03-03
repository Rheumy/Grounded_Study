import { test, expect } from "@playwright/test";

test("landing page loads", async ({ page }) => {
  await page.goto("/");

  // Unique selector: the navbar link
  await expect(page.getByRole("link", { name: "Grounded Study" })).toBeVisible();

  // Keep the hero assertion
  await expect(page.getByText("Turn your textbooks")).toBeVisible();
});