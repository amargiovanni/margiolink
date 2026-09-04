import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { PageHeader } from "../components/layout/PageHeader";
import { ConfirmDialog } from "../components/links/ConfirmDialog";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { Panel } from "../components/ui/Panel";
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
  "min-h-11 w-full rounded-xl border border-rule bg-surface-raised px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/20";

/** A decorative colour dot — never the only carrier of a tag's identity.
 *  Every place this renders sits next to the tag's name as visible text
 *  (the list below, the live preview in the create form), which is what
 *  keeps a tag distinguishable for a reader who cannot perceive its
 *  colour. */
function TagSwatch({ color, large = false }: { color: string; large?: boolean }) {
  const valid = HEX_SHAPE.test(color);
  return (
    <span
      aria-hidden="true"
      className={`${large ? "size-11 rounded-xl" : "size-4 rounded-full"} inline-block shrink-0 border border-rule`}
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
      className="mt-6 flex flex-col items-stretch gap-4"
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
          className="flex-1"
        >
          <input
            type="text"
            placeholder="#2a78d6"
            className={inputClassName}
            {...register("color")}
          />
        </Field>
        <TagSwatch color={color} large />
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
    <li className="flex items-center justify-between gap-3 border-b border-rule px-2 py-4 transition-colors last:border-b-0 hover:bg-surface-soft/60">
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
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Organisation"
        title="Tags"
        description="Build a small, legible taxonomy for campaigns, teams and destinations."
      />

      <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Panel as="section" aria-labelledby="create-tag-heading" className="p-5 sm:p-6">
          <h2 id="create-tag-heading" className="font-display text-2xl font-semibold text-ink">
            Create a tag
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            Use concise names and a colour that stays recognisable across the workspace.
          </p>
          <CreateTagForm />
        </Panel>

        <Panel as="section" aria-labelledby="tag-library-heading" className="p-5 sm:p-6">
          <div className="flex items-baseline justify-between gap-4 border-b border-rule pb-4">
            <h2 id="tag-library-heading" className="font-display text-2xl font-semibold text-ink">
              Tag library
            </h2>
            {tagsQuery.isSuccess ? (
              <p className="text-xs font-semibold text-ink-muted">
                {tags.length} {tags.length === 1 ? "tag" : "tags"}
              </p>
            ) : null}
          </div>

          <div className="pt-3">
            {tagsQuery.isError ? (
              <p role="alert" className="py-4 text-sm text-critical">
                Could not load tags. Try again.
              </p>
            ) : tagsQuery.isPending ? (
              <p className="py-4 text-sm text-ink-muted">Loading tags…</p>
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
        </Panel>
      </div>
    </div>
  );
}
