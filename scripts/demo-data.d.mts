/**
 * Types for `demo-data.mjs`.
 *
 * The generator is plain JavaScript so it can be imported by `node` (the
 * seed script) and by `workerd` (`test/demo-seed.test.ts`) without a build
 * step in front of either. This file is what lets the test see its shape
 * under `strict` rather than reaching into `any` — the columns below are the
 * `clicks` table's, in camelCase, and the test pins that correspondence in
 * both directions.
 */

export declare const DEMO_PASSWORD: string;

export interface DemoTag {
  id: number;
  name: string;
  color: string;
}

export interface DemoLink {
  id: number;
  slug: string;
  targetUrl: string;
  title: string;
  description: string | null;
  /** The plaintext password for the one protected link, `null` for the rest.
   *  `seed-demo.mjs` hashes it and fills in the two fields below; the
   *  generator itself does no crypto. */
  password: string | null;
  passwordHash?: string;
  passwordSalt?: string;
  expiresAt: number | null;
  expiredUrl: string | null;
  isActive: 0 | 1;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export interface DemoLinkTag {
  linkId: number;
  tagId: number;
}

export interface DemoClick {
  linkId: number;
  ts: number;
  visitorHash: string;
  source: "link" | "qr";
  outcome: "redirect" | "inactive" | "expired" | "password_required" | "password_failed";
  isBot: 0 | 1;
  continent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  timezone: string | null;
  asnOrg: string | null;
  colo: string | null;
  deviceType: string;
  os: string | null;
  osVersion: string | null;
  browser: string | null;
  browserVersion: string | null;
  language: string | null;
  referrerHost: string | null;
  referrerType: string;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export interface DemoData {
  tags: DemoTag[];
  links: DemoLink[];
  linkTags: DemoLinkTag[];
  clicks: DemoClick[];
  window: {
    from: number;
    to: number;
    days: number;
    firstDay: string;
    lastDay: string;
  };
}

export interface DemoDataOptions {
  /** Unix seconds the window ends at. */
  now: number;
  /** Length of the window in days. Defaults to `RAW_RETENTION_DAYS`. */
  days?: number;
  /** PRNG seed. The same seed and window always produce the same rows. */
  seed?: number;
}

export declare function generateDemoData(options: DemoDataOptions): DemoData;
