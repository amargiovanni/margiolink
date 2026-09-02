import { useState } from "react";
import { renderQrPixels } from "../../lib/qr";
import { Button } from "../ui/Button";

/** The PNG is generated at this resolution — large enough to survive being
 *  scaled up in print without looking pixelated. */
const PNG_SIZE = 1024;

export interface QrPanelProps {
  linkId: number;
  slug: string;
  /** The link's full short URL (e.g. "https://link.margio.uk/demo"), used
   *  to build the exact target the PNG encodes. Optional only so the
   *  component still type-checks against a caller that has nothing but a
   *  slug; falls back to this page's own origin, which is correct in
   *  production since the dashboard and the redirector are the same
   *  Worker on the same domain. */
  shortUrl?: string;
}

/** The QR code for a link, with both an SVG and a PNG download.
 *
 * The two downloads are generated two different ways, deliberately:
 *
 * - The SVG download is a link straight to the existing API endpoint
 *   (`src/routes/api/links.ts`), which serves a QR built with
 *   `qrcode-generator`'s `scalable: true` — a `viewBox` with no `width`/
 *   `height` attributes. That is fine for an `<img>`.
 * - The PNG is **not** produced by loading that SVG into an `<img>` and
 *   drawing it onto a canvas. An SVG with no intrinsic size is exactly the
 *   case where that fails silently in several browsers — `img.naturalWidth`
 *   comes back 0 and `drawImage` draws nothing. Instead, `renderQrPixels`
 *   (`web/src/lib/qr.ts`) regenerates the QR code from scratch, directly
 *   into a pixel buffer, using the same `qrcode-generator` module-grid API
 *   the server uses — no SVG, no `<img>`, no intrinsic-size step to lose.
 *   `qr.test.ts` decodes that exact buffer with a real QR decoder and
 *   checks it against the URL it should encode, which an "element with the
 *   right src exists" test cannot do.
 */
export function QrPanel({ linkId, slug, shortUrl }: QrPanelProps) {
  const svgSrc = `/api/links/${linkId}/qr.svg`;
  const [pngError, setPngError] = useState(false);

  function handleDownloadPng() {
    setPngError(false);
    try {
      const base = shortUrl ?? `${window.location.origin}/${slug}`;
      const targetUrl = `${base}?s=qr`;
      const { data, width, height } = renderQrPixels(targetUrl, PNG_SIZE);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("this browser has no 2D canvas context");
      ctx.putImageData(new ImageData(data, width, height), 0, 0);

      canvas.toBlob((blob) => {
        if (!blob) {
          setPngError(true);
          return;
        }
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = `${slug}.png`;
        anchor.click();
        URL.revokeObjectURL(downloadUrl);
      }, "image/png");
    } catch {
      setPngError(true);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <img src={svgSrc} alt={`QR code for ${slug}`} width={160} height={160} className="size-40" />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={svgSrc}
          download={`${slug}.svg`}
          className="rounded border border-rule px-3 py-1.5 text-sm text-ink hover:bg-surface-sunken"
        >
          Download SVG
        </a>
        <Button variant="ghost" size="sm" onClick={handleDownloadPng}>
          Download PNG
        </Button>
      </div>

      {pngError && (
        <p role="alert" className="text-xs text-critical">
          Could not generate a PNG. The SVG download above still works.
        </p>
      )}

      <p className="text-center text-xs text-ink-faint">
        A scan of this QR code is counted separately from a click on the short link.
      </p>
    </div>
  );
}
