import { useEffect, useState } from "react";
import { useMeta } from "./queries";
import { droppedPeriodsNote, type PeriodId, periodsFor } from "./ranges";

export interface PeriodSelection {
  periodId: PeriodId;
  setPeriodId: (id: PeriodId) => void;
  /** The periods safe to offer at this deployment's retention window — see
   *  `periodsFor` in `ranges.ts`. Empty while `retentionDays` isn't known
   *  yet (`useMeta` still pending or failed): offering nothing until
   *  retention is actually known is the fail-closed choice, the same one
   *  `periodsFor` itself makes for a period whose comparison window can't
   *  be verified safe. */
  periods: ReturnType<typeof periodsFor>;
  /** A line naming the retention window, to show next to the picker,
   *  whenever it dropped one or more periods off the full list — `null`
   *  when nothing was dropped or retention isn't known yet. */
  periodNote: string | null;
  metaQuery: ReturnType<typeof useMeta>;
}

/**
 * The one place both dashboard pages (Overview, LinkDetail) get their
 * period list from — previously duplicated verbatim in each page's own
 * component body, which is exactly the kind of duplication that drifts:
 * a fix applied to one copy and not the other silently reintroduces
 * Finding 1 (`docs` at `ranges.ts`'s `periodsFor`) on whichever page keeps
 * the stale copy.
 *
 * `defaultPeriodId` is the period selected before the deployment's real
 * retention is known, and the one an out-of-range selection falls back to
 * if `periods` ever comes back empty (see the effect below) — both pages
 * pass `"7d"`, which is safe at any retention this product would ever be
 * configured with, but the fallback is spelled out explicitly rather than
 * hardcoded here so a future caller with a different default is not
 * silently overridden.
 */
export function usePeriodSelection(defaultPeriodId: PeriodId): PeriodSelection {
  const [periodId, setPeriodId] = useState<PeriodId>(defaultPeriodId);
  const metaQuery = useMeta();
  const retentionDays = metaQuery.data?.retentionDays;
  const periods = retentionDays !== undefined ? periodsFor(retentionDays) : [];
  const periodNote = retentionDays !== undefined ? droppedPeriodsNote(retentionDays) : null;

  // Once the deployment's real retention is known, a previously-selected
  // period that retention no longer supports (e.g. "12m" against a shorter
  // window than when the page first rendered) must not stay silently
  // selected — that would keep fetching the exact false comparison this
  // guard exists to prevent. Falls back to the longest period retention
  // still supports, defaulting to `defaultPeriodId` when nothing does.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change in the known retention window should re-run this — `periods` is a fresh array every render (recomputed from `periodsFor`) and `periodId` is this same effect's own target, so listing either would re-run it every render or fight the very state it sets.
  useEffect(() => {
    if (retentionDays === undefined) return;
    if (periods.some((p) => p.id === periodId)) return;
    setPeriodId(periods.at(-1)?.id ?? defaultPeriodId);
  }, [retentionDays]);

  return { periodId, setPeriodId, periods, periodNote, metaQuery };
}
