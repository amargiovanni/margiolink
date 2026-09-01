import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
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

function renderRow(sparkline: number[] | null) {
  return render(
    <MemoryRouter>
      <LinkRow link={LINK} sparkline={sparkline} />
    </MemoryRouter>,
  );
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

  it("has no action menu — Edit, QR, Deactivate and Delete have nowhere to go yet", () => {
    renderRow([]);
    expect(screen.queryByRole("button", { name: /actions for/i })).not.toBeInTheDocument();
  });
});
