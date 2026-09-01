import { describe, expect, it } from "vitest";
import { parseReferrer } from "../../src/lib/referrer";

describe("parseReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(parseReferrer(null)).toEqual({ host: null, url: null, type: "direct" });
  });

  it("treats an unparseable referrer as direct", () => {
    expect(parseReferrer("not a url")).toEqual({ host: null, url: null, type: "direct" });
  });

  it("strips the www prefix from the host", () => {
    expect(parseReferrer("https://www.example.com/page").host).toBe("example.com");
  });

  it.each([
    ["https://www.google.com/search?q=x", "search"],
    ["https://duckduckgo.com/?q=x", "search"],
    ["https://www.bing.com/search?q=x", "search"],
    ["https://t.co/abc", "social"],
    ["https://x.com/someone/status/1", "social"],
    ["https://www.linkedin.com/feed/", "social"],
    ["https://www.reddit.com/r/x", "social"],
    ["https://t.me/channel", "social"],
    ["https://mail.google.com/mail/u/0", "email"],
    ["https://outlook.live.com/mail/0", "email"],
    ["https://chatgpt.com/c/abc", "ai"],
    ["https://claude.ai/chat/abc", "ai"],
    ["https://www.perplexity.ai/search", "ai"],
    ["https://someblog.dev/post", "other"],
  ])("classifies %s as %s", (url, expected) => {
    expect(parseReferrer(url).type).toBe(expected);
  });

  it("matches subdomains of a known host", () => {
    expect(parseReferrer("https://news.google.com/foo").type).toBe("search");
  });

  it("keeps the full referrer URL", () => {
    expect(parseReferrer("https://example.com/a?b=1").url).toBe("https://example.com/a?b=1");
  });
});
