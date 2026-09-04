const MAX_ATTEMPTS = 8;
const WINDOW_SECONDS = 900;

/**
 * Lockout durations for the 1st, 2nd and 3rd+ round of exhausted attempts.
 *
 * **The last two steps are only reachable inside a single UTC day, by design.**
 * Every key passed to this module is derived from `ipHash` (the admin login) or
 * from `ipHash` plus a slug (the link-password interstitial), and `ipHash` uses
 * the same daily-rotating HMAC key as `visitorHash`: at UTC midnight the same
 * client hashes to a different key, finds no `login_attempts` row, and is
 * allowed again. So the effective ceiling on any lockout is "until the next UTC
 * midnight" — a client locked out at 23:50 is locked out for ten minutes, and
 * the 1-hour and 24-hour steps are reached only by a client that keeps failing
 * within one UTC day.
 *
 * That is the deliberate trade: the rotation that stops a visitor being
 * followed across days is the same mechanism that stops a lockout persisting
 * across them. Extending the lockout would mean keying the throttle on an
 * identifier that outlives the day, which is exactly the persistent identifier
 * the privacy design refuses. See
 * `compliance/legitimate-interest-assessment.md` §3.
 */
const LOCK_STEPS = [900, 3600, 86_400];

interface AttemptRow {
  attempts: number;
  locked_until: number | null;
  reservation_id: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

/**
 * Atomically claims one credential-check slot for a throttle key.
 *
 * The reservation id distinguishes the statement that created the latest
 * admitted attempt from concurrent statements that observed the resulting
 * lock. This avoids a check-then-write race without requiring a transaction
 * across multiple D1 statements.
 */
export async function reserveLoginAttempt(
  db: D1Database,
  key: string,
  now: number,
): Promise<RateLimitResult> {
  const reservationId = crypto.randomUUID();
  const row = await db
    .prepare(
      `INSERT INTO login_attempts
         (ip_hash, attempts, first_attempt_at, locked_until, reservation_id)
       VALUES (?1, 1, ?2, NULL, ?3)
       ON CONFLICT (ip_hash) DO UPDATE SET
         attempts = CASE
           WHEN login_attempts.locked_until IS NOT NULL
             AND login_attempts.locked_until > ?2
             THEN login_attempts.attempts
           WHEN login_attempts.locked_until IS NULL
             AND ?2 - login_attempts.first_attempt_at > ${WINDOW_SECONDS}
             THEN 1
           ELSE login_attempts.attempts + 1
         END,
         first_attempt_at = CASE
           WHEN login_attempts.locked_until IS NOT NULL
             AND login_attempts.locked_until > ?2
             THEN login_attempts.first_attempt_at
           WHEN login_attempts.locked_until IS NOT NULL
             THEN ?2
           WHEN login_attempts.locked_until IS NULL
             AND ?2 - login_attempts.first_attempt_at > ${WINDOW_SECONDS}
             THEN ?2
           ELSE login_attempts.first_attempt_at
         END,
         locked_until = CASE
           WHEN login_attempts.locked_until IS NOT NULL
             AND login_attempts.locked_until > ?2
             THEN login_attempts.locked_until
           WHEN login_attempts.locked_until IS NULL
             AND ?2 - login_attempts.first_attempt_at > ${WINDOW_SECONDS}
             THEN NULL
           WHEN (login_attempts.attempts + 1) % ${MAX_ATTEMPTS} = 0
             THEN ?2 + CASE
               WHEN login_attempts.attempts + 1 >= 24 THEN ${LOCK_STEPS[2]}
               WHEN login_attempts.attempts + 1 >= 16 THEN ${LOCK_STEPS[1]}
               ELSE ${LOCK_STEPS[0]}
             END
           ELSE NULL
         END,
         reservation_id = CASE
           WHEN login_attempts.locked_until IS NOT NULL
             AND login_attempts.locked_until > ?2
             THEN login_attempts.reservation_id
           ELSE ?3
         END
       RETURNING attempts, locked_until, reservation_id`,
    )
    .bind(key, now, reservationId)
    .first<AttemptRow>();

  if (!row) {
    throw new Error("Rate-limit reservation returned no row");
  }

  const allowed = row.reservation_id === reservationId;
  return {
    allowed,
    retryAfter: allowed || row.locked_until === null ? 0 : Math.max(1, row.locked_until - now),
  };
}

export async function clearLoginFailures(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip_hash = ?").bind(key).run();
}

export async function deleteStaleLoginAttempts(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare(
      `DELETE FROM login_attempts
       WHERE (locked_until IS NULL OR locked_until <= ?)
         AND first_attempt_at < ?`,
    )
    .bind(now, now - WINDOW_SECONDS)
    .run();
  return result.meta.changes ?? 0;
}
