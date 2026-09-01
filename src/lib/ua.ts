import Bowser from "bowser";
import { isbot } from "isbot";

export interface ClientInfo {
  deviceType: "desktop" | "mobile" | "tablet" | "bot" | "unknown";
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  language: string | null;
  isBot: boolean;
}

const PLACEHOLDER_BRAND = /not[^a-z0-9]*a[^a-z0-9]*brand/i;

interface Brand {
  brand: string;
  version: string;
}

function parseBrandList(header: string): Brand[] {
  const brands: Brand[] = [];
  const pattern = /"([^"]+)"\s*;\s*v\s*=\s*"([^"]+)"/g;
  let match = pattern.exec(header);
  while (match !== null) {
    brands.push({ brand: match[1] as string, version: match[2] as string });
    match = pattern.exec(header);
  }
  return brands;
}

function pickBrand(brands: Brand[]): Brand | null {
  const real = brands.filter((b) => !PLACEHOLDER_BRAND.test(b.brand));
  if (real.length === 0) return null;
  return real.find((b) => b.brand !== "Chromium") ?? (real[0] as Brand);
}

function unquote(value: string): string {
  return value.replace(/^"|"$/g, "");
}

function firstLanguage(header: string | null): string | null {
  if (!header) return null;
  const first = header.split(",")[0]?.split(";")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

export function parseClient(headers: Headers): ClientInfo {
  const ua = headers.get("user-agent");
  const language = firstLanguage(headers.get("accept-language"));

  if (!ua) {
    return {
      deviceType: "unknown",
      os: null,
      osVersion: null,
      browser: null,
      browserVersion: null,
      language,
      isBot: false,
    };
  }

  if (isbot(ua)) {
    return {
      deviceType: "bot",
      os: null,
      osVersion: null,
      browser: null,
      browserVersion: null,
      language,
      isBot: true,
    };
  }

  const parsed = Bowser.parse(ua);
  const platformType = parsed.platform.type;
  let deviceType: ClientInfo["deviceType"] =
    platformType === "mobile" || platformType === "tablet" || platformType === "desktop"
      ? platformType
      : "unknown";

  if (headers.get("sec-ch-ua-mobile") === "?1" && deviceType !== "tablet") {
    deviceType = "mobile";
  }

  const brandHeader = headers.get("sec-ch-ua");
  const brand = brandHeader ? pickBrand(parseBrandList(brandHeader)) : null;
  const platformHint = headers.get("sec-ch-ua-platform");

  return {
    deviceType,
    os: platformHint ? unquote(platformHint) : (parsed.os.name ?? null),
    osVersion: parsed.os.version ?? null,
    browser: brand ? brand.brand : (parsed.browser.name ?? null),
    browserVersion: brand ? brand.version : (parsed.browser.version ?? null),
    language,
    isBot: false,
  };
}
