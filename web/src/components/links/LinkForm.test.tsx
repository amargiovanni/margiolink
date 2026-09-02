import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkForm } from "./LinkForm";

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
