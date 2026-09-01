import { deleteStaleLoginAttempts } from "../auth/rate-limit";
import { deleteClicksBefore } from "../db/clicks";
import { deleteExpiredSessions } from "../db/sessions";

export interface RetentionResult {
  clicks: number;
  sessions: number;
  loginAttempts: number;
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

  return {
    clicks: await deleteClicksBefore(db, cutoff),
    sessions: await deleteExpiredSessions(db, now),
    loginAttempts: await deleteStaleLoginAttempts(db, now),
  };
}
