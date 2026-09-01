const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const SLUG_SHAPE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "app",
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
