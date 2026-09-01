import { describe, expect, it } from "vitest";
import { validateTargetUrl } from "../../src/lib/url";

const DOMAIN = "link.test";

describe("validateTargetUrl", () => {
  it("accepts an https URL and returns it normalised", () => {
    const result = validateTargetUrl("https://example.com/path?a=1", DOMAIN);
    expect(result).toEqual({ ok: true, url: "https://example.com/path?a=1" });
  });

  it("accepts plain http", () => {
    expect(validateTargetUrl("http://example.com", DOMAIN).ok).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "vbscript:x"])(
    "rejects the %s scheme",
    (input) => {
      expect(validateTargetUrl(input, DOMAIN)).toEqual({
        ok: false,
        error: "unsupported_protocol",
      });
    },
  );

  it.each(["", "   ", "not a url", "http://"])("rejects unparseable input %s", (input) => {
    expect(validateTargetUrl(input, DOMAIN)).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects a target on the short domain to prevent redirect loops", () => {
    expect(validateTargetUrl("https://link.test/abc", DOMAIN)).toEqual({
      ok: false,
      error: "self_reference",
    });
  });

  it("rejects the short domain regardless of case", () => {
    expect(validateTargetUrl("https://LINK.TEST/abc", DOMAIN).ok).toBe(false);
  });

  it("rejects URLs longer than 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    expect(validateTargetUrl(long, DOMAIN)).toEqual({ ok: false, error: "too_long" });
  });
});
