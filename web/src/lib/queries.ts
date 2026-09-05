import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Link {
  id: number;
  slug: string;
  shortUrl: string;
  targetUrl: string;
  title: string | null;
  description: string | null;
  hasPassword: boolean;
  expiresAt: number | null;
  expiredUrl: string | null;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  tags: Tag[];
}

export interface Range {
  from: number;
  to: number;
  linkId?: number;
}

export interface Summary {
  clicks: number;
  uniques: number;
  bots: number;
  countries: number;
}

export interface StatsMeta {
  requestedFrom: number;
  effectiveFrom: number;
  retentionCutoff: number;
  truncated: boolean;
  uniquesDefinition: "daily-rotating-visitor-hash";
}

export interface SummaryResponse {
  current: Summary;
  previous: Summary;
  range: { from: number; to: number };
  meta: StatsMeta;
}

export interface TimeseriesResponse {
  buckets: { bucket: string; clicks: number; uniques: number }[];
  granularity: "hour" | "day" | "week";
  meta: StatsMeta;
}

export interface Slice {
  value: string;
  clicks: number;
  uniques: number;
}

export interface DimensionResponse {
  slices: Slice[];
  dimension: string;
  meta: StatsMeta;
}

export interface Meta {
  retentionDays: number;
  shortDomain: string;
}

export const keys = {
  links: (params?: unknown) => ["links", params ?? {}] as const,
  infiniteLinks: (params?: unknown) => ["links", "infinite", params ?? {}] as const,
  link: (id: number) => ["link", id] as const,
  tags: () => ["tags"] as const,
  sessions: () => ["sessions"] as const,
  stats: (kind: string, params: unknown) => ["stats", kind, params] as const,
  meta: () => ["meta"] as const,
};

export function useLinks(params: {
  search?: string;
  status?: string;
  tagId?: number;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: keys.links(params),
    queryFn: () => api.get<{ links: Link[]; total: number }>("/api/links", params),
  });
}

const LINKS_PAGE_SIZE = 20;

export function useInfiniteLinks(params: { search?: string; status?: string; tagId?: number }) {
  return useInfiniteQuery({
    queryKey: keys.infiniteLinks(params),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<{ links: Link[]; total: number }>("/api/links", {
        ...params,
        limit: LINKS_PAGE_SIZE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, _pages, lastPageParam) => {
      if (lastPage.links.length === 0 || lastPageParam + LINKS_PAGE_SIZE >= lastPage.total) {
        return undefined;
      }
      return lastPageParam + LINKS_PAGE_SIZE;
    },
  });
}

export function useLink(id: number) {
  return useQuery({
    queryKey: keys.link(id),
    queryFn: () => api.get<{ link: Link }>(`/api/links/${id}`),
    enabled: Number.isFinite(id),
  });
}

export function useTags() {
  return useQuery({ queryKey: keys.tags(), queryFn: () => api.get<{ tags: Tag[] }>("/api/tags") });
}

/** The two facts about this deployment the dashboard cannot derive from
 *  anything else it already fetches — see Step 0's note in
 *  `src/routes/api/meta.ts`. The build version is deliberately not part of
 *  this: it comes from `__APP_VERSION__` instead (`vite-env.d.ts`), injected
 *  at build time rather than served over the network. */
export function useMeta() {
  return useQuery({ queryKey: keys.meta(), queryFn: () => api.get<Meta>("/api/meta") });
}

export function useSummary(range: Range) {
  return useQuery({
    staleTime: 60_000,
    queryKey: keys.stats("summary", range),
    queryFn: () => api.get<SummaryResponse>("/api/stats/summary", { ...range }),
  });
}

export function useTimeseries(range: Range, granularity: "hour" | "day" | "week") {
  return useQuery({
    staleTime: 60_000,
    queryKey: keys.stats("timeseries", { ...range, granularity }),
    queryFn: () => api.get<TimeseriesResponse>("/api/stats/timeseries", { ...range, granularity }),
  });
}

export function useDimension(range: Range, name: string, limit = 20) {
  return useQuery({
    staleTime: 60_000,
    queryKey: keys.stats("dimension", { ...range, name, limit }),
    queryFn: () => api.get<DimensionResponse>("/api/stats/dimension", { ...range, name, limit }),
  });
}

export interface TopLink {
  id: number;
  slug: string;
  title: string | null;
  clicks: number;
  uniques: number;
}

export interface TopLinksResponse {
  links: TopLink[];
  meta: StatsMeta;
}

/** The overview page's "top links" panel — ranked by click count within
 *  `range`, unlike `useSparklines` below, which is a fixed trailing window
 *  independent of any selected period. `limit` is part of the query key
 *  along with `range`, matching `useDimension`'s pattern. */
export function useTopLinks(range: Range, limit = 5) {
  return useQuery({
    staleTime: 60_000,
    queryKey: keys.stats("top-links", { ...range, limit }),
    queryFn: () => api.get<TopLinksResponse>("/api/stats/top-links", { ...range, limit }),
  });
}

/** Polls, because the feed is the one place a stale number is visibly wrong.
 *  `linkId` is part of the query key — without it, switching between two
 *  links' detail pages would serve one link's cached feed under the other's
 *  name. `paused` stops the interval rather than the query itself, so a
 *  caller can resume by refetching once rather than waiting up to 10s. */
export function useLive(
  limit = 50,
  linkId?: number,
  { paused = false }: { paused?: boolean } = {},
) {
  return useQuery({
    queryKey: keys.stats("live", { limit, linkId }),
    queryFn: () => api.get<{ clicks: LiveClick[] }>("/api/stats/live", { limit, linkId }),
    refetchInterval: paused ? false : 10_000,
  });
}

export interface LiveClick {
  id: number;
  linkId: number;
  slug: string;
  ts: number;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  referrerType: string | null;
  source: string;
  outcome: string;
  isBot: boolean;
}

export function useSparklines(days = 7) {
  return useQuery({
    staleTime: 60_000,
    queryKey: keys.stats("sparklines", days),
    queryFn: () =>
      api.get<{ days: number; series: Record<string, number[]> }>("/api/stats/sparklines", {
        days,
      }),
  });
}

export function useSessions() {
  return useQuery({
    queryKey: keys.sessions(),
    queryFn: () => api.get<{ sessions: SessionRow[] }>("/api/auth/sessions"),
  });
}

export interface SessionRow {
  id: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  device: string | null;
  current: boolean;
}

function useInvalidate() {
  const client = useQueryClient();
  return (prefix: string) =>
    client.invalidateQueries({ predicate: (q) => q.queryKey[0] === prefix });
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: { username: string; password: string }) =>
      api.post<{ ok: true }>("/api/auth/login", body),
  });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/api/auth/logout"),
    onSuccess: () => client.clear(),
  });
}

