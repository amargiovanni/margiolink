import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "./ThemeToggle";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

async function openMenu() {
  const user = userEvent.setup();
  render(<ThemeToggle />);
  await user.click(screen.getByRole("button", { name: /theme/i }));
  return user;
}

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole("menuitemradio", { name }));
}

describe("ThemeToggle", () => {
  it("has an accessible name, so it is reachable without sight", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /theme/i })).toBeInTheDocument();
  });

  it("stamps the root element with the chosen theme when Light is selected", async () => {
    const user = await openMenu();
    await choose(user, /light/i);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("persists the choice to storage when Light is selected", async () => {
    const user = await openMenu();
    await choose(user, /light/i);
    expect(localStorage.getItem("margiolink:theme")).toBe("light");
  });

  it("stamps the root element with the chosen theme when Dark is selected", async () => {
    const user = await openMenu();
    await choose(user, /dark/i);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("removes the stamp entirely when System is selected, so the media query decides", async () => {
    // Seed storage (not the DOM attribute directly) with an explicit theme
    // before mounting, so the component's own mount effect stamps
    // `data-theme="dark"` for a real reason. Selecting "System" is then the
    // *only* thing in this test that can remove it — a no-op handler would
    // leave the mount-time stamp in place and fail the assertion below.
    localStorage.setItem("margiolink:theme", "dark");
    const user = await openMenu();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    await choose(user, /system/i);
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
