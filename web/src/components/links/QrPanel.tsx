import { useState } from "react";
import { Button } from "../ui/Button";

/** Drawn onto a canvas and exported at this resolution — large enough to
 *  survive being scaled up in print without looking pixelated. */
const PNG_SIZE = 1024;

export interface QrPanelProps {
  linkId: number;
  slug: string;
}

/** The QR code for a link, with both an SVG and a PNG download.
 *
 * The endpoint at `src/routes/api/links.ts` builds its SVG with
 * `scalable: true`, which — per `qrcode-generator`'s own source — omits the
 * `width`/`height` attributes entirely and leaves only a `viewBox`. That is
 * fine for the `<img>` below (a viewBox alone is enough for a browser to lay
 * an image out), but it means the image's *intrinsic* size cannot be trusted
 * once it is drawn onto a `<canvas>`: several browsers report a 0×0 natural
 * size for such an SVG and draw nothing if the canvas dimensions are derived
 * from it. The PNG export below sets the canvas size and the `drawImage`
 * destination rectangle to fixed pixel values instead of reading anything off
 * the image.
 */
export function QrPanel({ linkId, slug }: QrPanelProps) {
  const svgSrc = `/api/links/${linkId}/qr.svg`;
  const [pngError, setPngError] = useState(false);

  async function handleDownloadPng() {
    setPngError(false);
    let objectUrl: string | null = null;
    try {
      const response = await fetch(svgSrc);
      if (!response.ok) throw new Error("could not load the QR code");
      const svgText = await response.text();

      const image = new Image();
      objectUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("the QR image failed to decode"));
        image.src = objectUrl as string;
      });

      const canvas = document.createElement("canvas");
      canvas.width = PNG_SIZE;
      canvas.height = PNG_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("this browser has no 2D canvas context");
      ctx.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("could not encode the PNG");

      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `${slug}.png`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      setPngError(true);
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
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
