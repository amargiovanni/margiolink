import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { DeferredPanel } from "./DeferredPanel";

afterEach(() => vi.unstubAllGlobals());

it("mounts on intersection once and disconnects observation", () => {
  let onChange: IntersectionObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        onChange = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  render(
    <DeferredPanel title="Cities">
      <p>City data</p>
    </DeferredPanel>,
  );
  expect(screen.queryByText("City data")).not.toBeInTheDocument();
  act(() =>
    onChange(
      [{ isIntersecting: false }] as IntersectionObserverEntry[],
      {} as IntersectionObserver,
    ),
  );
  expect(screen.queryByText("City data")).not.toBeInTheDocument();
  act(() =>
    onChange([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver),
  );
  expect(screen.getByText("City data")).toBeInTheDocument();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("loads with Space without waiting for the observer", async () => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  render(
    <DeferredPanel title="Cities">
      <p>City data</p>
    </DeferredPanel>,
  );
  screen.getByRole("button", { name: "Load Cities" }).focus();
  await userEvent.keyboard(" ");
  expect(screen.getByText("City data")).toBeInTheDocument();
  expect(document.activeElement).toHaveAttribute("data-deferred-panel", "Cities");
});

it("loads immediately when IntersectionObserver is unavailable", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  render(
    <DeferredPanel title="Cities">
      <p>City data</p>
    </DeferredPanel>,
  );
  expect(screen.getByText("City data")).toBeInTheDocument();
});
