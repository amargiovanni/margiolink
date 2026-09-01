import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";
import { Select } from "./Select";

describe("Field", () => {
  it("associates its label with the control", () => {
    render(
      <Field id="slug" label="Slug">
        <input id="slug" />
      </Field>,
    );
    expect(screen.getByLabelText("Slug")).toBeInTheDocument();
  });

  it("announces the hint through aria-describedby", () => {
    render(
      <Field id="slug" label="Slug" hint="Letters, digits and dashes">
        <input id="slug" />
      </Field>,
    );
    expect(screen.getByLabelText("Slug")).toHaveAccessibleDescription(
      /letters, digits and dashes/i,
    );
  });

  it("marks the control invalid and announces the error", () => {
    render(
      <Field id="slug" label="Slug" error="That slug is taken">
        <input id="slug" />
      </Field>,
    );
    const input = screen.getByLabelText("Slug");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/that slug is taken/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/that slug is taken/i);
  });

  it("keeps the hint and the error both reachable when both are present", () => {
    render(
      <Field id="slug" label="Slug" hint="Letters, digits and dashes" error="That slug is taken">
        <input id="slug" />
      </Field>,
    );
    const input = screen.getByLabelText("Slug");
    // Neither description clobbers the other's id — both texts show up in
    // the combined accessible description, in the order the ids are listed.
    expect(input).toHaveAccessibleDescription(/letters, digits and dashes.*that slug is taken/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/that slug is taken/i);
  });

  it("wires aria-invalid and aria-describedby onto a composed control, not only a plain input", () => {
    render(
      <Field id="sort" label="Sort" error="Pick a valid option">
        <Select
          id="sort"
          aria-label="Sort"
          value="a"
          onValueChange={() => {}}
          options={[{ value: "a", label: "A" }]}
        />
      </Field>,
    );
    const trigger = screen.getByRole("combobox", { name: "Sort" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger).toHaveAccessibleDescription(/pick a valid option/i);
  });
});
