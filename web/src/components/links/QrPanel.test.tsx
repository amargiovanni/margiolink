import { render, screen } from "@testing-library/react";
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
});
