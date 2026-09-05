import { expect, test } from "@playwright/test";

test("a successful password form follows the redirect to its external destination", async ({
  page,
}) => {
  const cspErrors: string[] = [];
  const protectedRequests: string[] = [];
  let postStatus: number | null = null;
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/e2e-protected") {
      protectedRequests.push(request.method());
    }
  });
  page.on("response", (response) => {
    if (
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/e2e-protected"
    ) {
      postStatus = response.status();
    }
  });

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
  expect(postStatus).toBe(200);
  expect(protectedRequests).toEqual(["GET", "POST"]);
  expect(cspErrors).toEqual([]);
});
