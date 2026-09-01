import { parseReferrer, type ReferrerInfo } from "./referrer";
import { type ClientInfo, parseClient } from "./ua";

export interface GeoInfo {
  continent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  asnOrg: string | null;
  colo: string | null;
}

export interface UtmParams {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  term: string | null;
  content: string | null;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  geo: GeoInfo;
  client: ClientInfo;
  referrer: ReferrerInfo;
  utm: UtmParams;
  source: "link" | "qr";
}

function cfString(cf: Record<string, unknown> | undefined, key: string): string | null {
  const value = cf?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildRequestContext(request: Request): RequestContext {
  const cf = request.cf as unknown as Record<string, unknown> | undefined;
  const params = new URL(request.url).searchParams;

  return {
    ip: request.headers.get("cf-connecting-ip") ?? "",
    userAgent: request.headers.get("user-agent") ?? "",
    geo: {
      continent: cfString(cf, "continent"),
      country: cfString(cf, "country"),
      region: cfString(cf, "region"),
      city: cfString(cf, "city"),
      timezone: cfString(cf, "timezone"),
      asnOrg: cfString(cf, "asOrganization"),
      colo: cfString(cf, "colo"),
    },
    client: parseClient(request.headers),
    referrer: parseReferrer(request.headers.get("referer")),
    utm: {
      source: params.get("utm_source"),
      medium: params.get("utm_medium"),
      campaign: params.get("utm_campaign"),
      term: params.get("utm_term"),
      content: params.get("utm_content"),
    },
    source: params.get("s") === "qr" ? "qr" : "link",
  };
}
