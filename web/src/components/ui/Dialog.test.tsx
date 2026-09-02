import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("exposes its title as the accessible name", async () => {
    render(
      <Dialog open title="New link" onOpenChange={() => {}}>
        <p>Body</p>
      </Dialog>,
    );
    expect(await screen.findByRole("dialog", { name: "New link" })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open title="New link" onOpenChange={onOpenChange}>
        <p>Body</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
