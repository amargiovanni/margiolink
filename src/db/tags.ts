export interface TagRow {
  id: number;
  name: string;
  color: string;
}

export class TagNameTakenError extends Error {
  constructor(name: string) {
    super(`Tag already exists: ${name}`);
    this.name = "TagNameTakenError";
  }
}

export async function listTags(db: D1Database): Promise<TagRow[]> {
  const { results } = await db.prepare("SELECT * FROM tags ORDER BY name").all<TagRow>();
  return results;
}

export async function createTag(db: D1Database, name: string, color: string): Promise<TagRow> {
  try {
    const row = await db
      .prepare("INSERT INTO tags (name, color) VALUES (?, ?) RETURNING *")
      .bind(name, color)
      .first<TagRow>();
    if (!row) throw new Error("Insert returned no row");
    return row;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) {
      throw new TagNameTakenError(name);
    }
    throw error;
  }
}

export async function deleteTag(db: D1Database, id: number): Promise<boolean> {
  const [, removal] = await db.batch([
    db.prepare("DELETE FROM link_tags WHERE tag_id = ?").bind(id),
    db.prepare("DELETE FROM tags WHERE id = ?").bind(id),
  ]);
  return (removal?.meta.changes ?? 0) > 0;
}

export async function setLinkTags(db: D1Database, linkId: number, tagIds: number[]): Promise<void> {
  const statements = [db.prepare("DELETE FROM link_tags WHERE link_id = ?").bind(linkId)];
  for (const tagId of tagIds) {
    statements.push(
      db
        .prepare("INSERT OR IGNORE INTO link_tags (link_id, tag_id) VALUES (?, ?)")
        .bind(linkId, tagId),
    );
  }
  await db.batch(statements);
}

export async function tagsForLinks(
  db: D1Database,
  linkIds: number[],
): Promise<Map<number, TagRow[]>> {
  const grouped = new Map<number, TagRow[]>();
  if (linkIds.length === 0) return grouped;

  const placeholders = linkIds.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      `SELECT lt.link_id AS link_id, t.id, t.name, t.color
       FROM link_tags lt
       JOIN tags t ON t.id = lt.tag_id
       WHERE lt.link_id IN (${placeholders})
       ORDER BY t.name`,
    )
    .bind(...linkIds)
    .all<TagRow & { link_id: number }>();

  for (const row of results) {
    const list = grouped.get(row.link_id) ?? [];
    list.push({ id: row.id, name: row.name, color: row.color });
    grouped.set(row.link_id, list);
  }

  return grouped;
}
