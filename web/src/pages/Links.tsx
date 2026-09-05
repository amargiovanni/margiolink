import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { PageHeader } from "../components/layout/PageHeader";
import { LinkDialog } from "../components/links/LinkDialog";
import { LinkRow } from "../components/links/LinkRow";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { Panel } from "../components/ui/Panel";
import { Select } from "../components/ui/Select";
import { type Link, useInfiniteLinks, useSparklines, useTags } from "../lib/queries";
import { linkSearchIsTooLong, MAX_LINK_SEARCH_BYTES } from "../lib/search";

const SEARCH_DEBOUNCE_MS = 250;

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "expired", label: "Expired" },
  // `status=deleted` is the only filter value the API's own "all" doesn't
  // cover — `listLinks` excludes soft-deleted rows even under "all" (see
  // `src/db/links.ts`), so a deleted link is otherwise unreachable from this
  // page even though `useRestoreLink` exists to bring one back.
  { value: "deleted", label: "Deleted" },
];

/** The working list — spec §6.1. Search asks the API rather than filtering
 *  the current page in the browser: the list is paginated and the browser
 *  only holds the pages it has loaded, so a client-side filter would silently
 *  search a subset and look like it worked. */
export default function Links() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [tagId, setTagId] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const searchTooLong = linkSearchIsTooLong(searchInput);

  // The command palette's "New link" action can't reach this page's own
  // dialog state directly — it navigates here with `?new=1` instead, and
  // this consumes that one-shot intent on arrival, stripping the param so a
  // later back/forward navigation or refresh doesn't reopen the dialog on
  // its own.
  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    setCreateOpen(true);
    setSearchParams(
      (params) => {
        params.delete("new");
        return params;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams]);

  // Debounced into the query key: the fetch only fires once typing settles
  // for 250ms, rather than once per keystroke. Search, status, and tag are
  // each part of the infinite query key, so every filter combination has an
  // isolated result set. A first visit starts at its first page; revisiting a
  // cached key can reuse the pages already loaded for it. An overlong search
  // remains in the input for correction without replacing the last valid
  // result set.
  useEffect(() => {
    if (searchTooLong) return;
    const id = window.setTimeout(() => {
      setSearch(searchInput);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchInput, searchTooLong]);

  function handleStatusChange(value: string) {
    setStatus(value);
  }

  function handleTagChange(value: string) {
    setTagId(value);
  }

  const linksQuery = useInfiniteLinks({
    search: search || undefined,
    status: status === "all" ? undefined : status,
    tagId: tagId === "all" ? undefined : Number(tagId),
  });
  const tagsQuery = useTags();
  const sparklinesQuery = useSparklines(7);

  const tagOptions = [
    { value: "all", label: "All tags" },
    ...(tagsQuery.data?.tags.map((tag) => ({ value: String(tag.id), label: tag.name })) ?? []),
  ];

  const links = useMemo(() => {
    const unique = new Map<number, Link>();
    for (const page of linksQuery.data?.pages ?? []) {
      for (const link of page.links) unique.set(link.id, link);
    }
    return [...unique.values()];
  }, [linksQuery.data]);
  const total = linksQuery.data?.pages.at(-1)?.total ?? 0;

  // `undefined` here is genuinely ambiguous: it means "still loading" while
  // the query is in flight, but once `useSparklines` has succeeded it also
  // means "this link had zero clicks in the window" (the backend's series
  // map only carries an entry per link that had at least one click — see
  // `db/stats.ts`). Only a *successful* response lets that second meaning
  // resolve to a real all-zero array; anything else must stay `null`
  // ("unavailable") rather than silently becoming a false zero.
  function sparklineFor(linkId: number): number[] | null {
    if (!sparklinesQuery.isSuccess) return null;
    const days = sparklinesQuery.data.days;
    return sparklinesQuery.data.series[String(linkId)] ?? new Array(days).fill(0);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Link workspace"
        title="Links"
        description="Find, organise and act on every short link without losing the traffic context around it."
        actions={
          <Button aria-label="New link" onClick={() => setCreateOpen(true)}>
            New link
          </Button>
        }
      />

      <Panel className="p-4 sm:p-5">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field
              id="links-search"
              label="Search"
              className="flex-1"
              error={
                searchTooLong
                  ? `Search is too long. Use ${MAX_LINK_SEARCH_BYTES} bytes or fewer; accented letters and symbols may use more than one byte.`
                  : undefined
              }
            >
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search by slug, title or destination"
                className="min-h-11 w-full rounded-xl border border-rule bg-surface-raised px-3 py-2 text-ink outline-none placeholder:text-ink-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </Field>
            <Field id="links-status" label="Status">
              <Select
                value={status}
                onValueChange={handleStatusChange}
                options={STATUS_OPTIONS}
                aria-label="Status"
              />
            </Field>
            {tagsQuery.isError ? (
              // An empty "All tags"-only dropdown would be indistinguishable
              // from a system that genuinely has no tags — this says plainly
              // that the filter itself couldn't load, rather than implying
              // there is nothing to filter by.
              <div className="flex flex-col gap-1">
                <span className="text-sm text-ink-muted">Tag</span>
                {/* `role="status"` (not `"note"`): the tags query can fail on a
                    background refetch after the filter has already rendered
                    successfully once, and a plain `"note"` role carries no
                    implicit live region — the swap to "unavailable" would
                    change the page with nothing announced to a screen-reader
                    user who isn't looking at it. `"status"` is polite rather
                    than `"alert"`'s assertive, matching a degraded-but-usable
                    filter rather than a failed request. */}
                <p
                  role="status"
                  className="min-h-11 rounded-xl border border-dashed border-rule px-3 py-2 text-sm text-ink-faint"
                >
                  Tag filter unavailable
                </p>
              </div>
            ) : (
              <Field id="links-tag" label="Tag">
                <Select
                  value={tagId}
                  onValueChange={handleTagChange}
                  options={tagOptions}
                  aria-label="Tag"
                />
              </Field>
            )}
          </div>

          {linksQuery.isSuccess ? (
            <p role="status" className="text-xs font-semibold tracking-wide text-ink-muted">
              {total === 1 ? "1 link" : `${total} links`}
            </p>
          ) : null}
        </div>
      </Panel>

      {linksQuery.isError && links.length === 0 ? (
        <p role="alert" className="text-sm text-critical">
          Could not load links. Try again.
        </p>
      ) : linksQuery.isPending ? (
        <p className="text-sm text-ink-muted">Loading links…</p>
      ) : links.length === 0 ? (
        // The Deleted filter's own empty state is never "create your
        // first link" — there may be many links, none of them deleted,
        // and offering to create one is a non-sequitur in that context.
        status === "deleted" ? (
          <EmptyState
            title="No deleted links"
            description="Links you delete stay here, with a way to restore them."
          />
        ) : (
          <EmptyState
            title="No links yet"
            description="Use New link above to create your first short link."
          />
        )
      ) : (
        <Panel className="overflow-hidden px-3 sm:px-5">
          <div className="flex flex-col">
            {links.map((link) => (
              <LinkRow key={link.id} link={link} sparkline={sparklineFor(link.id)} />
            ))}
          </div>
        </Panel>
      )}

      {linksQuery.isFetchNextPageError ? (
        <p role="alert" className="text-center text-sm text-critical">
          Could not load more links. Your loaded links are still here.
        </p>
      ) : null}

      {links.length > 0 && (linksQuery.hasNextPage || linksQuery.isFetchNextPageError) && (
        <div className="flex justify-center pt-2">
          <Button
            variant="ghost"
            disabled={linksQuery.isFetchingNextPage}
            onClick={() => void linksQuery.fetchNextPage()}
          >
            {linksQuery.isFetchingNextPage
              ? "Loading more…"
              : linksQuery.isFetchNextPageError
                ? "Try loading more again"
                : "Load more"}
          </Button>
        </div>
      )}

      <LinkDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
