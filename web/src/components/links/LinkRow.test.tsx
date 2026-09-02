import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Link } from "../../lib/queries";
import { LinkRow } from "./LinkRow";

const LINK: Link = {
  id: 1,
  slug: "launch",
  shortUrl: "https://link.test/launch",
  targetUrl: "https://example.com/launch",
  title: "Launch",
  description: null,
  hasPassword: false,
  expiresAt: null,
  expiredUrl: null,
  isActive: true,
  createdAt: 1_800_000_000,
  updatedAt: 1_800_000_000,
  deletedAt: null,
  tags: [],
};

afterEach(() => vi.unstubAllGlobals());

function renderRow(sparkline: number[] | null, link: Link = LINK) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LinkRow link={link} sparkline={sparkline} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubFetch() {
  const spy = vi.fn(async (input: string, _init?: RequestInit) => {
    const path = new URL(String(input), "https://link.test").pathname;
    if (path === "/api/tags") return Response.json({ tags: [] });
    if (/^\/api\/links\/\d+$/.test(path)) return Response.json({ link: LINK });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("LinkRow", () => {
  it("states the sparkline's window explicitly, so the count doesn't read as all-time", () => {
    renderRow([0, 1, 2, 0, 3, 1, 4]);
    expect(screen.getByText("11 clicks, last 7 days")).toBeInTheDocument();
  });

  it("says clicks are unavailable rather than showing a false zero when the sparkline is unknown", () => {
    renderRow(null);
    expect(screen.getByText("Clicks unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/^0 clicks/)).not.toBeInTheDocument();
  });

  it("renders a real all-zero total when the query succeeded and the link genuinely had no clicks", () => {
    renderRow([0, 0, 0, 0, 0, 0, 0]);
    expect(screen.getByText("0 clicks, last 7 days")).toBeInTheDocument();
  });

  it("offers Edit, QR code, Deactivate and Delete from one reachable menu", async () => {
    stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    expect(await screen.findByRole("menuitem", { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /qr code/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /deactivate/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();
  });

  it("opens the edit dialog pre-filled with the link's current values", async () => {
    stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit/i }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/destination/i)).toHaveValue(LINK.targetUrl);
    expect(screen.getByLabelText(/custom slug/i)).toHaveValue(LINK.slug);
  });

  it("puts default focus on the first field when the edit dialog opens, not the × close button", async () => {
    stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /edit/i }));
    await screen.findByRole("dialog");

    expect(await screen.findByLabelText(/destination/i)).toHaveFocus();
  });

  it("deactivates an active link with a single click and no confirmation", async () => {
    const spy = stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /deactivate/i }));

    const call = spy.mock.calls.find(
      (c) => new URL(String(c[0]), "https://link.test").pathname === "/api/links/1",
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call as [string, RequestInit])[1].body));
    expect(body).toEqual({ isActive: false });
  });

  it("activates an inactive link with a single click and no confirmation", async () => {
    const spy = stubFetch();
    renderRow([], { ...LINK, isActive: false });
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /^activate$/i }));

    const call = spy.mock.calls.find(
      (c) => new URL(String(c[0]), "https://link.test").pathname === "/api/links/1",
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call as [string, RequestInit])[1].body));
    expect(body).toEqual({ isActive: true });
  });

  it("does not call the delete mutation until the confirmation is accepted", async () => {
    const spy = stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // The confirmation must open, and the DELETE request must not have gone
    // out yet — this is the assertion that fails if Delete fires on the
    // menu click and only shows the dialog for decoration afterwards.
    expect(await screen.findByRole("dialog", { name: /delete launch/i })).toBeInTheDocument();
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(
        spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE"),
      ).toBe(true);
    });
  });

  it("cancelling the delete confirmation never calls the mutation", async () => {
    const spy = stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog", { name: /delete launch/i });

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("cancel takes the default focus when the delete confirmation opens", async () => {
    stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog", { name: /delete launch/i });

    expect(await screen.findByRole("button", { name: /cancel/i })).toHaveFocus();
  });

  it("pressing Escape on the delete confirmation never calls the mutation", async () => {
    const spy = stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog", { name: /delete launch/i });

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("clicking outside the delete confirmation never calls the mutation", async () => {
    const spy = stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog", { name: /delete launch/i });

    // Radix's dialog sets `pointer-events: none` on `<body>` while open (to
    // block interaction with the page behind it), which `userEvent.click`
    // itself refuses to click through — so this dispatches the raw
    // `pointerdown`-then-`click` pair Radix's own outside-click detection
    // listens for (Dialog defers the dismissal from pointerdown to the
    // following click, so a real pointer press can't be mistaken for the
    // start of a text selection), bypassing only `userEvent`'s protective
    // check, not Radix's.
    fireEvent.pointerDown(document.body);
    fireEvent.click(document.body);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(spy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "DELETE")).toBe(
      false,
    );
  });

  it("names the slug and the restore path in the delete confirmation, rather than claiming it's permanent", async () => {
    stubFetch();
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog", { name: /delete launch/i });
    expect(dialog).toHaveTextContent("launch");
    expect(dialog).toHaveTextContent(/deleted filter/i);
    // Delete is soft — the row survives and the slug stays reserved — so the
    // confirmation must not claim the operation is permanent or unreversible.
    expect(dialog).not.toHaveTextContent(/permanently/i);
    expect(dialog).not.toHaveTextContent(/cannot be undone/i);
  });

  it("marks a deleted link with a Deleted badge", () => {
    renderRow([], { ...LINK, deletedAt: 1_800_000_500 });
    expect(screen.getByText("Deleted")).toBeInTheDocument();
  });

  it("offers only Restore from a deleted link's menu, not Edit, QR code, Deactivate or Delete", async () => {
    stubFetch();
    renderRow([], { ...LINK, deletedAt: 1_800_000_500 });
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));

    expect(await screen.findByRole("menuitem", { name: /restore/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /qr code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^delete$/i })).not.toBeInTheDocument();
  });

  it("restores a deleted link with a single click and no confirmation", async () => {
    const spy = stubFetch();
    renderRow([], { ...LINK, deletedAt: 1_800_000_500 });
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /restore/i }));

    await waitFor(() => {
      const call = spy.mock.calls.find(
        (c) =>
          new URL(String(c[0]), "https://link.test").pathname === "/api/links/1/restore" &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(call).toBeTruthy();
    });
  });

  it("surfaces a failed delete rather than showing nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const path = new URL(String(input), "https://link.test").pathname;
        if (path === "/api/tags") return Response.json({ tags: [] });
        return Response.json({ error: "boom" }, { status: 500 });
      }),
    );
    renderRow([]);
    await userEvent.click(screen.getByRole("button", { name: /actions for launch/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    await screen.findByRole("dialog", { name: /delete launch/i });

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not delete/i);
    // The failure must not be quietly treated as success — the dialog stays
    // open so the reader can see the message and retry.
    expect(screen.getByRole("dialog", { name: /delete launch/i })).toBeInTheDocument();
  });
});
