import { readFile } from "node:fs/promises";
import jsQR from "jsqr";
import { expect, test } from "./fixtures";

/**
 * The files this dashboard hands to people. Two defects, both fixed the same
 * day:
 *
 * - `ebe93a8`: the QR PNG was produced by loading the server's SVG into an
 *   `<img>` and rasterising it onto a `<canvas>`. That SVG has no intrinsic
 *   size (`viewBox` only — `qrcode-generator`'s `scalable: true` output), and
 *   several browsers draw nothing onto a canvas from a zero-size image. The
 *   PNG could render perfectly and still encode nothing, or the wrong thing —
 *   a scan of a printed code would never have counted as a scan. jsdom has no
 *   `<canvas>`, so nothing in the unit suite could see this.
 * - `b34c31d`: the CSV export was open to formula/DDE injection — a title or
 *   URL starting with `=`, `+`, `-`, `@`, a tab or a CR is read as a formula
 *   the instant a spreadsheet opens the file.
 *
 * Both downloads are decoded for real here: the PNG and the SVG are drawn
 * onto a real `<canvas>` and read back with `jsqr` — jsdom's structural gap,
 * not a stand-in for it.
 */

const SHORT_DOMAIN = "link.margio.uk";
const PRIMARY_SLUG = "e2e-primary";
const NON_ASCII_TITLE = "Café Ünïcödé 日本語";

interface QrRaster {
  data: number[];
  width: number;
  height: number;
}

/** Draws a data: URL image onto a real `<canvas>` inside the page, via a real
 *  `<img>`, and reads the pixels back — used for both the PNG and the SVG
 *  download. `createImageBitmap` was tried first and dropped: it throws
 *  `InvalidStateError` on this exact SVG in Chromium even once the source
 *  has explicit `width`/`height` (verified interactively), where `<img>` +
 *  `drawImage` decodes it correctly. That is the *opposite* failure mode
 *  from `ebe93a8` — this SVG has a real intrinsic size, patched in by the
 *  caller before it ever reaches here — so this is not a repeat of the
 *  original bug, just a different decoder with a real SVG limitation. */
async function rasterise(
  page: import("@playwright/test").Page,
  dataUrl: string,
): Promise<QrRaster> {
  return page.evaluate(async (url) => {
    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`failed to load image from ${url.slice(0, 40)}...`));
    });
    img.src = url;
    await loaded;

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2D canvas context");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: Array.from(imageData.data), width: canvas.width, height: canvas.height };
  }, dataUrl);
}

function decode(raster: QrRaster): string | null {
  return jsQR(Uint8ClampedArray.from(raster.data), raster.width, raster.height)?.data ?? null;
}

