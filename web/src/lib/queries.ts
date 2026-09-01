import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export interface Slice {
  value: string;
  clicks: number;
  uniques: number;
}

export const keys = {
  links: (params?: unknown) => ["links", params ?? {}] as const,
  link: (id: number) => ["link", id] as const,
  tags: () => ["tags"] as const,
  sessions: () => ["sessions"] as const,
  stats: (kind: string, params: unknown) => ["stats", kind, params] as const,
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

export function useSummary(range: Range) {
  return useQuery({
    queryKey: keys.stats("summary", range),
    queryFn: () =>
      api.get<{ current: Summary; previous: Summary }>("/api/stats/summary", { ...range }),
  });
}

export function useTimeseries(range: Range, granularity: "hour" | "day" | "week") {
  return useQuery({
    queryKey: keys.stats("timeseries", { ...range, granularity }),
    queryFn: () =>
      api.get<{ buckets: { bucket: string; clicks: number; uniques: number }[] }>(
        "/api/stats/timeseries",
        { ...range, granularity },
      ),
  });
}

export function useDimension(range: Range, name: string, limit = 20) {
  return useQuery({
    queryKey: keys.stats("dimension", { ...range, name, limit }),
    queryFn: () => api.get<{ slices: Slice[] }>("/api/stats/dimension", { ...range, name, limit }),
  });
}

/** Polls, because the feed is the one place a stale number is visibly wrong. */
export function useLive(limit = 50) {
  return useQuery({
    queryKey: keys.stats("live", limit),
    queryFn: () => api.get<{ clicks: LiveClick[] }>("/api/stats/live", { limit }),
    refetchInterval: 10_000,
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
  return useMutation({ mutationFn: () => api.del("/api/auth/sessions") });
}
