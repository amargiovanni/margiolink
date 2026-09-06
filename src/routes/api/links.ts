import { Hono } from "hono";
import qrcode from "qrcode-generator";
import { z } from "zod";
import {
  createLink,
  findById,
  type LinkRow,
  listLinks,
  releaseLinkCreation,
  reserveLinkCreation,
  restoreLink,
  SlugTakenError,
  softDeleteLink,
  updateLink,
} from "../../db/links";
import { setLinkTags, tagsForLinks } from "../../db/tags";
import { readJsonBody } from "../../lib/body-limit";
import { hashPassword, randomSalt } from "../../lib/crypto";
import { isReservedSlug, isValidSlugShape, normaliseSlug } from "../../lib/slug";
import { validateTargetUrl } from "../../lib/url";
import { parsePositiveInteger } from "../../lib/validation";
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
  search: z
    .string()
    .refine((value) => new TextEncoder().encode(value).byteLength <= 48)
    .optional(),
  status: z.enum(["all", "active", "inactive", "expired", "deleted"]).optional(),
  tagId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine(Number.isSafeInteger)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const assignTagsSchema = z.object({
  tagIds: z.array(z.number().int().positive().refine(Number.isSafeInteger)).max(20),
});

const CREATION_LIMIT_PER_HOUR = 120;
const CREATION_WINDOW_SECONDS = 3600;

export const links = new Hono<{ Bindings: Env; Variables: { sessionId: string } }>();

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
  const parsed = createSchema.safeParse(body.value);
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
  const reservation = await reserveLinkCreation(
    c.env.DB,
    now,
    CREATION_LIMIT_PER_HOUR,
    CREATION_WINDOW_SECONDS,
  );
  if (!reservation || reservation.id === 0) {
    return c.json({ error: "rate_limited" }, 429, {
      "retry-after": String(reservation?.retryAfter ?? CREATION_WINDOW_SECONDS),
    });
  }

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
    await releaseLinkCreation(c.env.DB, reservation.id);
    return c.json({ link: serialiseLink(link, c.env.SHORT_DOMAIN) }, 201);
  } catch (error) {
    await releaseLinkCreation(c.env.DB, reservation.id);
    if (error instanceof SlugTakenError) return c.json({ error: "slug_taken" }, 409);
    throw error;
  }
});

links.get("/:id", async (c) => {
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const link = await findById(c.env.DB, id);
  if (!link) return c.json({ error: "not_found" }, 404);

  const tagMap = await tagsForLinks(c.env.DB, [link.id]);
  return c.json({
    link: { ...serialiseLink(link, c.env.SHORT_DOMAIN), tags: tagMap.get(link.id) ?? [] },
  });
});

links.put("/:id/tags", async (c) => {
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  if (!(await findById(c.env.DB, id))) return c.json({ error: "not_found" }, 404);

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
  const parsed = assignTagsSchema.safeParse(body.value);
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);

  await setLinkTags(c.env.DB, id, parsed.data.tagIds);
  return c.json({ ok: true });
});

links.patch("/:id", async (c) => {
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const existing = await findById(c.env.DB, id);
  if (!existing) return c.json({ error: "not_found" }, 404);

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
  const parsed = updateSchema.safeParse(body.value);
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
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const removed = await softDeleteLink(c.env.DB, id, Math.floor(Date.now() / 1000));
  return removed ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.post("/:id/restore", async (c) => {
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const restored = await restoreLink(c.env.DB, id, Math.floor(Date.now() / 1000));
  return restored ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
});

links.get("/:id/qr.svg", async (c) => {
  const id = parsePositiveInteger(c.req.param("id"));
  if (id === null) return c.json({ error: "invalid_id" }, 400);
  const link = await findById(c.env.DB, id);
  if (!link) return c.json({ error: "not_found" }, 404);

  const qr = qrcode(0, "M");
  qr.addData(`https://${c.env.SHORT_DOMAIN}/${link.slug}?s=qr`);
  qr.make();

  return c.body(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }), 200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "private, max-age=3600",
  });
});
