import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../../lib/api";
import type { Link } from "../../lib/queries";
import { useCreateLink, useSetLinkTags, useUpdateLink } from "../../lib/queries";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { TagPicker } from "./TagPicker";

const SLUG_SHAPE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const PROTOCOL_SHAPE = /^https?:\/\//i;

// `superRefine` rather than chained `.min()`/`.regex()` checks: those both
// run independently and an empty destination would fail *both*, leaving the
// resolver to pick one of two simultaneous issues for the same field. This
// way an empty value produces exactly the "enter a destination" issue and
// nothing else, and a non-empty, wrong-protocol value produces exactly the
// protocol issue — the two client-side mistakes stay distinguishable.
const schema = z.object({
  targetUrl: z
    .string()
    .trim()
    .superRefine((value, ctx) => {
      if (!value) {
        ctx.addIssue("Enter a destination.");
        return;
      }
      if (!PROTOCOL_SHAPE.test(value)) {
        ctx.addIssue("That destination must start with http:// or https://.");
      }
    }),
  slug: z
    .string()
    .refine(
      (value) => value === "" || SLUG_SHAPE.test(value),
      "Use letters, digits, dashes and underscores.",
    ),
  title: z.string(),
  description: z.string(),
  expiresAt: z.string(),
  expiredUrl: z.string(),
  password: z.string(),
});

type FormValues = z.infer<typeof schema>;

