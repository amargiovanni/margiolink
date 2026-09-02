import qrcodeGenerator from "qrcode-generator";

export interface QrRaster {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Modules of white quiet zone on every side — the ISO/IEC 18004 minimum is
 *  4, which several real-world scanners rely on to find the code's edges. */
const QUIET_ZONE_MODULES = 4;

/**
 * Renders `text` as a QR code directly into an RGBA pixel buffer, `size` ×
 * `size` pixels.
 *
 * This never goes through an SVG or a `<canvas>` — it is pure arithmetic
 * over `qrcode-generator`'s module grid (the `getModuleCount`/`isDark` pair
 * the server already depends on for its SVG endpoint at
 * `src/routes/api/links.ts`). Two things follow from that:
 *
 * 1. It sidesteps the exact failure mode measured in that endpoint's SVG: a
 *    `viewBox` with no `width`/`height` leaves an `<img>`'s intrinsic size
 *    undefined, and rasterising *that* onto a canvas is what silently
 *    produces a blank image in several browsers. Generating the modules
 *    directly has no intrinsic-size step to lose — there is no image to
 *    load and no size to fail to report.
 * 2. Because it needs nothing from the DOM (no `Image`, no `<canvas>`, no
 *    `document`), it runs identically in a real browser and under
 *    Vitest/jsdom. `QrPanel` draws this exact buffer to the screen with
 *    `ctx.putImageData`, and `qr.test.ts` feeds this exact buffer to a real
 *    QR decoder (`jsqr`) and checks it against the URL it should encode —
 *    the test is proving the shipped pixels decode correctly, not standing
 *    in for that proof.
 */
export function renderQrPixels(text: string, size: number): QrRaster {
  const qr = qrcodeGenerator(0, "M");
  qr.addData(text);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const totalModules = moduleCount + QUIET_ZONE_MODULES * 2;
  const cell = size / totalModules;

  const data = new Uint8ClampedArray(size * size * 4).fill(255);

  function paintModule(row: number, col: number) {
    const x0 = Math.floor((col + QUIET_ZONE_MODULES) * cell);
    const y0 = Math.floor((row + QUIET_ZONE_MODULES) * cell);
    const x1 = Math.ceil((col + QUIET_ZONE_MODULES + 1) * cell);
    const y1 = Math.ceil((row + QUIET_ZONE_MODULES + 1) * cell);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }

  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) paintModule(row, col);
    }
  }

  return { data, width: size, height: size };
}
