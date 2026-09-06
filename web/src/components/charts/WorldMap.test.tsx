import { render, screen, waitFor } from "@testing-library/react";
import * as topojsonClient from "topojson-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorldMap } from "./WorldMap";

// Spies on the real `feature()` (still delegating to it) so tests can tell
// whether the atlas was actually processed, independent of what ends up in
// the DOM — the map's `<svg>` is also gated on `slices.length > 0`, so a
// DOM-only assertion can't distinguish "never fetched" from "fetched but
// not rendered for an unrelated reason".
vi.mock("topojson-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("topojson-client")>();
  return { ...actual, feature: vi.fn(actual.feature) };
});

const slices = [
  { value: "IT", clicks: 120, uniques: 90 },
  { value: "FR", clicks: 40, uniques: 35 },
];

describe("WorldMap", () => {
  beforeEach(() => {
    vi.mocked(topojsonClient.feature).mockClear();
  });

  it("always ships the ranked list beside the map, so the data is readable without it", async () => {
    render(<WorldMap slices={slices} />);
    expect(await screen.findByText("IT")).toBeInTheDocument();
    expect(await screen.findByText("120")).toBeInTheDocument();
  });

  it("renders the list even before the atlas has loaded", () => {
    render(<WorldMap slices={slices} />);
    expect(screen.getByText("FR")).toBeInTheDocument();
  });

  it("can bound the ranked list without dropping countries from the map", async () => {
    const manySlices = [
      ...slices,
      { value: "DE", clicks: 30, uniques: 24 },
      { value: "GB", clicks: 20, uniques: 18 },
    ];
    const { container } = render(<WorldMap slices={manySlices} listLimit={2} />);

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/showing top 2 of 4/i)).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector("svg")).toBeInTheDocument());
    expect(container.querySelector('[data-country="276"] title')).toHaveTextContent(
      "Germany: 30 clicks",
    );
  });

  it("says so plainly when there is nothing to plot", () => {
    render(<WorldMap slices={[]} />);
    expect(screen.getByText(/no data/i)).toBeInTheDocument();
  });

  // The three tests above are the brief's. Everything below pins behaviour
  // the brief calls out as load-bearing but does not hand us a test for.

  it("colours the highest-clicks country with the top ramp step once the atlas resolves", async () => {
    const { container } = render(<WorldMap slices={slices} />);
    // "IT" -> numeric "380" in world-atlas@2.0.2 (confirmed by inspecting
    // the installed package directly — see the task report).
    const italy = await waitFor(() => {
      const el = container.querySelector('[data-country="380"]');
      if (!el) throw new Error("Italy path not rendered yet");
      return el;
    });
    expect((italy as SVGPathElement).style.fill).toBe("var(--color-ramp-5)");

    const france = container.querySelector('[data-country="250"]');
    // 40 clicks against a max of 120 lands in a lower, non-top step.
    expect((france as SVGPathElement).style.fill).toBe("var(--color-ramp-2)");
  });

  it("gives a country with zero clicks the sunken surface, never a ramp step", async () => {
    const { container } = render(<WorldMap slices={slices} />);
    await waitFor(() => {
      if (!container.querySelector('[data-country="380"]')) {
        throw new Error("atlas not loaded yet");
      }
    });
    // "250" is France (in the data); "276" is Germany, absent from `slices`.
    const germany = container.querySelector('[data-country="276"]');
    expect((germany as SVGPathElement).style.fill).toBe("var(--color-surface-sunken)");
  });

  it("treats an unrecognised country code as no data instead of guessing or throwing", async () => {
    const bogus = [{ value: "ZZ", clicks: 999, uniques: 999 }];
    const { container } = render(<WorldMap slices={bogus} />);
    // The list still shows it — the list is the data, unconditionally.
    expect(screen.getByText("ZZ")).toBeInTheDocument();
    await waitFor(() => {
      if (!container.querySelector("[data-country]")) throw new Error("atlas not loaded yet");
    });
    // No path should carry the ramp's top colour: "ZZ" cannot map to any
    // numeric id, so nothing on the map should read as having 999 clicks.
    const coloured = container.querySelectorAll('path[style*="var(--color-ramp"]');
    expect(coloured.length).toBe(0);
  });

  it("gives every country a unique key even though a few carry no numeric id at all", async () => {
    // world-atlas@2.0.2 has three geometries with no numeric id (contested
    // territories, e.g. Kosovo) — keying paths on id alone collides all
    // three on the empty string and trips React's duplicate-key warning.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<WorldMap slices={slices} />);
    await waitFor(() => {
      if (!container.querySelector("[data-country]")) throw new Error("atlas not loaded yet");
    });
    const sameKeyWarning = errorSpy.mock.calls.some((call) => String(call[0]).includes("same key"));
    expect(sameKeyWarning).toBe(false);
    errorSpy.mockRestore();
  });

  it("gives every rendered country path a title carrying its name and click count", async () => {
    const { container } = render(<WorldMap slices={slices} />);
    const italy = await waitFor(() => {
      const el = container.querySelector('[data-country="380"]');
      if (!el) throw new Error("Italy path not rendered yet");
      return el;
    });
    expect(italy.querySelector("title")?.textContent).toMatch(/italy.*120/i);
  });

  it("never fetches the atlas when there is nothing to draw", async () => {
    render(<WorldMap slices={[]} />);
    // Let any pending microtask/effect settle before asserting a negative.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(topojsonClient.feature).not.toHaveBeenCalled();
  });

  it("still fetches the atlas once data arrives, even if it first mounted with none", async () => {
    // Mirrors a parent whose query is still loading on first render: it
    // passes `slices={[]}` initially, then swaps in the real rows.
    const { rerender } = render(<WorldMap slices={[]} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(topojsonClient.feature).not.toHaveBeenCalled();

    rerender(<WorldMap slices={slices} />);
    await waitFor(() => {
      expect(topojsonClient.feature).toHaveBeenCalled();
    });
  });
});