export function useCreateLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ link: Link }>("/api/links", body),
    onSuccess: () => invalidate("links"),
  });
}

export function useUpdateLink() {
  const invalidate = useInvalidate();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number } & Record<string, unknown>) =>
      api.patch<{ link: Link }>(`/api/links/${id}`, body),
    onSuccess: (_data, variables) => {
      invalidate("links");
      client.invalidateQueries({ queryKey: keys.link(variables.id) });
    },
  });
}

export function useDeleteLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/links/${id}`),
    onSuccess: () => invalidate("links"),
  });
}

export function useRestoreLink() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.post(`/api/links/${id}/restore`),
    onSuccess: () => invalidate("links"),
  });
}

export function useSetLinkTags() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, tagIds }: { id: number; tagIds: number[] }) =>
      api.put(`/api/links/${id}/tags`, { tagIds }),
    onSuccess: () => invalidate("links"),
  });
}

export function useCreateTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      api.post<{ tag: Tag }>("/api/tags", body),
    onSuccess: () => invalidate("tags"),
  });
}

export function useDeleteTag() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number) => api.del(`/api/tags/${id}`),
    onSuccess: () => {
      invalidate("tags");
      invalidate("links");
    },
  });
}

export function useRevokeSession() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/auth/sessions/${id}`),
    onSuccess: () => invalidate("sessions"),
  });
}

export function useRevokeAllSessions() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: () => api.del("/api/auth/sessions"),
    onSuccess: () => invalidate("sessions"),
  });
}

/** `/api/links` is paginated at this size (`src/db/links.ts`'s own default),
 *  matched here rather than invented, so a page boundary in the export lines
 *  up with a page boundary the API actually has. */
const EXPORT_PAGE_SIZE = 50;

/** Pages through the whole links list for the Settings CSV export, rather
 *  than exporting whatever the first `/api/links` page returns. A caller
 *  settling for one page would hand back a file that looks complete and
 *  silently is not once there are more than `EXPORT_PAGE_SIZE` links — the
 *  worst shape of wrong, because nothing about the file says it is
 *  incomplete. This throws (propagating `ApiError` or a network failure)
 *  the moment any page fails, on purpose: the caller must not fall back to
 *  writing out whatever rows it collected before the failure as if that
 *  were the whole list. */
export async function fetchAllLinksForExport(): Promise<Link[]> {
  const all: Link[] = [];
  let offset = 0;
  for (;;) {
    const page = await api.get<{ links: Link[]; total: number }>("/api/links", {
      limit: EXPORT_PAGE_SIZE,
      offset,
    });
    all.push(...page.links);
    if (page.links.length === 0 || all.length >= page.total) break;
    offset += EXPORT_PAGE_SIZE;
  }
  return all;
}
