import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(response: Response) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("api", () => {
  it("sends the session cookie", async () => {
    const spy = stubFetch(Response.json({ links: [], total: 0 }));
    await api.get("/api/links");
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin" });
  });

  it("drops undefined query parameters instead of sending the string 'undefined'", async () => {
    const spy = stubFetch(Response.json({ links: [], total: 0 }));
    await api.get("/api/links", { search: "x", tagId: undefined, limit: 20 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain("search=x");
    expect(url).toContain("limit=20");
    expect(url).not.toContain("tagId");
  });

  it("throws ApiError carrying the status and the API's error code", async () => {
    stubFetch(Response.json({ error: "slug_taken" }, { status: 409 }));
    await expect(api.post("/api/links", { targetUrl: "https://x.com" })).rejects.toMatchObject({
      status: 409,
      code: "slug_taken",
    });
  });

  it("still throws when the error body is not JSON", async () => {
    stubFetch(new Response("upstream exploded", { status: 500 }));
    const error = (await api.get("/api/links").catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    expect(error.code).toBe("unknown");
  });

  it("returns undefined rather than exploding on an empty 200", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api.post("/api/auth/logout")).resolves.toBeUndefined();
  });
});
