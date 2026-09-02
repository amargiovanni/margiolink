import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Tags from "./Tags";

const TAG = { id: 7, name: "spring", color: "#199e70" };

// jsdom serialises an inline `backgroundColor` style back out as
// `rgb(r, g, b)`, never the original hex string — this mirrors that so the
// swatch assertion below queries for what the DOM actually holds.
function hexToRgbString(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

function stub(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const path = new URL(String(input), "https://link.test").pathname;
      const key = `${init?.method ?? "GET"} ${path}`;
      const body = routes[key] ?? routes[path];
      if (!body) return Response.json({ error: "not_found" }, { status: 404 });
      if (body instanceof Response) return body;
      return Response.json(body);
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderTags() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Tags />
    </QueryClientProvider>,
  );
}

describe("Tags", () => {
  it("lists an existing tag with its colour swatch and its name as text", async () => {
    stub({ "GET /api/tags": { tags: [TAG] } });
    renderTags();

    expect(await screen.findByText("spring")).toBeInTheDocument();
    const swatch = document.querySelector(`[style*="${hexToRgbString(TAG.color)}"]`);
    expect(swatch).not.toBeNull();
  });

  it("creates a tag by sending its name and colour", async () => {
    stub({
      "GET /api/tags": { tags: [] },
      "POST /api/tags": { tag: { id: 1, name: "campaign", color: "#4338ca" } },
    });
    renderTags();
    await screen.findByText(/no tags yet/i);

    await userEvent.type(screen.getByLabelText(/name/i), "campaign");
    const colorField = screen.getByLabelText(/colour/i);
    await userEvent.clear(colorField);
    await userEvent.type(colorField, "#4338ca");
    await userEvent.click(screen.getByRole("button", { name: /new tag/i }));

    await waitFor(() => {
      const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      const created = calls.find(
        (c) =>
          String(c[0]).includes("/api/tags") &&
          (c[1] as RequestInit | undefined)?.method === "POST",
      );
      expect(created).toBeDefined();
      const init = created?.[1] as RequestInit;
      expect(JSON.parse(String(init.body))).toEqual({ name: "campaign", color: "#4338ca" });
    });
  });

  it("shows a clear message when the name is already taken", async () => {
    stub({
      "GET /api/tags": { tags: [] },
      "POST /api/tags": Response.json({ error: "tag_exists" }, { status: 409 }),
    });
    renderTags();
    await screen.findByText(/no tags yet/i);

    await userEvent.type(screen.getByLabelText(/name/i), "spring");
    const colorField = screen.getByLabelText(/colour/i);
    await userEvent.clear(colorField);
    await userEvent.type(colorField, "#199e70");
    await userEvent.click(screen.getByRole("button", { name: /new tag/i }));

    expect(await screen.findByText(/a tag with that name already exists/i)).toBeInTheDocument();
  });

  it("rejects a non-hex colour before ever calling the API", async () => {
    stub({ "GET /api/tags": { tags: [] } });
    renderTags();
    await screen.findByText(/no tags yet/i);

    await userEvent.type(screen.getByLabelText(/name/i), "campaign");
    const colorField = screen.getByLabelText(/colour/i);
    await userEvent.clear(colorField);
    await userEvent.type(colorField, "not-a-colour");
    await userEvent.click(screen.getByRole("button", { name: /new tag/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/hex/i);
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => c[1] && (c[1] as RequestInit).method === "POST")).toBe(false);
  });

  it("asks for confirmation before deleting a tag, and explains that links keep existing", async () => {
    stub({ "GET /api/tags": { tags: [TAG] } });
    renderTags();
    await screen.findByText("spring");

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/keep existing/i)).toBeInTheDocument();

    // Deleting is not fired until the confirmation is itself confirmed.
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls.some((c) => c[1] && (c[1] as RequestInit).method === "DELETE")).toBe(false);
  });
});
