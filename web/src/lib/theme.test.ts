import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, readStoredTheme, storeTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("theme", () => {
  it("defaults to following the system", () => {
    expect(readStoredTheme()).toBe("system");
  });

  it("round-trips an explicit choice", () => {
    storeTheme("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("stamps the root element so the token blocks can win", () => {
    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("removes the stamp for system, so the media query decides", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("survives a storage that throws", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("blocked");
    };
    expect(() => readStoredTheme()).not.toThrow();
    expect(readStoredTheme()).toBe("system");
    Storage.prototype.getItem = original;
  });
});
