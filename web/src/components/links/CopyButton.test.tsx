import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

afterEach(() => vi.unstubAllGlobals());

describe("CopyButton", () => {
  it("copies the value and confirms it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    render(<CopyButton value="https://link.test/demo" label="Copy short link" />);
    await userEvent.click(screen.getByRole("button", { name: /copy short link/i }));

    expect(writeText).toHaveBeenCalledWith("https://link.test/demo");
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it("says so when the clipboard is unavailable instead of silently doing nothing", async () => {
    vi.stubGlobal("navigator", {});
    render(<CopyButton value="https://link.test/demo" label="Copy short link" />);
    await userEvent.click(screen.getByRole("button", { name: /copy short link/i }));
    expect(await screen.findByText(/could not copy/i)).toBeInTheDocument();
  });
});
