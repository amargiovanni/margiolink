import { Hono } from "hono";
import qrcode from "qrcode-generator";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import {
  createLink,
  findById,
  type LinkRow,
  listLinks,
  restoreLink,
  SlugTakenError,
  softDeleteLink,
  updateLink,
} from "../../db/links";
import { setLinkTags, tagsForLinks } from "../../db/tags";
import { hashPassword, randomSalt } from "../../lib/crypto";
import { isReservedSlug, isValidSlugShape, normaliseSlug } from "../../lib/slug";
import { validateTargetUrl } from "../../lib/url";
import type { Env } from "../../types";

export function serialiseLink(link: LinkRow, shortDomain: string) {
  return {
    id: link.id,
    slug: link.slug,
    shortUrl: `https://${shortDomain}/${link.slug}`,
    targetUrl: link.target_url,
    title: link.title,
    description: link.description,
    hasPassword: link.password_hash !== null,
    expiresAt: link.expires_at,
    expiredUrl: link.expired_url,
    isActive: link.is_active === 1,
    createdAt: link.created_at,
    updatedAt: link.updated_at,
    deletedAt: link.deleted_at,
  };
}

const createSchema = z.object({
  targetUrl: z.string().min(1),
  slug: z.string().optional(),
  title: z.string().max(200).nullish(),
  description: z.string().max(1000).nullish(),
  password: z.string().min(1).max(200).nullish(),
  expiresAt: z.number().int().positive().nullish(),
  expiredUrl: z.string().nullish(),
});

const updateSchema = createSchema.partial().extend({
  isActive: z.boolean().optional(),
});

const listSchema = z.object({
  search: z.string().optional(),
  status: z.enum(["all", "active", "inactive", "expired", "deleted"]).optional(),
  tagId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const assignTagsSchema = z.object({
  tagIds: z.array(z.number().int().positive()).max(20),
});

export const links = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

links.use("*", requireSession);

links.get("/", async (c) => {
  const parsed = listSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: "invalid_query" }, 400);

  const now = Math.floor(Date.now() / 1000);
  const { items, total } = await listLinks(c.env.DB, parsed.data, now);
  const tagMap = await tagsForLinks(
    c.env.DB,
    items.map((l) => l.id),
  );

  return c.json({
    links: items.map((l) => ({
      ...serialiseLink(l, c.env.SHORT_DOMAIN),
      tags: tagMap.get(l.id) ?? [],
    })),
    total,
  });
});

links.post("/", async (c) => {
  const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const input = parsed.data;

  const destination = validateTargetUrl(input.targetUrl, c.env.SHORT_DOMAIN);
  if (!destination.ok) return c.json({ error: destination.error }, 422);

  let slug: string | undefined;
  if (input.slug !== undefined) {
    slug = normaliseSlug(input.slug);
    if (!isValidSlugShape(slug)) return c.json({ error: "invalid_slug" }, 422);
    if (isReservedSlug(slug)) return c.json({ error: "reserved_slug" }, 422);
  }

  let expiredUrl: string | null = null;
  if (input.expiredUrl !== undefined && input.expiredUrl !== null) {
    const fallback = validateTargetUrl(input.expiredUrl, c.env.SHORT_DOMAIN);
    if (!fallback.ok) return c.json({ error: "invalid_expired_url" }, 422);
    expiredUrl = fallback.url;
  }

  let passwordHash: string | null = null;
  let passwordSalt: string | null = null;
  if (input.password) {
    passwordSalt = randomSalt();
    passwordHash = await hashPassword(input.password, passwordSalt);
  }

  const now = Math.floor(Date.now() / 1000);

  try {
    const link = await createLink(
      c.env.DB,
      {
        slug,
        targetUrl: destination.url,
        title: input.title ?? null,
        description: input.description ?? null,
        expiresAt: input.expiresAt ?? null,
        expiredUrl,
        passwordHash,
        passwordSalt,
      },
      now,
    );
    return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) }, 201);
  } catch (error) {
    if (error instanceof SlugTakenError) return c.json({ error: "slug_taken" }, 409);
    throw error;
  }
});

links.get("/:id", async (c) => {
  const link = await findById(c.env.DB, Number(c.req.param("id")));
  if (!link) return c.json({ error: "not_found" }, 404);

  const tagMap = await tagsForLinks(c.env.DB, [link.id]);
  return c.json({
    link: { ...serialiseLink(link, c.env.SHORT_DOMAIN), tags: tagMap.get(link.id) ?? [] },
  });
});

links.put("/:id/tags", async (c) => {
  const id = Number(c.req.param("id"));
  if (!(await findById(c.env.DB, id))) return c.json({ error: "not_found" }, 404);

  const parsed = assignTagsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  await setLinkTags(c.env.DB, id, parsed.data.tagIds);
  return c.json({ ok: true });
});

links.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const existing = await findById(c.env.DB, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

  const parsed = updateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  const input = parsed.data;
  const patch: Parameters<typeof updateLink>[2] = {};

  if (input.targetUrl !== undefined) {
    const destination = validateTargetUrl(input.targetUrl, c.env.SHORT_DOMAIN);
    if (!destination.ok) return c.json({ error: destination.error }, 422);
    patch.targetUrl = destination.url;
  }

  if (input.slug !== undefined) {
    const slug = normaliseSlug(input.slug);
    if (!isValidSlugShape(slug)) return c.json({ error: "invalid_slug" }, 422);
    if (isReservedSlug(slug)) return c.json({ error: "reserved_slug" }, 422);
    patch.slug = slug;
  }

  if (input.expiredUrl !== undefined) {
    if (input.expiredUrl === null) {
      patch.expiredUrl = null;
    } else {
      const fallback = validateTargetUrl(input.expiredUrl, c.env.SHORT_DOMAIN);
      if (!fallback.ok) return c.json({ error: "invalid_expired_url" }, 422);
      patch.expiredUrl = fallback.url;
    }
  }

  if (input.password !== undefined) {
    if (input.password === null) {
      patch.passwordHash = null;
      patch.passwordSalt = null;
    } else {
      const salt = randomSalt();
      patch.passwordSalt = salt;
      patch.passwordHash = await hashPassword(input.password, salt);
    }
  }

  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  try {
    const link = await updateLink(c.env.DB, id, patch, Math.floor(Date.now() / 1000));
    if (!link) return c.json({ error: "not_found" }, 404);
    return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) });
  } catch (error) {
    if (error instanceof SlugTakenError) return c.json({ error: "slug_taken" }, 409);
    throw error;
  }
});

links.delete("/:id", async (c) => {
  const removed = await softDeleteLink(
    c.env.DB,
    Number(c.req.param("id")),
    Math.floor(Date.now() / 1000),
  );
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.post("/:id/restore", async (c) => {
  const restored = await restoreLink(
    c.env.DB,
    Number(c.req.param("id")),
    Math.floor(Date.now() / 1000),
  );
  return restored ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.get("/:id/qr.svg", async (c) => {
  const link = await findById(c.env.DB, Number(c.req.param("id")));
  if (!link) return c.json({ error: "not_found" }, 404);

  const qr = qrcode(0, "M");
  qr.addData(`https://${c.env.SHORT_DOMAIN}/${link.slug}?s=qr`);
  qr.make();

  return c.body(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }), 200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "private, max-age=3600",
  });
});
