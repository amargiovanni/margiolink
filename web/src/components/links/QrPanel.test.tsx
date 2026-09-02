import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QrPanel } from "./QrPanel";

describe("QrPanel", () => {
  it("points at the API's SVG endpoint for this link", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByRole("img", { name: /qr code for demo/i })).toHaveAttribute(
      "src",
      "/api/links/42/qr.svg",
    );
  });

  it("offers an SVG download", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByRole("link", { name: /download svg/i })).toHaveAttribute(
      "download",
      "demo.svg",
    );
  });

  it("explains that scans are counted separately", () => {
    render(<QrPanel linkId={42} slug="demo" />);
    expect(screen.getByText(/counted separately/i)).toBeInTheDocument();
  });

  // What the PNG button actually *encodes* is verified by `qr.test.ts`,
  // which decodes the real pixel buffer with `jsqr` — jsdom has no canvas
  // implementation, so nothing here can prove pixels. This test instead
  // covers the one thing this environment *can* prove: that the button
  // fails visibly and recoverably rather than silently, when the canvas it
  // needs isn't available (`HTMLCanvasElement.getContext` returns `null`
  // under plain jsdom).
  it("reports a recoverable error rather than crashing when no canvas is available", async () => {
    render(<QrPanel linkId={42} slug="demo" />);
    await userEvent.click(screen.getByRole("button", { name: /download png/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not generate a png/i);
  });
});
