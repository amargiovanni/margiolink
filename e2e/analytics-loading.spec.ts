import { expect, test } from "./fixtures";

for (const target of ["Overview", "Link detail"] as const) {
  test(`${target} defers below-viewport analytics until scrolled or requested`, async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    let destination = "/app";
    if (target === "Link detail") {
      await page.goto("/app/links");
      destination =
        (await page.getByRole("link", { name: "e2e-primary", exact: true }).getAttribute("href")) ??
        "";
      expect(destination).toMatch(/links\/\d+$/);
    }
    const stats: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/stats/")) stats.push(request.url());
    });
    const summary = page.waitForResponse(
      (response) => response.url().includes("/api/stats/summary") && response.ok(),
    );
    const timeseries = page.waitForResponse(
      (response) => response.url().includes("/api/stats/timeseries") && response.ok(),
    );
    await page.goto(destination);
    await Promise.all([summary, timeseries]);
    const title = target === "Link detail" ? "Cities" : "Activity by hour";
    const dimension = target === "Link detail" ? "city" : "dow_hour";
    const deferred = page.locator(`[data-deferred-panel="${title}"]`);
    const box = await deferred.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(720);
    // Wait two rendering frames so a premature IntersectionObserver callback
    // cannot escape the initial-query assertion.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    expect(stats.some((url) => new URL(url).searchParams.get("name") === dimension)).toBe(false);
    const loaded = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/stats/dimension" &&
        url.searchParams.get("name") === dimension &&
        response.ok()
      );
    });
    await deferred.scrollIntoViewIfNeeded();
    await loaded;
    await expect(deferred.getByRole("button", { name: `Load ${title}`, exact: true })).toHaveCount(
      0,
    );
    await expect(deferred.getByRole("region", { name: title, exact: true })).toBeVisible();
  });
}

test("keyboard demand loads analytics even when no intersection is reported", async ({
  authenticatedPage: page,
}) => {
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
      root = null;
      rootMargin = "0px";
      scrollMargin = "0px";
      thresholds = [0];
    };
  });
  await page.goto("/app");
  const button = page.getByRole("button", { name: "Load Channels", exact: true });
  await button.focus();
  const loaded = page.waitForResponse(
    (response) => response.url().includes("name=referrer_type") && response.ok(),
  );
  await page.keyboard.press("Enter");
  await loaded;
  await expect(page.getByRole("region", { name: "Channels", exact: true })).toBeVisible();
});
