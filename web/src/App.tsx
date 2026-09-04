import { lazy, Suspense } from "react";
import { Route, Link as RouterLink, Routes } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { RequireSession } from "./components/RequireSession";

const LinkDetail = lazy(() => import("./pages/LinkDetail"));
const Links = lazy(() => import("./pages/Links"));
const Login = lazy(() => import("./pages/Login"));
const Overview = lazy(() => import("./pages/Overview"));
const Settings = lazy(() => import("./pages/Settings"));
const Tags = lazy(() => import("./pages/Tags"));

/** The catch-all's destination — every entry in `PrimaryNav.SECTIONS` now
 *  resolves to a real page (Task 13 finished `/tags` and `/settings`), so
 *  anything reaching `/*` is genuinely a mistyped or stale URL, not an
 *  unbuilt section. `RouterLink to="/"` rather than a plain `<a>`: the
 *  router's `basename="/app"` (see `main.tsx`) already prefixes navigation
 *  targets, so a relative router link lands on the real overview route
 *  instead of requiring this page to know its own mount path. */
function NotFound() {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <h1 className="font-display text-3xl text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-muted">
        Nothing lives at this address. Check the link, or head back to the overview.
      </p>
      <RouterLink to="/" className="mt-2 text-sm text-accent underline">
        Back to overview
      </RouterLink>
    </div>
  );
}

export default function App() {
  return (
    <Suspense
      fallback={
        <div
          className="flex min-h-40 items-center justify-center text-sm text-ink-muted"
          role="status"
        >
          Loading…
        </div>
      }
    >
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireSession>
              <AppShell>
                <Overview />
              </AppShell>
            </RequireSession>
          }
        />
        <Route
          path="/links"
          element={
            <RequireSession>
              <AppShell>
                <Links />
              </AppShell>
            </RequireSession>
          }
        />
        <Route
          path="/links/:id"
          element={
            <RequireSession>
              <AppShell>
                <LinkDetail />
              </AppShell>
            </RequireSession>
          }
        />
        <Route
          path="/tags"
          element={
            <RequireSession>
              <AppShell>
                <Tags />
              </AppShell>
            </RequireSession>
          }
        />
        <Route
          path="/settings"
          element={
            <RequireSession>
              <AppShell>
                <Settings />
              </AppShell>
            </RequireSession>
          }
        />
        {/* Deliberately behind `RequireSession`, not in front of it: an
          anonymous visitor to this private, single-operator dashboard
          should not be able to tell which paths exist by which ones bounce
          them to `/login` and which show a distinct "not found" page —
          every unauthenticated request goes to the login screen regardless
          of path, which is both simpler and safer than turning this route
          into a path-enumeration oracle. `NotFound`'s only real audience is
          an authenticated reader who mistyped a URL. Do not "fix" this by
          moving the route in front of `RequireSession`. */}
        <Route
          path="/*"
          element={
            <RequireSession>
              <AppShell>
                <NotFound />
              </AppShell>
            </RequireSession>
          }
        />
      </Routes>
    </Suspense>
  );
}
