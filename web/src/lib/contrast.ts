/** Parses a `#RRGGBB` (optionally without the `#`) hex colour. Returns
 *  `null` for anything else — including the 3-digit shorthand, which the
 *  backend never emits for a tag colour, so supporting it here would be
 *  untested surface on a function that now carries a correctness
 *  guarantee. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const digits = match?.[1];
  if (!digits) return null;
  const value = Number.parseInt(digits, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function linearise(channel8bit: number): number {
  const s = channel8bit / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return 0.2126 * linearise(rgb.r) + 0.7152 * linearise(rgb.g) + 0.0722 * linearise(rgb.b);
}

/** WCAG 2.x contrast ratio between two relative luminances, order-independent. */
export function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Picks whichever of pure black or pure white text contrasts better against
 *  a background of the given colour — computed by comparing both actual
 *  ratios, not by a guessed luminance threshold.
 *
 *  The two ratios cross at the background luminance solving
 *  `1.05/(L+0.05) = (L+0.05)/0.05`, i.e. `L ≈ 0.179129`, where both sides
 *  equal ≈4.58:1. Below that luminance white wins with a ratio above
 *  4.58:1; above it black does. Comparing the ratios directly means this
 *  is correct at every luminance, not only near the ones a test happens to
 *  check: the caller is guaranteed at least ≈4.58:1 (comfortably above
 *  WCAG AA's 4.5:1 floor) against *any* background colour, including
 *  colours a user picks that this codebase never validated itself. */
export function readableTextColor(rgb: { r: number; g: number; b: number }): "black" | "white" {
  const backgroundLuminance = relativeLuminance(rgb);
  const blackRatio = contrastRatio(backgroundLuminance, 0);
  const whiteRatio = contrastRatio(backgroundLuminance, 1);
  return blackRatio >= whiteRatio ? "black" : "white";
}