function unixToLocalInput(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localInputToUnix(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

export interface LinkFormProps {
  mode: "create" | "edit";
  link?: Link;
  /** Called once the mutation has succeeded. In create mode it is called
   *  with the new link, so the caller (LinkDialog) can copy its short URL
   *  and announce that in a toast that outlives this form — the form itself
   *  only knows how to submit and validate. In edit mode it is called with
   *  no argument. */
  onDone: (createdLink?: Link) => void;
}

/** Every field-shaped error the API can return, mapped to where it belongs
 *  per the design brief's table. Anything not in this map — `rate_limited`
 *  is handled separately below because it belongs on the banner, not a
 *  field — falls through to the generic banner message. */
const FIELD_ERROR_CODES: Record<
  string,
  { field: "slug" | "targetUrl" | "expiredUrl"; message: string }
> = {
  slug_taken: { field: "slug", message: "That slug is already in use." },
  reserved_slug: { field: "slug", message: "That slug is reserved. Pick another." },
  invalid_slug: { field: "slug", message: "Use letters, digits, dashes and underscores." },
  unsupported_protocol: {
    field: "targetUrl",
    message: "Only http and https destinations are allowed.",
  },
  self_reference: {
    field: "targetUrl",
    message: "A link cannot point at the shortener itself.",
  },
  invalid: { field: "targetUrl", message: "That does not look like a URL." },
  too_long: { field: "targetUrl", message: "That does not look like a URL." },
  invalid_expired_url: { field: "expiredUrl", message: "That does not look like a URL." },
};

const inputClassName =
  "w-full rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint";

/** Create and edit share every field, so one form handles both — the API
 *  schema mirrors the API's own validation closely enough to catch the
 *  obvious mistakes (an empty destination, a `javascript:` URL) before they
 *  ever leave the browser, but the API stays authoritative: every error code
 *  it can return is mapped to a field or a banner in `FIELD_ERROR_CODES`
 *  below, rather than trusting the client schema to have already caught it. */
export function LinkForm({ mode, link, onDone }: LinkFormProps) {
  const [banner, setBanner] = useState<string | null>(null);
  const [tagIds, setTagIds] = useState<number[]>(() => link?.tags.map((tag) => tag.id) ?? []);
  const [passwordRemoved, setPasswordRemoved] = useState(false);

  const createMutation = useCreateLink();
  const updateMutation = useUpdateLink();
  const removePasswordMutation = useUpdateLink();
  const setTagsMutation = useSetLinkTags();

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      targetUrl: link?.targetUrl ?? "",
      slug: link?.slug ?? "",
      title: link?.title ?? "",
      description: link?.description ?? "",
      expiresAt: link?.expiresAt ? unixToLocalInput(link.expiresAt) : "",
      expiredUrl: link?.expiredUrl ?? "",
      password: "",
    },
  });

  const expiresAt = watch("expiresAt");

  function applyError(error: unknown) {
    if (error instanceof ApiError) {
      const mapped = FIELD_ERROR_CODES[error.code];
      if (mapped) {
        setError(mapped.field, { type: "server", message: mapped.message });
        return;
      }
      if (error.code === "rate_limited") {
        setBanner("Too many links created recently. Try again shortly.");
        return;
      }
    }
    setBanner("Something went wrong. Try again.");
  }

  async function onSubmit(values: FormValues) {
    setBanner(null);
    const isEdit = mode === "edit";
    const body: Record<string, unknown> = { targetUrl: values.targetUrl };
    if (values.slug) body.slug = values.slug;

    // `updateLink` (src/db/links.ts) skips any column whose patch value is
    // `undefined` and writes NULL for one that is explicitly `null` — that
    // is the entire reason the API distinguishes "absent" from "null" for
    // these fields. In create mode there is nothing to clear, so an empty
    // field is simply omitted; in edit mode an emptied field must send an
    // explicit `null` or the old value survives the save silently.
    if (values.title) body.title = values.title;
    else if (isEdit) body.title = null;

    if (values.description) body.description = values.description;
    else if (isEdit) body.description = null;

    if (values.expiresAt) {
      body.expiresAt = localInputToUnix(values.expiresAt);
      if (values.expiredUrl) body.expiredUrl = values.expiredUrl;
      // A fallback URL with no expiry to belong to is meaningless — clear
      // it along with the expiry rather than leaving it orphaned.
      else if (isEdit) body.expiredUrl = null;
    } else if (isEdit) {
      body.expiresAt = null;
      body.expiredUrl = null;
    }

    if (values.password) body.password = values.password;

    try {
      if (mode === "create") {
        const result = await createMutation.mutateAsync(body);
        if (tagIds.length > 0) {
          await setTagsMutation.mutateAsync({ id: result.link.id, tagIds });
        }
        onDone(result.link);
      } else if (link) {
        await updateMutation.mutateAsync({ id: link.id, ...body });
        await setTagsMutation.mutateAsync({ id: link.id, tagIds });
        onDone();
      }
    } catch (error) {
      applyError(error);
    }
  }

  async function handleRemovePassword() {
    if (!link) return;
    setPasswordRemoved(false);
    try {
      await removePasswordMutation.mutateAsync({ id: link.id, password: null });
      setPasswordRemoved(true);
    } catch (error) {
      applyError(error);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {banner && (
        <p
          role="alert"
          className="rounded border border-critical/40 bg-critical/10 px-3 py-2 text-sm text-critical"
        >
          {banner}
        </p>
      )}

      <Field id="link-target-url" label="Destination" error={errors.targetUrl?.message}>
        <input
          type="url"
          placeholder="https://example.com/page"
          className={inputClassName}
          {...register("targetUrl")}
        />
      </Field>

      <Field
        id="link-slug"
        label="Custom slug"
        hint={
          mode === "create"
            ? "Generated automatically if left blank."
            : "Changing this breaks the old short link."
        }
        error={errors.slug?.message}
      >
        <input type="text" className={inputClassName} {...register("slug")} />
      </Field>

      <Field id="link-title" label="Title (optional)">
        <input type="text" className={inputClassName} {...register("title")} />
      </Field>

      <Field id="link-description" label="Description (optional)">
        <textarea rows={2} className={inputClassName} {...register("description")} />
      </Field>

      <Field id="link-expires-at" label="Expires (optional)">
        <input type="datetime-local" className={inputClassName} {...register("expiresAt")} />
      </Field>

      {expiresAt && (
        <Field
          id="link-expired-url"
          label="Fallback URL"
          hint="Where to send visitors once the link expires."
          error={errors.expiredUrl?.message}
        >
          <input type="url" className={inputClassName} {...register("expiredUrl")} />
        </Field>
      )}

      <Field id="link-password" label="Password (optional)">
        <input type="password" className={inputClassName} {...register("password")} />
      </Field>

      {mode === "edit" && link?.hasPassword && (
        <div className="flex flex-col items-start gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            loading={removePasswordMutation.isPending}
            onClick={handleRemovePassword}
          >
            Remove password
          </Button>
          {/* A failure already surfaces through the shared `banner` above
           *  (`applyError`) — this only needs to confirm success, which
           *  nothing else here would otherwise announce. */}
          {passwordRemoved && (
            <p role="status" className="text-sm text-ink-muted">
              Password removed.
            </p>
          )}
        </div>
      )}

      <TagPicker value={tagIds} onChange={setTagIds} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {mode === "create" ? "Create link" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
