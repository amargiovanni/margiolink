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

// jsdom implements the `PointerEvent` constructor but not the pointer
// capture methods `@radix-ui/react-select`'s trigger calls on open —
// `hasPointerCapture`, `setPointerCapture`, `releasePointerCapture` — so a
// real `userEvent.click` on the trigger throws `target.hasPointerCapture is
// not a function` before Radix ever gets to open the listbox. No-op stubs
// are enough: nothing here depends on pointer capture actually happening.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
