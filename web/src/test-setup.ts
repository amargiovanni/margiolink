import "@testing-library/jest-dom/vitest";

// jsdom implements no layout, so it never had a reason to implement
// ResizeObserver either — but `cmdk` (Task 10's CommandPalette) constructs
// one unconditionally to track its list's height. A no-op stub is enough:
// nothing in these tests depends on a resize actually being observed.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
    ResizeObserverStub;
}

// Same story as ResizeObserver above: jsdom does no layout, so
// `Element.prototype.scrollIntoView` — which `cmdk` calls when keyboard
// navigation moves the active item — doesn't exist there either.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
