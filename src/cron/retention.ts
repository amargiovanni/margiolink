import { deleteStaleLoginAttempts } from "../auth/rate-limit";
import { deleteClicksBefore, unaggregatedDaysBefore } from "../db/clicks";
import { deleteExpiredSessions } from "../db/sessions";

export interface RetentionResult {
  clicks: number;
  sessions: number;
  loginAttempts: number;
  /**
   * UTC days past the retention window whose raw rows were kept because the
   * day has no `click_daily` row. A non-empty list means the rollup is stuck:
   * the data is still there, but nothing is aggregating it.
   */
  skippedDays: string[];
}

export async function runRetention(
  db: D1Database,
  now: number,
  retentionDays: number,
): Promise<RetentionResult> {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    throw new Error(`runRetention: invalid retentionDays (${retentionDays})`);
  }

  const cutoff = now - retentionDays * 86_400;

  const skippedDays = await unaggregatedDaysBefore(db, cutoff);
  if (skippedDays.length > 0) {
    // Logged rather than swallowed: a stuck rollup is otherwise invisible until
    // the dashboard shows a hole, by which time the raw rows would have been
    // deleted under the previous behaviour.
    console.warn(
      "retention: declined to delete raw clicks for days with no click_daily row",
      skippedDays,
    );
  }

  return {
    clicks: await deleteClicksBefore(db, cutoff),
    sessions: await deleteExpiredSessions(db, now),
    loginAttempts: await deleteStaleLoginAttempts(db, now),
    skippedDays,
  };
}
