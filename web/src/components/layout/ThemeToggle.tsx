import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { type Theme, useTheme } from "../../lib/theme";

const OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const satisfies readonly { value: Theme; label: string; Icon: typeof Sun }[];

/** Three states, not two: "system" removes the `data-theme` stamp entirely so
 *  the media query in tokens.css decides, while "light"/"dark" stamp it so
 *  the explicit choice wins in both directions. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[0];

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Theme"
          className="flex h-10 items-center gap-2 rounded-xl border border-rule bg-surface-raised/80 px-3 text-sm text-ink-muted shadow-sm transition-all hover:-translate-y-0.5 hover:border-rule-strong hover:text-ink"
        >
          <current.Icon className="size-4" />
          <span className="sr-only lg:not-sr-only">{current.label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-40 rounded-xl border border-rule bg-surface-raised p-1.5 shadow-2xl"
        >
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            {OPTIONS.map((option) => (
              <DropdownMenu.RadioItem
                key={option.value}
                value={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-ink outline-none data-[highlighted]:bg-surface-soft"
              >
                <option.Icon className="size-4" />
                <span className="flex-1">{option.label}</span>
                <DropdownMenu.ItemIndicator>
                  <Check className="size-4" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
