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
  const secret = env.HASH_SECRET;

  if (typeof secret !== "string" || secret.length < MIN_HASH_SECRET_LENGTH) {
    throw new Error(
      `HASH_SECRET is not configured: it must be set to at least ${MIN_HASH_SECRET_LENGTH} ` +
        "characters of high-entropy random data (see README.md). Refusing to serve a request " +
        "that would otherwise use a guessable HMAC key.",
    );
  }

  return secret;
}
