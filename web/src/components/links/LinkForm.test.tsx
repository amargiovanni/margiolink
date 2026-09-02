import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Link } from "../../lib/queries";
import { LinkForm } from "./LinkForm";

const EDIT_LINK: Link = {
  id: 1,
  slug: "launch",
  shortUrl: "https://link.test/launch",
  targetUrl: "https://example.com/launch",
  title: "Old title",
  description: "Old description",
  hasPassword: false,
  expiresAt: 1_800_000_000,
  expiredUrl: "https://example.com/expired",
  isActive: true,
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  tags: [],
};

afterEach(() => vi.unstubAllGlobals());

function renderForm(props: Partial<Parameters<typeof LinkForm>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LinkForm mode="create" onDone={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

describe("LinkForm", () => {
  it("requires a destination before it will submit", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/enter a destination/i)).toBeInTheDocument();
  });

  it("rejects a destination that is not http or https before calling the API", async () => {
    const spy = vi.fn();
    vi.stubGlobal("fetch", spy);
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "javascript:alert(1)");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends an optional slug only when one was typed", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: { id: 1, slug: "x" } }));
    vi.stubGlobal("fetch", spy);
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("slug");
  });

  it("maps the API's slug_taken to the slug field rather than a generic banner", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "slug_taken" }, { status: 409 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.type(screen.getByLabelText(/custom slug/i), "taken");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it("maps reserved_slug to a message that says which slugs are reserved", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "reserved_slug" }, { status: 422 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.type(screen.getByLabelText(/custom slug/i), "api");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
  });

  it("explains the rate limit rather than showing a raw 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "rate_limited" }, { status: 429 })),
    );
    renderForm();
    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/too many links/i);
  });

  it("offers clearing the password when editing a protected link", () => {
    renderForm({
      mode: "edit",
      link: {
        id: 1,
        slug: "x",
        shortUrl: "https://link.test/x",
        targetUrl: "https://example.com",
        title: null,
        description: null,
        hasPassword: true,
        expiresAt: null,
        expiredUrl: null,
        isActive: true,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
        tags: [],
      },
    });
    expect(screen.getByRole("button", { name: /remove password/i })).toBeInTheDocument();
  });
});

describe("LinkForm — clearing a field in edit mode", () => {
  it("sends an explicit null for a cleared title, rather than omitting the key", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: EDIT_LINK }));
    vi.stubGlobal("fetch", spy);
    renderForm({ mode: "edit", link: EDIT_LINK });

    await userEvent.clear(screen.getByLabelText(/^title/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    // `updateLink` (src/db/links.ts) skips any column whose patch value is
    // `undefined` and writes NULL for one that is explicitly `null` — this
    // is the assertion that fails if the empty field is merely omitted:
    // omitting would leave `body` with no `title` key at all, and the old
    // title would survive the save unnoticed.
    expect(body).toHaveProperty("title", null);
  });

  it("sends an explicit null for a cleared description, rather than omitting the key", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: EDIT_LINK }));
    vi.stubGlobal("fetch", spy);
    renderForm({ mode: "edit", link: EDIT_LINK });

    await userEvent.clear(screen.getByLabelText(/description/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toHaveProperty("description", null);
  });

  it("clearing the expiry also clears the fallback URL, rather than orphaning it", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: EDIT_LINK }));
    vi.stubGlobal("fetch", spy);
    renderForm({ mode: "edit", link: EDIT_LINK });

    // The fallback URL field is only shown while an expiry is set; clearing
    // the expiry first is what makes it disappear from the form, exactly as
    // it should disappear from the record.
    await userEvent.clear(screen.getByLabelText(/expires/i));
    await userEvent.click(screen.getByRole("button", { name: /save/i }));

    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).toHaveProperty("expiresAt", null);
    expect(body).toHaveProperty("expiredUrl", null);
  });

  it("does not send title/description/expiry as null in create mode — there is nothing to clear", async () => {
    const spy = vi.fn().mockResolvedValue(Response.json({ link: { id: 1, slug: "x" } }));
    vi.stubGlobal("fetch", spy);
    renderForm();

    await userEvent.type(screen.getByLabelText(/destination/i), "https://example.com");
    await userEvent.click(screen.getByRole("button", { name: /create/i }));

    const body = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body).not.toHaveProperty("title");
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("expiresAt");
    expect(body).not.toHaveProperty("expiredUrl");
  });
});

describe("LinkForm — password removal feedback", () => {
  const PROTECTED_LINK: Link = { ...EDIT_LINK, hasPassword: true };

  it("confirms a successful password removal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ link: PROTECTED_LINK })));
    renderForm({ mode: "edit", link: PROTECTED_LINK });

    await userEvent.click(screen.getByRole("button", { name: /remove password/i }));

    expect(await screen.findByText(/password removed/i)).toBeInTheDocument();
  });

  it("surfaces a failed password removal rather than showing nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ error: "boom" }, { status: 500 })),
    );
    renderForm({ mode: "edit", link: PROTECTED_LINK });

    await userEvent.click(screen.getByRole("button", { name: /remove password/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    expect(screen.queryByText(/password removed/i)).not.toBeInTheDocument();
  });
});
