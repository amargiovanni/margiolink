import { describe, expect, it } from "vitest";
import { buildRequestContext } from "../../src/lib/request-context";

function request(url: string, init: RequestInit & { cf?: Record<string, unknown> } = {}): Request {
  const { cf, ...rest } = init;
  const req = new Request(url, rest);
  if (cf) {
    Object.defineProperty(req, "cf", { value: cf, configurable: true });
  }
  return req;
}

describe("buildRequestContext", () => {
  it("extracts geography from request.cf", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", {
        cf: {
          continent: "EU",
          country: "IT",
          region: "Lombardy",
          city: "Milan",
          timezone: "Europe/Rome",
          asOrganization: "Vodafone Italia",
          colo: "MXP",
        },
      }),
    );
    expect(ctx.geo).toEqual({
      continent: "EU",
      country: "IT",
      region: "Lombardy",
      city: "Milan",
      timezone: "Europe/Rome",
      asnOrg: "Vodafone Italia",
      colo: "MXP",
    });
  });

  it("returns nulls when cf is absent", () => {
    const ctx = buildRequestContext(request("https://link.test/abc"));
    expect(ctx.geo.country).toBeNull();
    expect(ctx.geo.colo).toBeNull();
  });

  it("reads the client IP from CF-Connecting-IP", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", { headers: { "cf-connecting-ip": "203.0.113.9" } }),
    );
    expect(ctx.ip).toBe("203.0.113.9");
  });

  it("falls back to an empty string when no IP header is present", () => {
    expect(buildRequestContext(request("https://link.test/abc")).ip).toBe("");
  });

  it("collects only supported campaign labels", () => {
    const ctx = buildRequestContext(
      request(
        "https://link.test/abc?utm_source=%20newsletter%20&utm_medium=email&utm_campaign=launch-2026&utm_term=spring&utm_content=header",
      ),
    );
    expect(ctx.utm).toEqual({
      source: "newsletter",
      medium: "email",
      campaign: "launch-2026",
    });
  });

  it("discards campaign values that could carry free-form or identifying text", () => {
    const ctx = buildRequestContext(
      request(
        `https://link.test/abc?utm_source=${encodeURIComponent("person@example.com")}&utm_medium=${encodeURIComponent("two words")}&utm_campaign=${"x".repeat(65)}`,
      ),
    );

    expect(ctx.utm).toEqual({ source: null, medium: null, campaign: null });
  });

  it("keeps a campaign label at the 64-character boundary", () => {
    const campaign = `release-${"x".repeat(56)}`;
    expect(campaign).toHaveLength(64);
    expect(
      buildRequestContext(request(`https://link.test/abc?utm_campaign=${campaign}`)).utm.campaign,
    ).toBe(campaign);
  });

  it("marks a QR scan when s=qr is present", () => {
    expect(buildRequestContext(request("https://link.test/abc?s=qr")).source).toBe("qr");
  });

  it("defaults to a link click", () => {
    expect(buildRequestContext(request("https://link.test/abc")).source).toBe("link");
  });

  it("passes the referrer through the classifier", () => {
    const ctx = buildRequestContext(
      request("https://link.test/abc", { headers: { referer: "https://x.com/post/1" } }),
    );
    expect(ctx.referrer.type).toBe("social");
    expect(ctx.referrer.host).toBe("x.com");
  });
});
