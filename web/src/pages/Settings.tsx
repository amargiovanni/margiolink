import { useState } from "react";
import { useNavigate } from "react-router";
import { ConfirmDialog } from "../components/links/ConfirmDialog";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { formatRelative } from "../lib/format";
import type { Link, Meta, SessionRow } from "../lib/queries";
import {
  fetchAllLinksForExport,
  useLogout,
  useMeta,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useSparklines,
} from "../lib/queries";

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CSV_HEADER = [
  "slug",
  "short_url",
  "target_url",
  "title",
  "status",
  "created_at",
  "tags",
  "clicks_last_7_days",
];

/** Builds the export CSV from links already collected in full (see
 *  `fetchAllLinksForExport`) plus, best-effort, the trailing 7-day click sum
 *  already fetched for the Links page's own sparklines (`useSparklines`) —
 *  the "stats endpoints" the brief calls for, with no new endpoint added for
 *  this. A link missing from a *successful* sparklines response really had
 *  zero clicks in the window; a *failed* sparklines request means the
 *  column is unknown for every row, and says so rather than lying with a
 *  false zero — same distinction `Links.tsx`'s `sparklineFor` makes. */
function buildLinksCsv(links: Link[], clicksByLinkId: Map<number, number> | null): string {
  const rows = links.map((link) =>
    [
      link.slug,
      link.shortUrl,
      link.targetUrl,
      link.title ?? "",
      link.isActive ? "active" : "inactive",
      new Date(link.createdAt * 1000).toISOString(),
      link.tags.map((tag) => tag.name).join(";"),
      clicksByLinkId ? String(clicksByLinkId.get(link.id) ?? 0) : "unavailable",
    ].map(csvField),
  );
  return [CSV_HEADER, ...rows].map((row) => row.join(",")).join("\r\n");
}

function triggerDownload(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SessionRowItem({ session }: { session: SessionRow }) {
  const revokeMutation = useRevokeSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <li className="flex items-center justify-between gap-3 border-b border-rule py-2 last:border-b-0">
      <div className="flex flex-col">
        <span className="flex items-center gap-2 text-sm text-ink">
          {session.device ?? "Unknown device"}
          {session.current && <Badge tone="neutral">Current</Badge>}
        </span>
        <span className="text-xs text-ink-muted">
          Last seen {formatRelative(session.lastSeenAt)}
        </span>
      </div>

      {/* Signing yourself out is what the Sign out button below is for — a
       *  revoke control on the session you're using right now would be a
       *  second path to the same place that reads like a different one. */}
      {!session.current && (
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            Revoke
          </Button>
          <ConfirmDialog
            open={open}
            onOpenChange={setOpen}
            title="Revoke this session?"
            description={`Signs out ${session.device ?? "this device"} immediately. It will need to sign in again to come back.`}
            confirmLabel="Revoke"
            confirming={revokeMutation.isPending}
            error={error}
            onConfirm={() =>
              revokeMutation.mutate(session.id, {
                onSuccess: () => setOpen(false),
                onError: () => setError("Could not revoke this session. Try again."),
              })
            }
          />
        </>
      )}
    </li>
  );
}

function SessionsSection() {
  const sessionsQuery = useSessions();
  const logoutMutation = useLogout();
  const revokeAllMutation = useRevokeAllSessions();
  const navigate = useNavigate();
  const [revokeAllOpen, setRevokeAllOpen] = useState(false);
  const [revokeAllError, setRevokeAllError] = useState<string | null>(null);

  const sessions = sessionsQuery.data?.sessions ?? [];

  return (
    <section aria-labelledby="settings-sessions" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id="settings-sessions" className="font-display text-xl text-ink">
          Sessions
        </h2>
        <Button
          variant="ghost"
          size="sm"
          loading={logoutMutation.isPending}
          onClick={() =>
            // Basename-relative, matching the `<Route path="/login">` in
            // App.tsx: `BrowserRouter basename="/app"` (main.tsx) already
            // prepends "/app" to every `navigate()` target. Verified against
            // this router version with a real route match, not assumed from
            // memory — see the note on `RequireSession.tsx` and `Login.tsx`
            // in this task's report; both pass an already `/app`-prefixed
            // target, which a route-matching check shows resolves to no
            // route at all, only untested because nothing here checks the
            // resulting location.
            logoutMutation.mutate(undefined, { onSuccess: () => navigate("/login") })
          }
        >
          Sign out
        </Button>
      </div>

      {sessionsQuery.isError ? (
        <p role="alert" className="text-sm text-critical">
          Could not load active sessions. Try again.
        </p>
      ) : sessionsQuery.isPending ? (
        <p className="text-sm text-ink-muted">Loading sessions…</p>
      ) : (
        <ul className="flex flex-col">
          {sessions.map((session) => (
            <SessionRowItem key={session.id} session={session} />
          ))}
        </ul>
      )}

      <div className="flex flex-col items-start gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setRevokeAllError(null);
            setRevokeAllOpen(true);
          }}
        >
          Revoke all other sessions
        </Button>
      </div>

      <ConfirmDialog
        open={revokeAllOpen}
        onOpenChange={setRevokeAllOpen}
        title="Revoke all other sessions?"
        description="Every session other than this one is signed out immediately. Each will need to sign in again."
        confirmLabel="Revoke all"
        confirming={revokeAllMutation.isPending}
        error={revokeAllError}
        onConfirm={() =>
          revokeAllMutation.mutate(undefined, {
            onSuccess: () => setRevokeAllOpen(false),
            onError: () => setRevokeAllError("Could not revoke other sessions. Try again."),
          })
        }
      />
    </section>
  );
}

