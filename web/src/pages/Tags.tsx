import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ConfirmDialog } from "../components/links/ConfirmDialog";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { ApiError } from "../lib/api";
import type { Tag } from "../lib/queries";
import { useCreateTag, useDeleteTag, useTags } from "../lib/queries";

const HEX_SHAPE = /^#[0-9a-fA-F]{6}$/;

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name."),
  color: z.string().trim().regex(HEX_SHAPE, "Use a 6-digit hex colour, like #2a78d6."),
});

type FormValues = z.infer<typeof schema>;

const inputClassName =
  "rounded border border-rule bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint";

/** A decorative colour dot — never the only carrier of a tag's identity.
 *  Every place this renders sits next to the tag's name as visible text
 *  (the list below, the live preview in the create form), which is what
 *  keeps a tag distinguishable for a reader who cannot perceive its
 *  colour. */
function TagSwatch({ color }: { color: string }) {
  const valid = HEX_SHAPE.test(color);
  return (
    <span
      aria-hidden="true"
      className="inline-block size-4 shrink-0 rounded-full border border-rule"
      style={valid ? { backgroundColor: color } : undefined}
    />
  );
}

/** The create form. A duplicate name (`409 tag_exists`) and an invalid hex
 *  colour both land on their own field via `setError`/the zod resolver,
 *  never a generic banner — same pattern as `LinkForm`'s `FIELD_ERROR_CODES`
 *  table, just small enough here not to need one. The colour regex runs
 *  client-side before submit even reaches the API: `handleSubmit` never
 *  calls `onSubmit` while validation fails, so a non-hex value never
 *  produces a request. */
function CreateTagForm() {
  const createMutation = useCreateTag();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", color: "#2a78d6" },
  });
  const color = watch("color");

  async function onSubmit(values: FormValues) {
    try {
      await createMutation.mutateAsync({ name: values.name.trim(), color: values.color.trim() });
      reset({ name: "", color: "#2a78d6" });
    } catch (error) {
      if (error instanceof ApiError && error.code === "tag_exists") {
        setError("name", { type: "server", message: "A tag with that name already exists" });
        return;
      }
      setError("name", { type: "server", message: "Something went wrong. Try again." });
    }
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex flex-wrap items-end gap-3 border-b border-rule pb-6"
    >
      <Field id="tag-name" label="Name" error={errors.name?.message}>
        <input type="text" className={inputClassName} {...register("name")} />
      </Field>
      <div className="flex items-end gap-2">
        <Field
          id="tag-color"
          label="Colour"
          hint="6-digit hex, e.g. #2a78d6"
          error={errors.color?.message}
        >
          <input
            type="text"
            placeholder="#2a78d6"
            className={`${inputClassName} w-32`}
            {...register("color")}
          />
        </Field>
        <TagSwatch color={color} />
      </div>
      <Button type="submit" loading={isSubmitting}>
        New tag
      </Button>
    </form>
  );
}

function TagListItem({ tag }: { tag: Tag }) {
  const deleteMutation = useDeleteTag();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleOpen() {
    setError(null);
    setOpen(true);
  }

  function handleConfirm() {
    setError(null);
    deleteMutation.mutate(tag.id, {
      onSuccess: () => setOpen(false),
      onError: () => setError("Could not delete this tag. Try again."),
    });
  }

  return (
    <li className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <span className="flex items-center gap-2">
        <TagSwatch color={tag.color} />
        <span className="text-sm text-ink">{tag.name}</span>
      </span>
      <Button variant="ghost" size="sm" onClick={handleOpen}>
        Delete
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Delete "${tag.name}"?`}
        description={`This removes the "${tag.name}" label. Links that carry it keep existing — deleting a tag never deletes the links wearing it.`}
        confirmLabel="Delete"
        confirming={deleteMutation.isPending}
        error={error}
        onConfirm={handleConfirm}
      />
    </li>
  );
}

/** Tags — spec §6.1's mention of tag filtering on Links implies the tags
 *  themselves need somewhere to be created, coloured and retired. This is
 *  that page: a create form, and the full list with a delete control per
 *  row that goes through `ConfirmDialog` (Task 10) rather than a second
 *  confirmation surface — reused here exactly as it is on the Links page's
 *  own delete action. */
export default function Tags() {
  const tagsQuery = useTags();
  const tags = tagsQuery.data?.tags ?? [];

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl text-ink">Tags</h1>

      <CreateTagForm />

      {tagsQuery.isError ? (
        <p role="alert" className="text-sm text-critical">
          Could not load tags. Try again.
        </p>
      ) : tagsQuery.isPending ? (
        <p className="text-sm text-ink-muted">Loading tags…</p>
      ) : tags.length === 0 ? (
        <EmptyState
          title="No tags yet"
          description="Create a tag above to start labelling links."
        />
      ) : (
        <ul className="flex flex-col">
          {tags.map((tag) => (
            <TagListItem key={tag.id} tag={tag} />
          ))}
        </ul>
      )}
    </div>
  );
}
