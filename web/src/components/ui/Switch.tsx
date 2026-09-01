import * as RadixSwitch from "@radix-ui/react-switch";
import { cn } from "./cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  /** Required when the switch has no associated `<label htmlFor>` — Radix
   *  renders a real `button[role=switch]`, but that button still needs a
   *  name from somewhere. */
  "aria-label"?: string;
  className?: string;
}

/** Wraps Radix's Switch, which renders `role="switch"` with `aria-checked`
 *  and full keyboard support (Space/Enter to toggle) on a real `<button>`. */
export function Switch({ checked, onCheckedChange, className, ...props }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative h-6 w-10 shrink-0 rounded-full bg-surface-sunken transition-colors data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-1 rounded-full bg-ink-faint transition-transform data-[state=checked]:translate-x-5 data-[state=checked]:bg-accent-ink" />
    </RadixSwitch.Root>
  );
}
