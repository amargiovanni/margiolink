import { expect, test } from "@playwright/test";

test("a successful password form follows the redirect to its external destination", async ({
  page,
}) => {
  await page.route("https://example.com/e2e-protected-destination", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Protected destination reached</h1>",
    });
  });

  await page.goto("/e2e-protected");
  await page.getByLabel("Password").fill("e2e-link-password");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL("https://example.com/e2e-protected-destination");
  await expect(page.getByRole("heading", { name: "Protected destination reached" })).toBeVisible();
});
