import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field } from "./Field";

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
});
