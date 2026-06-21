import { test } from "@playwright/test";
import { ADVOCATE_USERNAME, DEMO_PASSWORD } from "./global-setup";

test("advocate signs in", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await page.waitForURL("**/auth/signin");

  await page.getByLabel("Email address").pressSequentially(`${ADVOCATE_USERNAME}@example.com`, { delay: 100 });
  await page.getByLabel("Password", { exact: true }).pressSequentially(DEMO_PASSWORD, { delay: 100 });
  await page.getByRole("button", { name: "Sign in" }).click();

  await page.waitForURL("**/debates");
});
