import { Route, Link as RouterLink, Routes } from "react-router";
import { AppShell } from "./components/layout/AppShell";
import { RequireSession } from "./components/RequireSession";
import LinkDetail from "./pages/LinkDetail";
import Links from "./pages/Links";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Settings from "./pages/Settings";
import Tags from "./pages/Tags";

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
  );
}
