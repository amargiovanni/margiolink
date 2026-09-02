import { useState } from "react";
import { useTags } from "../../lib/queries";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";

export interface TagPickerProps {
  value: number[];
  onChange: (tagIds: number[]) => void;
  className?: string;
}

/** Collapsed until asked for, so a link created without tagging never pays
 *  for a tags request it doesn't need — `ExpandedTagPicker` below is a
 *  separate component specifically so its `useTags()` call only happens
 *  once it actually mounts, rather than every time `LinkForm` renders. */
export function TagPicker({ value, onChange, className }: TagPickerProps) {
  const [expanded, setExpanded] = useState(value.length > 0);

  if (!expanded) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setExpanded(true)}
        className={cn("self-start", className)}
      >
        Add tags
      </Button>
    );
  }

  return <ExpandedTagPicker value={value} onChange={onChange} className={className} />;
}

/** A toggle-button group rather than a `<select multiple>` — every tag stays
 *  visible and reachable by Tab, and each one announces its own pressed
 *  state instead of requiring Ctrl/Cmd-click to multi-select. Silent about
 *  failure the same way the Links page's tag filter is: when the tags query
 *  fails there is nothing honest to render as a picker, so this says so
 *  rather than showing an empty, seemingly tag-less list. */
function ExpandedTagPicker({ value, onChange, className }: TagPickerProps) {
  const tagsQuery = useTags();

  if (tagsQuery.isError) {
    return (
      <p role="note" className="text-sm text-ink-faint">
        Tags unavailable
      </p>
    );
  }

  const tags = tagsQuery.data?.tags ?? [];
  if (tagsQuery.isPending || tags.length === 0) return null;

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((existing) => existing !== id) : [...value, id]);
  }

  return (
    <fieldset className={cn("flex flex-col gap-1.5 border-0 p-0", className)}>
      <legend className="text-sm text-ink-muted">Tags</legend>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const selected = value.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={selected}
              onClick={() => toggle(tag.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                selected ? "border-accent bg-accent/10 text-ink" : "border-rule text-ink-muted",
              )}
            >
              {tag.name}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
