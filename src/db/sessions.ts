import { randomToken, sha256Hex } from "../lib/crypto";

export interface SessionRow {
  id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ua_summary: string | null;
}

const TTL_SECONDS = 30 * 24 * 3600;
export const SESSION_TOUCH_INTERVAL_SECONDS = 300;

export async function createSession(
  db: D1Database,
  uaSummary: string | null,
  now: number,
): Promise<string> {
  const token = randomToken();
  const id = await sha256Hex(token);
  await db
    .prepare(
      `INSERT INTO admin_sessions (id, created_at, last_seen_at, expires_at, ua_summary)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, now, now, now + TTL_SECONDS, uaSummary)
    .run();
  return token;
}

export async function readSession(
  db: D1Database,
  token: string,
  now: number,
): Promise<SessionRow | null> {
  const id = await sha256Hex(token);
  const session = await db
    .prepare("SELECT * FROM admin_sessions WHERE id = ? AND expires_at > ?")
    .bind(id, now)
    .first<SessionRow>();

  if (!session) return null;

  if (now - session.last_seen_at < SESSION_TOUCH_INTERVAL_SECONDS) {
    return session;
  }

  await db.prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?").bind(now, id).run();

  return { ...session, last_seen_at: now };
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db
    .prepare("DELETE FROM admin_sessions WHERE id = ?")
    .bind(await sha256Hex(token))
    .run();
}

export async function destroySessionById(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM admin_sessions WHERE id = ?").bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function destroyAllSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM admin_sessions").run();
}

export async function listSessions(db: D1Database, now: number): Promise<SessionRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM admin_sessions WHERE expires_at > ? ORDER BY last_seen_at DESC")
    .bind(now)
    .all<SessionRow>();
  return results;
}

export async function deleteExpiredSessions(db: D1Database, now: number): Promise<number> {
  const result = await db
    .prepare("DELETE FROM admin_sessions WHERE expires_at <= ?")
    .bind(now)
    .run();
  return result.meta.changes ?? 0;
}
