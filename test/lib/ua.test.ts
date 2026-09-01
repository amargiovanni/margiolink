import { describe, expect, it } from "vitest";
import { parseClient } from "../../src/lib/ua";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1";
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("parseClient with client hints", () => {
  it("prefers the specific brand over Chromium and the placeholder brand", () => {
    const result = parseClient(
      headers({
        "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="24", "Google Chrome";v="140"',
        "sec-ch-ua-platform": '"macOS"',
        "sec-ch-ua-mobile": "?0",
        "user-agent": CHROME_UA,
      }),
    );
    expect(result.browser).toBe("Google Chrome");
    expect(result.browserVersion).toBe("140");
    expect(result.os).toBe("macOS");
    expect(result.deviceType).toBe("desktop");
  });

  it("reads mobile from the hint", () => {
    const result = parseClient(
      headers({
        "sec-ch-ua": '"Chromium";v="140", "Not?A_Brand";v="24"',
        "sec-ch-ua-platform": '"Android"',
        "sec-ch-ua-mobile": "?1",
        "user-agent": CHROME_UA,
      }),
    );
    expect(result.deviceType).toBe("mobile");
    expect(result.os).toBe("Android");
  });
});

describe("parseClient falling back to the user-agent", () => {
  it("identifies desktop Chrome", () => {
    const result = parseClient(headers({ "user-agent": CHROME_UA }));
    expect(result.browser).toBe("Chrome");
    expect(result.deviceType).toBe("desktop");
    expect(result.os).not.toBeNull();
  });

  it("identifies an iPhone as mobile", () => {
    const result = parseClient(headers({ "user-agent": IPHONE_UA }));
    expect(result.deviceType).toBe("mobile");
  });

  it("identifies an iPad as tablet, which client hints alone cannot do", () => {
    const result = parseClient(headers({ "user-agent": IPAD_UA }));
    expect(result.deviceType).toBe("tablet");
  });
});

describe("parseClient edge cases", () => {
  it("flags a known bot", () => {
    const result = parseClient(headers({ "user-agent": GOOGLEBOT_UA }));
    expect(result.isBot).toBe(true);
    expect(result.deviceType).toBe("bot");
  });

  it("returns unknown when there is no user-agent at all", () => {
    const result = parseClient(headers({}));
    expect(result.deviceType).toBe("unknown");
    expect(result.browser).toBeNull();
  });

  it("takes the first language tag from Accept-Language", () => {
    const result = parseClient(
      headers({ "user-agent": CHROME_UA, "accept-language": "it-IT,it;q=0.9,en;q=0.8" }),
    );
    expect(result.language).toBe("it-IT");
  });
});
