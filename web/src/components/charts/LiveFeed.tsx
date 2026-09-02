import { Pause, Play } from "lucide-react";
import { useState } from "react";
import { formatRelative } from "../../lib/format";
import { useLive } from "../../lib/queries";
import { Button } from "../ui/Button";

const CHANNEL_LABEL: Record<string, string> = {
  direct: "Direct",
  search: "Search",
  social: "Social",
  email: "Email",
  ai: "AI",
  other: "Other",
};

function channelLabel(referrerType: string | null): string {
  if (!referrerType) return "Unknown";
  return CHANNEL_LABEL[referrerType] ?? referrerType;
}

function outcomeLabel(outcome: string): string {
  switch (outcome) {
    case "redirect":
      return "Redirected";
    case "inactive":
      return "Inactive link";
    case "expired":
      return "Expired link";
    case "password_required":
      return "Password required";
    case "password_failed":
      return "Password failed";
    default:
      return outcome;
  }
}

/** The live click feed — spec §6.1. Polls every 10 seconds via `useLive`.
 *
 * The list is never a live region: an item list that re-announces itself
 * every ten seconds is hostile to a screen-reader user, who would hear the
 * whole feed read out again on every poll with no way to opt out. `aria-live`
 * is explicitly "off" (the default for a plain element, made explicit here so
 * it reads as a decision rather than an oversight) — a reader who wants an
 * update asks for one with the Pause/Resume control below instead of having
 * one forced on them.
 */
export function LiveFeed({ linkId }: { linkId: number }) {
  const [paused, setPaused] = useState(false);
  const query = useLive(50, linkId, { paused });

  function toggle() {
    const resuming = paused;
    setPaused(!paused);
    // Resuming restarts the 10s interval, but the reader who just asked for
    // updates should not have to wait up to 10s for the first one.
    if (resuming) query.refetch();
  }

  const clicks = query.data?.clicks ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted" role="status">
          {paused ? "Paused" : "Live — updating every 10 seconds"}
        </p>
        <Button variant="ghost" size="sm" onClick={toggle} aria-label={paused ? "Resume" : "Pause"}>
          {paused ? (
            <>
              <Play className="size-4" aria-hidden="true" />
              Resume
            </>
          ) : (
            <>
              <Pause className="size-4" aria-hidden="true" />
              Pause
            </>
          )}
        </Button>
      </div>

      {query.isError ? (
        <p role="alert" className="text-sm text-critical">
          Live feed unavailable. Try again.
        </p>
      ) : query.isPending ? (
        <p className="text-sm text-ink-muted">Loading recent activity…</p>
      ) : clicks.length === 0 ? (
        <p className="text-sm text-ink-faint">No recent activity.</p>
      ) : (
        <ul aria-live="off" className="flex flex-col gap-2">
          {clicks.map((click) => (
            <li
              key={click.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule/50 py-1.5 text-sm last:border-0"
            >
              <span className="text-ink-muted">{formatRelative(click.ts)}</span>
              <span>{click.country ?? "Unknown"}</span>
              <span>{click.device ?? "Unknown device"}</span>
              <span>{channelLabel(click.referrerType)}</span>
              <span className="text-ink-muted">{outcomeLabel(click.outcome)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