/** A minimal quoted-CSV field splitter — sufficient for this file's own
 *  export, which never nests a comma inside anything but a doubled quote
 *  (see `csvField` in `web/src/pages/Settings.tsx`). */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Navigates to the seeded primary link's own detail page via the Links
 *  page's search box, rather than a hardcoded id — the link's numeric id
 *  depends on whatever else is already in this D1 instance (a fresh CI
 *  database starts it at 1; a developer's local `.wrangler/state` may not). */
async function openPrimaryLink(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/app/links");
  await page.getByPlaceholder("Search by slug, title or destination").fill(PRIMARY_SLUG);
  await page.getByRole("link", { name: PRIMARY_SLUG }).click();
  await page.waitForURL(/\/app\/links\/\d+$/);
}

test.describe("artefacts — the QR and CSV defects (ebe93a8, b34c31d)", () => {
  test("the QR PNG decodes to the tracked short URL, including ?s=qr", async ({
    authenticatedPage: page,
  }) => {
    await openPrimaryLink(page);

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("Playwright did not save the downloaded PNG to disk");
    const base64 = await readFile(path, { encoding: "base64" });

    const raster = await rasterise(page, `data:image/png;base64,${base64}`);
    expect(decode(raster)).toBe(`https://${SHORT_DOMAIN}/${PRIMARY_SLUG}?s=qr`);
  });

  test("the SVG QR encodes the exact same target as the PNG", async ({
    authenticatedPage: page,
  }) => {
    await openPrimaryLink(page);

    const pngDownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download PNG" }).click();
    const pngPath = await (await pngDownloadPromise).path();
    if (!pngPath) throw new Error("Playwright did not save the downloaded PNG to disk");
    const pngBase64 = await readFile(pngPath, { encoding: "base64" });
    const pngTarget = decode(await rasterise(page, `data:image/png;base64,${pngBase64}`));

    const svgDownloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download SVG" }).click();
    const svgPath = await (await svgDownloadPromise).path();
    if (!svgPath) throw new Error("Playwright did not save the downloaded SVG to disk");
    const svgText = await readFile(svgPath, "utf-8");
    // The server's SVG (src/routes/api/links.ts) is `scalable: true` —
    // viewBox only, no width/height — deliberately, for use as an <img>.
    // `rasterise` needs a real intrinsic size to draw from, so it goes
    // directly on the root element here, matching the aspect ratio its own
    // viewBox already declares.
    const sizedSvgText = svgText.replace("<svg ", '<svg width="1024" height="1024" ');
    const svgDataUrl = `data:image/svg+xml;base64,${Buffer.from(sizedSvgText, "utf-8").toString("base64")}`;
    const svgTarget = decode(await rasterise(page, svgDataUrl));

    expect(pngTarget).toBe(`https://${SHORT_DOMAIN}/${PRIMARY_SLUG}?s=qr`);
    expect(svgTarget, "the SVG and the PNG must encode one link, not two codes for one").toBe(
      pngTarget,
    );
  });

  test("the CSV export neutralises a formula title, keeps a UTF-8 BOM, and keeps non-ASCII text intact", async ({
    authenticatedPage: page,
  }) => {
    // A link with a non-ASCII title, created here rather than in the shared
    // seed (seed.ts's two links are the brief's own fixture shape) — the
    // export's UTF-8 BOM only matters if there is a non-ASCII field for
    // Excel to have gotten wrong without it.
    await page.goto("/app/links");
    await page.getByRole("button", { name: "New link" }).click();
    await page.getByLabel("Destination").fill("https://example.com/non-ascii");
    await page.getByLabel("Custom slug").fill("e2e-non-ascii");
    await page.getByLabel("Title (optional)").fill(NON_ASCII_TITLE);
    await page.getByRole("button", { name: "Create link" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.goto("/app/settings");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export links as CSV" }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error("Playwright did not save the downloaded CSV to disk");
    const bytes = await readFile(path);

    expect(
      [bytes[0], bytes[1], bytes[2]],
      "the file must open with a UTF-8 BOM (EF BB BF) so Excel on Windows guesses the encoding correctly",
    ).toEqual([0xef, 0xbb, 0xbf]);

    const text = bytes.toString("utf-8").replace(/^﻿/, "");
    const header = splitCsvLine(text.split("\r\n")[0] ?? "");
    const titleColumn = header.indexOf("title");
    const slugColumn = header.indexOf("slug");
    expect(titleColumn, "CSV_HEADER changed shape").toBeGreaterThanOrEqual(0);

    const rows = text.split("\r\n").slice(1).filter(Boolean).map(splitCsvLine);

    const formulaRow = rows.find((row) => row[slugColumn] === PRIMARY_SLUG);
    expect(formulaRow, `no exported row for slug "${PRIMARY_SLUG}"`).toBeDefined();
    expect(
      formulaRow?.[titleColumn],
      "a title starting with = must be neutralised with a leading single quote",
    ).toBe("'=1+1 seasonal launch");

    const nonAsciiRow = rows.find((row) => row[slugColumn] === "e2e-non-ascii");
    expect(nonAsciiRow, "no exported row for the non-ASCII fixture link").toBeDefined();
    expect(nonAsciiRow?.[titleColumn]).toBe(NON_ASCII_TITLE);

    const deletedRow = rows.find((row) => row[slugColumn] === "e2e-archived");
    expect(deletedRow, "the soft-deleted seed link must not appear in the export").toBeUndefined();
  });
});
