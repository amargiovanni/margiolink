import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { createTag, deleteTag, listTags, TagNameTakenError } from "../../db/tags";
import type { Env } from "../../types";

const tagSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const tags = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

tags.use("*", requireSession);

tags.get("/", async (c) => c.json({ tags: await listTags(c.env.DB) }));

tags.post("/", async (c) => {
  const parsed = tagSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  try {
    const tag = await createTag(c.env.DB, parsed.data.name, parsed.data.color);
    return c.json({ tag }, 201);
  } catch (error) {
    if (error instanceof TagNameTakenError) return c.json({ error: "tag_exists" }, 409);
    throw error;
  }
});

tags.delete("/:id", async (c) => {
  const removed = await deleteTag(c.env.DB, Number(c.req.param("id")));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
