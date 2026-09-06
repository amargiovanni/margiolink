import { Hono } from "hono";
import { z } from "zod";
import { createTag, deleteTag, listTags, TagNameTakenError } from "../../db/tags";
import { readJsonBody } from "../../lib/body-limit";
import { parsePositiveInteger } from "../../lib/validation";
import type { Env } from "../../types";

const tagSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export const tags = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

tags.get("/", async (c) => c.json({ tags: await listTags(c.env.DB) }));

tags.post("/", async (c) => {
  const body = await readJsonBody(c.req.raw);
  if (!body.ok) {
    const status =
      body.error === "payload_too_large"
        ? 413
        : body.error === "unsupported_media_type"
          ? 415
          : 400;
    return c.json({ error: body.error }, status);
  }
  const parsed = tagSchema.safeParse(body.value);
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
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const removed = await deleteTag(c.env.DB, id);
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});
