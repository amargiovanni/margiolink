import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PeriodPicker } from "./PeriodPicker";

describe("PeriodPicker", () => {
  it("is a radio group, so arrow keys move between periods", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: /period/i })).toBeInTheDocument();
  });

  it("marks the current period for assistive technology", () => {
    render(<PeriodPicker value="7d" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: /7 days/i })).toBeChecked();
  });

  it("reports the chosen period", async () => {
    const onChange = vi.fn();
    render(<PeriodPicker value="7d" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: /30 days/i }));
    expect(onChange).toHaveBeenCalledWith("30d");
  });
});
