import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";

type CopyStatus = "idle" | "copied" | "error";

export interface CopyButtonProps {
  value: string;
  /** Also the accessible name — the button carries no visible text of its
   *  own, only an icon. */
  label: string;
  className?: string;
}

/** `navigator.clipboard` is absent over plain HTTP and inside some embedded
 *  browsers. A copy button that appears to work and silently does nothing in
 *  that case is worse than one that says it cannot — so both outcomes are
 *  announced in a `role="status"` region, not only shown visually. */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [status, setStatus] = useState<CopyStatus>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  async function handleClick() {
    const next: CopyStatus = navigator.clipboard
      ? await navigator.clipboard
          .writeText(value)
          .then(() => "copied" as const)
          .catch(() => "error" as const)
      : "error";

    setStatus(next);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus("idle"), 2000);
  }

  return (
    <span className={className}>
      <Button variant="ghost" size="sm" aria-label={label} onClick={handleClick}>
        {status === "copied" ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </Button>
      {/* Visually hidden but always present, so the confirmation reaches a
       *  screen reader the same way it reaches a sighted user watching the
       *  icon swap. */}
      <span role="status" className="sr-only">
        {status === "copied" ? "Copied" : status === "error" ? "Could not copy" : ""}
      </span>
    </span>
  );
}
