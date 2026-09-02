import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "./cn";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps
  extends Pick<ComponentPropsWithoutRef<"button">, "aria-invalid" | "aria-describedby"> {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  id?: string;
  placeholder?: string;
  className?: string;
  /** Required — Radix's trigger renders a real `<button>` and it needs a
   *  name from somewhere. When Select sits inside a `Field`, pass the same
   *  text as the Field's own `label`: a harmless duplicate accessible name
   *  beats a nameless control, and Select cannot see whether a `Field`
   *  wraps it. */
  "aria-label": string;
}

/** Wraps Radix's Select for listbox keyboard behaviour, typeahead and
 *  portal rendering. `Field` can wrap this the same way it wraps a plain
 *  `<input>` — the trigger accepts `id`, `aria-invalid` and
 *  `aria-describedby` like any other control, typed explicitly here rather
 *  than relying on an untyped rest-spread to carry them through. */
export function Select({
  value,
  onValueChange,
  options,
  id,
  placeholder,
  className,
  ...triggerProps
}: SelectProps) {
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange}>
      <RadixSelect.Trigger
        id={id}
        className={cn(
          "flex items-center justify-between gap-2 rounded border border-rule bg-surface px-3 py-2 text-sm text-ink data-[placeholder]:text-ink-faint",
          className,
        )}
        {...triggerProps}
      >
        <RadixSelect.Value placeholder={placeholder} />
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-ink-muted" aria-hidden="true" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className="overflow-hidden rounded border border-rule bg-surface-raised shadow-lg">
          <RadixSelect.Viewport className="p-1">
            {options.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-ink data-[highlighted]:bg-surface-sunken"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className="ml-auto">
                  <Check className="size-4" aria-hidden="true" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
