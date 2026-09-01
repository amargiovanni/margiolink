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
  ip_hash: string;
  attempts: number;
  first_attempt_at: number;
  locked_until: number | null;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter: number;
}

function lockDuration(attempts: number): number {
  const round = Math.floor(attempts / MAX_ATTEMPTS) - 1;
  const index = Math.min(Math.max(round, 0), LOCK_STEPS.length - 1);
  return LOCK_STEPS[index] ?? LOCK_STEPS[LOCK_STEPS.length - 1] ?? 900;
}

export async function checkLoginAllowed(
  db: D1Database,
  key: string,
  now: number,
): Promise<RateLimitResult> {
  const row = await db
    .prepare("SELECT * FROM login_attempts WHERE ip_hash = ?")
    .bind(key)
    .first<AttemptRow>();

  if (!row) return { allowed: true, retryAfter: 0 };

  if (row.locked_until !== null && row.locked_until > now) {
    return { allowed: false, retryAfter: row.locked_until - now };
  }

  return { allowed: true, retryAfter: 0 };
}

export async function registerLoginFailure(
  db: D1Database,
  key: string,
  now: number,
): Promise<void> {
  const row = await db
    .prepare("SELECT * FROM login_attempts WHERE ip_hash = ?")
    .bind(key)
    .first<AttemptRow>();

  if (!row || now - row.first_attempt_at > WINDOW_SECONDS) {
    await db
      .prepare(
        `INSERT INTO login_attempts (ip_hash, attempts, first_attempt_at, locked_until)
         VALUES (?, 1, ?, NULL)
         ON CONFLICT (ip_hash) DO UPDATE
           SET attempts = 1, first_attempt_at = excluded.first_attempt_at, locked_until = NULL`,
      )
      .bind(key, now)
      .run();
    return;
  }

  const attempts = row.attempts + 1;
  const lockedUntil =
    attempts % MAX_ATTEMPTS === 0 ? now + lockDuration(attempts) : row.locked_until;

  await db
    .prepare("UPDATE login_attempts SET attempts = ?, locked_until = ? WHERE ip_hash = ?")
    .bind(attempts, lockedUntil, key)
    .run();
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
