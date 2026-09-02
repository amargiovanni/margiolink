import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { renderQrPixels } from "./qr";

/** These tests decode the exact pixel buffer `QrPanel` draws to the
 *  screen — the strongest available check, and the one the brief asked
 *  for over "an element with the right src exists": a QR that renders but
 *  encodes the wrong thing, or one too dense to scan at the size this app
 *  ships, would still pass a presence assertion. It cannot pass this one. */
describe("renderQrPixels", () => {
  it("decodes back to the exact URL it was given", () => {
    const url = "https://link.margio.uk/demo?s=qr";
    const { data, width, height } = renderQrPixels(url, 512);
    expect(jsQR(data, width, height)?.data).toBe(url);
  });

  it("still decodes at 1024px, the size the PNG download actually produces", () => {
    const url = "https://link.margio.uk/a-fairly-long-slug-for-a-campaign?s=qr";
    const { data, width, height } = renderQrPixels(url, 1024);
    expect(jsQR(data, width, height)?.data).toBe(url);
  });

  it("encodes each link distinctly, not a shared or fixed value", () => {
    const a = renderQrPixels("https://link.margio.uk/one?s=qr", 512);
    const b = renderQrPixels("https://link.margio.uk/two?s=qr", 512);
    expect(jsQR(a.data, a.width, a.height)?.data).toBe("https://link.margio.uk/one?s=qr");
    expect(jsQR(b.data, b.width, b.height)?.data).toBe("https://link.margio.uk/two?s=qr");
  });

  it("returns an opaque buffer sized for the requested pixel dimensions", () => {
    const { data, width, height } = renderQrPixels("https://link.margio.uk/x?s=qr", 300);
    expect(width).toBe(300);
    expect(height).toBe(300);
    expect(data.length).toBe(300 * 300 * 4);
    // Every pixel is fully opaque — a translucent PNG would look broken
    // composited over an unpredictable background.
    for (let i = 3; i < data.length; i += 4) {
      expect(data[i]).toBe(255);
    }
  });
});
