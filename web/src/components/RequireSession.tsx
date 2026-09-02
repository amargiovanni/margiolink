import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { ApiError } from "../lib/api";
import { useSessions } from "../lib/queries";

/** The API is the source of truth about whether a session exists — there is no
 *  client-side token to inspect, by design. A 401 from any authenticated call
 *  means the cookie is gone or expired. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { isPending, error } = useSessions();

  if (isPending) return <div className="p-8 text-ink-muted">Loading…</div>;
  if (error instanceof ApiError) {
    // Basename-relative. `BrowserRouter basename="/app"` (main.tsx) prepends
    // "/app" itself, so an already-prefixed target resolves to `/app/app/login`
    // — no route in App.tsx, whose paths are all basename-relative. That fell
    // into the protected `/*` catch-all, which 401s and redirects here again:
    // an infinite loop. Pinned by RequireSession.test.tsx, which is the only
    // test in this suite that mounts a router WITH the real basename.
    if (error.status === 401) return <Navigate to="/login" replace />;
    // The API answered — just not with success. Naming the status keeps
    // whoever debugs this looking at the right layer: the request reached
    // the server and it rejected it, which is a different failure than the
    // network-level one below.
    return <div className="p-8 text-critical">The API returned an error ({error.status}).</div>;
  }
  if (error) return <div className="p-8 text-critical">Could not reach the API.</div>;
  return <>{children}</>;
}
