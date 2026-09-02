import jsQR from "jsqr";
import qrcodeGenerator from "qrcode-generator";
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

  // A decode test cannot pin the quiet zone: real decoders tolerate quiet
  // zone violations, so a one-module or asymmetric shrink would very
  // likely still decode. This pins the constant directly, by locating the
  // exact pixel boundary between the quiet zone and the QR's content on
  // all four sides — using the three finder patterns' outer corners, which
  // ISO/IEC 18004 guarantees are dark for every QR code regardless of its
  // data, as fixed reference points.
  describe("quiet zone", () => {
    const text = "https://link.margio.uk/quiet-zone-check?s=qr";
    const CELL = 10;
    const MARGIN_MODULES = 4;

    function isBlack(data: Uint8ClampedArray, width: number, x: number, y: number) {
      const i = (y * width + x) * 4;
      return data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255;
    }

    function isWhite(data: Uint8ClampedArray, width: number, x: number, y: number) {
      const i = (y * width + x) * 4;
      return data[i] === 255 && data[i + 1] === 255 && data[i + 2] === 255 && data[i + 3] === 255;
    }

    it("is exactly 4 modules wide on every side", () => {
      // A separate call to the same library `renderQrPixels` uses
      // internally, purely to get this text's module count so the test can
      // pick a `size` that divides evenly into an integer cell size — an
      // exact pixel boundary to assert on, with no rounding to blur it.
      const qr = qrcodeGenerator(0, "M");
      qr.addData(text);
      qr.make();
      const moduleCount = qr.getModuleCount();
      const size = (moduleCount + MARGIN_MODULES * 2) * CELL;
      const marginPx = MARGIN_MODULES * CELL;

      const { data, width } = renderQrPixels(text, size);

      // Top-left finder pattern's own top-left corner (module (0,0)) is
      // dark for every QR code — it pins the left and top margins at once.
      expect(isBlack(data, width, marginPx, marginPx)).toBe(true);
      expect(isWhite(data, width, marginPx - 1, marginPx)).toBe(true);
      expect(isWhite(data, width, marginPx, marginPx - 1)).toBe(true);

      // Top-right finder pattern's top-right corner (module (0, moduleCount-1)).
      expect(isBlack(data, width, size - marginPx - 1, marginPx)).toBe(true);
      expect(isWhite(data, width, size - marginPx, marginPx)).toBe(true);

      // Bottom-left finder pattern's bottom-left corner (module (moduleCount-1, 0)).
      expect(isBlack(data, width, marginPx, size - marginPx - 1)).toBe(true);
      expect(isWhite(data, width, marginPx, size - marginPx)).toBe(true);
    });
  });
});
