import { generateSlug } from "../lib/slug";

export interface LinkRow {
  id: number;
  slug: string;
  target_url: string;
  title: string | null;
  description: string | null;
  password_hash: string | null;
  password_salt: string | null;
  expires_at: number | null;
  expired_url: string | null;
  is_active: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface CreateLinkInput {
  slug?: string;
  targetUrl: string;
  title?: string | null;
  description?: string | null;
  passwordHash?: string | null;
  passwordSalt?: string | null;
  expiresAt?: number | null;
  expiredUrl?: string | null;
}

export interface ListLinksOptions {
  search?: string;
  status?: "all" | "active" | "inactive" | "expired" | "deleted";
  tagId?: number;
  limit?: number;
  offset?: number;
}

export class SlugTakenError extends Error {
  constructor(slug: string) {
    super(`Slug already in use: ${slug}`);
    this.name = "SlugTakenError";
  }
}

const SELECT = "SELECT * FROM links";
const MAX_SLUG_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export async function findBySlug(db: D1Database, slug: string): Promise<LinkRow | null> {
  return db.prepare(`${SELECT} WHERE slug = ?`).bind(slug).first<LinkRow>();
}

export async function findById(db: D1Database, id: number): Promise<LinkRow | null> {
  return db.prepare(`${SELECT} WHERE id = ?`).bind(id).first<LinkRow>();
}

async function insert(db: D1Database, slug: string, input: CreateLinkInput, now: number) {
  return db
    .prepare(
      `INSERT INTO links
        (slug, target_url, title, description, password_hash, password_salt,
         expires_at, expired_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING *`,
    )
    .bind(
      slug,
      input.targetUrl,
      input.title ?? null,
      input.description ?? null,
      input.passwordHash ?? null,
      input.passwordSalt ?? null,
      input.expiresAt ?? null,
      input.expiredUrl ?? null,
      now,
      now,
    )
    .first<LinkRow>();
}

export async function createLink(
  db: D1Database,
  input: CreateLinkInput,
  now: number,
): Promise<LinkRow> {
  if (input.slug) {
    try {
      const row = await insert(db, input.slug, input, now);
      if (!row) throw new Error("Insert returned no row");
      return row;
    } catch (error) {
      if (isUniqueViolation(error)) throw new SlugTakenError(input.slug);
      throw error;
    }
  }

  for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt++) {
    try {
      const row = await insert(db, generateSlug(), input, now);
      if (!row) throw new Error("Insert returned no row");
      return row;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  throw new Error("Could not allocate a free slug after repeated attempts");
}

export async function updateLink(
  db: D1Database,
  id: number,
  patch: Partial<CreateLinkInput> & { isActive?: boolean },
  now: number,
): Promise<LinkRow | null> {
  const assignments: string[] = [];
  const values: (string | number | null)[] = [];

  const columns: ReadonlyArray<[keyof typeof patch, string]> = [
    ["targetUrl", "target_url"],
    ["title", "title"],
    ["description", "description"],
    ["passwordHash", "password_hash"],
    ["passwordSalt", "password_salt"],
    ["expiresAt", "expires_at"],
    ["expiredUrl", "expired_url"],
    ["slug", "slug"],
  ];

  for (const [key, column] of columns) {
    if (patch[key] !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(patch[key] as string | number | null);
    }
  }

  if (patch.isActive !== undefined) {
    assignments.push("is_active = ?");
    values.push(patch.isActive ? 1 : 0);
  }

  if (assignments.length === 0) {
    return findById(db, id);
  }

  assignments.push("updated_at = ?");
  values.push(now, id);

  try {
    return await db
      .prepare(`UPDATE links SET ${assignments.join(", ")} WHERE id = ? RETURNING *`)
      .bind(...values)
      .first<LinkRow>();
  } catch (error) {
    if (isUniqueViolation(error) && patch.slug) throw new SlugTakenError(patch.slug);
    throw error;
  }
}

export async function softDeleteLink(db: D1Database, id: number, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE links SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(now, now, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function restoreLink(db: D1Database, id: number, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE links SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL",
    )
    .bind(now, id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function listLinks(
  db: D1Database,
  options: ListLinksOptions,
  now: number,
): Promise<{ items: LinkRow[]; total: number }> {
  const where: string[] = [];
  const values: (string | number)[] = [];
  const status = options.status ?? "all";

  if (status === "deleted") {
    where.push("l.deleted_at IS NOT NULL");
  } else {
    where.push("l.deleted_at IS NULL");
  }

  if (status === "active") {
    where.push("l.is_active = 1 AND (l.expires_at IS NULL OR l.expires_at > ?)");
    values.push(now);
  } else if (status === "inactive") {
    where.push("l.is_active = 0");
  } else if (status === "expired") {
    where.push("l.expires_at IS NOT NULL AND l.expires_at <= ?");
    values.push(now);
  }

  if (options.search) {
    where.push("(l.slug LIKE ? OR l.title LIKE ? OR l.target_url LIKE ?)");
    const pattern = `%${options.search}%`;
    values.push(pattern, pattern, pattern);
  }

  const join = options.tagId ? "JOIN link_tags lt ON lt.link_id = l.id" : "";
  if (options.tagId) {
    where.push("lt.tag_id = ?");
    values.push(options.tagId);
  }

  const clause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  const totalRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM links l ${join} ${clause}`)
    .bind(...values)
    .first<{ total: number }>();

  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const { results } = await db
    .prepare(
      `SELECT l.* FROM links l ${join} ${clause} ORDER BY l.created_at DESC, l.id DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values, limit, offset)
    .all<LinkRow>();

  return { items: results, total: totalRow?.total ?? 0 };
}
