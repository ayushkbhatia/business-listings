/**
 * Contrast, in one place.
 *
 * `scripts/contrast-audit.mts` measures every token pairing the design system
 * uses against §09.2's floor with this, and anything else that needs the ratio
 * should too — a second implementation of WCAG's relative luminance is a second
 * implementation that disagrees with the first.
 *
 * It also used to check a seller's own brand hex on save. That rule went with
 * the storefront theme presets (board `5b`, cut 15 Sep 2026): no seller picks a
 * colour, so nothing is left to refuse.
 */

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter! + 0.05) / (darker! + 0.05);
}

/** §09.2's floor for body-sized text. */
export const CONTRAST_FLOOR = 4.5;
