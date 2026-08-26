/**
 * Contrast, in one place.
 *
 * The maths lived in `scripts/contrast-audit.mts` and nowhere else, which was
 * fine while contrast was only ever audited. Criterion 5 makes it a rule the
 * product enforces — *"a custom brand hex below 4.5:1 against white is rejected
 * with the reason shown"* — and a second implementation of WCAG's relative
 * luminance is a second implementation that disagrees with the first.
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

/**
 * What a brand colour is measured against.
 *
 * `--paper`, not white. Criterion 5 says "against white" and this is stricter:
 * the page background is `#FAF9F6`, so a colour that clears the floor here
 * clears it against white too — and it is measured against the surface it is
 * actually painted on rather than one this product does not have.
 *
 * The one literal colour in `lib/`, and it is arithmetic rather than styling:
 * nothing renders it. `contrast.test.ts` asserts it still equals the `--paper`
 * token in `docs/tokens.css`, so it cannot drift away from the real background.
 */
// Arithmetic, not styling. Nothing renders this; `contrast.test.ts` pins it to
// the `--paper` token so it cannot drift from the background it represents.
// eslint-disable-next-line no-restricted-syntax
export const PAPER = "#FAF9F6";

export type HexRefusal = "not_a_hex" | "below_floor";

export interface HexCheck {
  ok: boolean;
  /** Rounded to two places, which is what the message shows. */
  ratio: number;
  reason?: HexRefusal;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;

/**
 * May a seller use this as their brand colour?
 *
 * Three digits are refused rather than expanded. Short and long forms of one
 * colour are the same colour, but a field that silently rewrites what somebody typed is a
 * field that will one day rewrite it wrong — and the seller is choosing a brand
 * colour, which they will have written down somewhere in six digits.
 *
 * Measured against white because that is what the brand colour sits on: it
 * paints headings, links and button labels on `--paper`. A colour that passes
 * against ink and fails against paper would be legible on precisely the surface
 * it is not used on.
 */
export function checkBrandHex(input: string): HexCheck {
  const hex = input.trim();
  if (!HEX.test(hex)) return { ok: false, ratio: 0, reason: "not_a_hex" };

  const ratio = Math.round(contrastRatio(hex, PAPER) * 100) / 100;
  if (ratio < CONTRAST_FLOOR) return { ok: false, ratio, reason: "below_floor" };
  return { ok: true, ratio };
}

/** The six presets, which are the only themes a template may offer by name. */
export const THEME_PRESETS = [
  "default",
  "industrial",
  "trade",
  "mono",
  "clinic",
  "salon",
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export function isThemePreset(value: string): value is ThemePreset {
  return (THEME_PRESETS as readonly string[]).includes(value);
}
