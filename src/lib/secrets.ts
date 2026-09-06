import type { Env } from "../types";

/**
 * Minimum accepted length for `HASH_SECRET`, in characters.
 *
 * The secret keys both the daily visitor/IP hash (`src/lib/crypto.ts`) and the
 * link-password token signature (`src/auth/link-token.ts`). 32 characters is
 * the floor at which a hex-encoded 128-bit random value fits; anything shorter
 * is assumed to be a placeholder rather than a generated secret.
 */
export const MIN_HASH_SECRET_LENGTH = 32;

const WEAK_SECRET_VALUES = new Set([
  "change-me",
  "change-me-locally",
  "changeme",
  "example",
  "example-secret",
  "admin123",
  "password",
  "password123",
  "password1234",
  "replace-me",
  "replace-this",
  "secret",
  "secret123",
  "your-secret",
  "your-secret-here",
  "a-long-random-string-used-for-visitor-hashing",
  "replace-with-at-least-32-random-characters",
  "local-demo-hash-secret-not-a-real-one-0000",
  "test-hash-secret-not-a-real-one-0",
]);

function hasLowEntropy(secret: string, minimumEntropy = 3.5): boolean {
  if (new Set(secret).size < 8 || /^(.{1,16})\1+$/.test(secret)) return true;

  const frequencies = new Map<string, number>();
  for (const character of secret) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  const entropy = [...frequencies.values()].reduce((sum, count) => {
    const probability = count / secret.length;
    return sum - probability * Math.log2(probability);
  }, 0);
  return entropy < minimumEntropy;
}

function requireStrongSecret(
  name: string,
  value: unknown,
  minimumLength: number,
  minimumEntropy = 3.5,
): string {
  if (typeof value !== "string") {
    throw new Error(`${name} is not configured with a sufficiently long secret`);
  }

  const normalised = value.toLowerCase();
  if (
    WEAK_SECRET_VALUES.has(normalised) ||
    /(?:change[-_ ]?me|replace[-_ ]?(?:me|this)|demo|example|not[-_ ]?a[-_ ]?real|your[-_ ]?secret)/.test(
      normalised,
    ) ||
    hasLowEntropy(value, minimumEntropy)
  ) {
    throw new Error(`${name} is configured with a weak default or example value`);
  }

  if (value.length < minimumLength || value.trim() !== value) {
    throw new Error(`${name} is not configured with a sufficiently long secret`);
  }

  return value;
}

export function requireAdminPassword(env: Env): string {
  return requireStrongSecret("ADMIN_PASSWORD", env.ADMIN_PASSWORD, 12, 3);
}

/**
 * Read `HASH_SECRET` and refuse to continue if it is unusable.
 *
 * Workers has no startup hook that can assert on bindings, so this guard sits
 * at every point the secret is *consumed* — the redirect handler, the click
 * ingestion path and the login route. Reading `env.HASH_SECRET` directly
 * bypasses it, which is why `Env.HASH_SECRET` is typed `string | undefined`:
 * a direct read will not type-check where a `string` is required.
 *
 * Failing closed matters more here than anywhere else in the app. With the
 * secret unset, `dailyKey` would key the HMAC on the literal
 * `"undefined:<date>"` — making every visitor hash reproducible by anyone, and
 * so destroying the pseudonymisation the public notice promises — and `sign()`
 * would key on the literal `"undefined"`, making `ml_pw_` tokens forgeable and
 * the link password gate bypassable.
 */
export function requireHashSecret(env: Env): string {
  return requireStrongSecret("HASH_SECRET", env.HASH_SECRET, MIN_HASH_SECRET_LENGTH);
}