function RetentionFact({ metaQuery }: { metaQuery: ReturnType<typeof useMeta> }) {
  if (metaQuery.isError) {
    return (
      <p role="alert" className="text-sm text-critical">
        Could not load the retention window.
      </p>
    );
  }
  if (metaQuery.isPending) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }
  return (
    <p className="text-sm text-ink">
      {metaQuery.data.retentionDays} days, set by <code>RAW_RETENTION_DAYS</code> on the Worker. Not
      editable here — it isn't stored settings state, it's how the deployment is configured.
    </p>
  );
}

function DataSection({ metaQuery }: { metaQuery: ReturnType<typeof useMeta> }) {
  const sparklinesQuery = useSparklines(7);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExportError(null);
    setExporting(true);
    try {
      const links = await fetchAllLinksForExport();
      const clicksByLinkId = sparklinesQuery.isSuccess
        ? new Map(
            Object.entries(sparklinesQuery.data.series).map(([id, days]) => [
              Number(id),
              days.reduce((sum, value) => sum + value, 0),
            ]),
          )
        : null;
      const csv = buildLinksCsv(links, clicksByLinkId);
      triggerDownload(csv, `margiolink-links-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch {
      // A page of `/api/links` failed mid-export — the rows already
      // collected are discarded rather than written out as a file that
      // looks complete but silently isn't.
      setExportError("Could not export all links — the download did not complete. Try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section aria-labelledby="settings-data" className="flex flex-col gap-3">
      <h2 id="settings-data" className="font-display text-xl text-ink">
        Data
      </h2>

      <div className="flex flex-col gap-1">
        <span className="text-sm text-ink-muted">Raw click retention</span>
        <RetentionFact metaQuery={metaQuery} />
      </div>

      <div className="flex flex-col items-start gap-2 pt-1">
        <Button variant="ghost" size="sm" loading={exporting} onClick={handleExport}>
          Export links as CSV
        </Button>
        {exportError && (
          <p role="alert" className="text-sm text-critical">
            {exportError}
          </p>
        )}
      </div>
    </section>
  );
}

function AboutSection({ metaQuery }: { metaQuery: ReturnType<typeof useMeta> }) {
  const meta: Meta | undefined = metaQuery.data;

  return (
    <section aria-labelledby="settings-about" className="flex flex-col gap-3">
      <h2 id="settings-about" className="font-display text-xl text-ink">
        About
      </h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-ink-muted">Short domain</dt>
        <dd className="text-ink">
          {meta ? meta.shortDomain : metaQuery.isError ? "Unavailable" : "Loading…"}
        </dd>
        <dt className="text-ink-muted">Raw click retention</dt>
        <dd className="text-ink">
          {meta ? `${meta.retentionDays} days` : metaQuery.isError ? "Unavailable" : "Loading…"}
        </dd>
        <dt className="text-ink-muted">Version</dt>
        <dd className="text-ink">{__APP_VERSION__}</dd>
      </dl>
      <a href="/privacy" className="text-sm text-accent underline">
        Privacy policy
      </a>
    </section>
  );
}

/** Settings — spec §6.1: active sessions with revocation, the retention
 *  window shown read-only (a Worker environment variable, not settings
 *  state — no table to edit it into exists), and a CSV export that streams
 *  from the API rather than any object storage. Three groups, per the Step
 *  2 brief: Sessions, Data, About. */
export default function Settings() {
  const metaQuery = useMeta();

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl text-ink">Settings</h1>
      <SessionsSection />
      <DataSection metaQuery={metaQuery} />
      <AboutSection metaQuery={metaQuery} />
    </div>
  );
}
