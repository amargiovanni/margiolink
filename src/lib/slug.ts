const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SLUG_SHAPE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * Slugs the Worker or its asset router already answers to.
 *
 * `app` and `index` are here for the same reason: both name a document in
 * `web/dist` (`app.html` and `index.html`), and Cloudflare's asset router
 * serves a file that matches the path *before* the Worker runs, with
 * `html_handling` mapping `/app` and `/index` onto them. A link created with
 * either slug would be shadowed by a page — it would answer 200 with HTML
 * instead of redirecting, and nothing in the Worker would ever see the
 * request to explain why.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
  "index",
  "api",
  "privacy",
  "assets",
  "robots.txt",
  "favicon.ico",
  "_health",
]);

export function generateSlug(length = 7): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += ALPHABET.charAt(byte % ALPHABET.length);
  }
  return out;
}

export function normaliseSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidSlugShape(slug: string): boolean {
  return SLUG_SHAPE.test(slug);
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(normaliseSlug(slug));
}
