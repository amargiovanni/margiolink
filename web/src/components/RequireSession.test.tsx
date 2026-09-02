import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import Login from "../pages/Login";
import { RequireSession } from "./RequireSession";

afterEach(() => vi.unstubAllGlobals());

/**
 * Both tests here mount `MemoryRouter` with the same `basename="/app"` that
 * `main.tsx` gives `BrowserRouter`, because the bug they pin only exists under
 * a basename. React Router resolves every `navigate()` and `<Navigate to>`
 * target *relative to* the basename and prepends it itself, so a target that
 * already carries `/app` produces `/app/app/...` — a URL matching no route in
 * `App.tsx`, all of whose paths are basename-relative.
 *
 * A router mounted without a basename — the default in every other test file
 * here — resolves those doubled targets to something that looks plausible, which
 * is exactly why the whole suite stayed green while the two most basic flows in
 * the application were broken.
 */
function renderAt(initial: string, element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter basename="/app" initialEntries={[initial]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<div>Overview reached</div>} />
          <Route path="/links" element={element} />
          <Route path="/*" element={<div>Catch-all reached</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RequireSession", () => {
  it("sends an unauthenticated visitor to the login route, not into the catch-all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 })),
    );

    renderAt(
      "/app/links",
      <RequireSession>
        <div>Protected</div>
      </RequireSession>,
    );

    // The login form itself, not the catch-all. With a doubled `/app` prefix
    // the redirect lands on `/app/login` *relative to the basename*, which
    // matches only `/*` — and because that route is itself protected in the
    // real App.tsx, the 401 redirects again, forever.
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.queryByText("Catch-all reached")).not.toBeInTheDocument();
  });
});

describe("Login", () => {
  it("lands on the overview after a successful sign-in, not on the catch-all", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input), "https://link.test").pathname;
        if (path === "/api/auth/login") return Response.json({ ok: true });
        return Response.json({ sessions: [] });
      }),
    );

    renderAt("/app/login", <div>unused</div>);

    await userEvent.type(screen.getByLabelText(/username/i), "admin");
    await userEvent.type(screen.getByLabelText(/password/i), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Overview reached")).toBeInTheDocument();
    expect(screen.queryByText("Catch-all reached")).not.toBeInTheDocument();
  });
});
