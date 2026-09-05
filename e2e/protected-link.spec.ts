import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const EXPIRY_SLUG = "e2e-protected-expiry";
const EXPIRY_PASSWORD = "e2e-expiry-password";
const EXPIRY_FALLBACK = "https://example.com/e2e-expired-fallback";

interface LinkSummary {
  id: number;
  slug: string;
  deletedAt: number | null;
}

async function findLink(page: Page, slug: string): Promise<LinkSummary | null> {
  const query = `search=${encodeURIComponent(slug)}&limit=10`;
  const active = await page.request.get(`/api/links?${query}&status=all`);
  expect(active.ok()).toBe(true);
  const activeBody = (await active.json()) as { links: LinkSummary[] };
  const foundActive = activeBody.links.find((link) => link.slug === slug);
  if (foundActive) return foundActive;

  const deleted = await page.request.get(`/api/links?${query}&status=deleted`);
  expect(deleted.ok()).toBe(true);
  const deletedBody = (await deleted.json()) as { links: LinkSummary[] };
  return deletedBody.links.find((link) => link.slug === slug) ?? null;
}

async function prepareExpiryFixture(page: Page): Promise<number> {
  const existing = await findLink(page, EXPIRY_SLUG);
  if (!existing) {
    const created = await page.request.post("/api/links", {
      data: {
        slug: EXPIRY_SLUG,
        targetUrl: "https://example.com/e2e-expiry-destination",
        title: "Protected expiry transition fixture",
        password: EXPIRY_PASSWORD,
      },
    });
    expect(created.ok()).toBe(true);
    return ((await created.json()) as { link: LinkSummary }).link.id;
  }

  if (existing.deletedAt) {
    const restored = await page.request.post(`/api/links/${existing.id}/restore`);
    expect(restored.ok()).toBe(true);
  }
  const reset = await page.request.patch(`/api/links/${existing.id}`, {
    data: {
      targetUrl: "https://example.com/e2e-expiry-destination",
      title: "Protected expiry transition fixture",
      password: EXPIRY_PASSWORD,
      isActive: true,
      expiresAt: null,
      expiredUrl: null,
    },
  });
  expect(reset.ok()).toBe(true);
  return existing.id;
}

test("a successful password handoff reaches its external destination", async ({ page }) => {
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

test("a protected form that expires while open reaches its external fallback", async ({
  authenticatedPage: page,
}) => {
  const linkId = await prepareExpiryFixture(page);
  const cspErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy/i.test(message.text())) {
      cspErrors.push(message.text());
    }
  });
  await page.route(EXPIRY_FALLBACK, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<h1>Expired fallback reached</h1>",
    });
  });

  await page.goto(`/${EXPIRY_SLUG}`);
  await expect(page.getByRole("heading", { name: "This link is protected" })).toBeVisible();
  await page.getByLabel("Password").fill(EXPIRY_PASSWORD);

  const expired = await page.request.patch(`/api/links/${linkId}`, {
    data: {
      expiresAt: Math.floor(Date.now() / 1000) - 10,
      expiredUrl: EXPIRY_FALLBACK,
    },
  });
  expect(expired.ok()).toBe(true);

  const postResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST" && url.pathname === `/${EXPIRY_SLUG}`;
  });
  await page.getByRole("button", { name: "Continue" }).click();
  const postResponse = await postResponsePromise;

  expect(postResponse.status()).toBe(200);
  await expect(page).toHaveURL(EXPIRY_FALLBACK);
  await expect(page.getByRole("heading", { name: "Expired fallback reached" })).toBeVisible();
  expect(cspErrors).toEqual([]);
});
