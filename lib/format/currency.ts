import { UAE_LOCALE } from "./locale";

export type AedInput = number | string;

export type AedStyle =
  /** Public and interface copy: `AED 15,624`. Rounded to whole dirhams. */
  | "display"
  /** Quote and invoice lines: `15,624.00`. The column head carries the currency. */
  | "quote";

export interface FormatAedOptions {
  style?: AedStyle;
  /** Render a negative as `(1,200.00)`. Credit notes only; never a buyer-facing surface. */
  accounting?: boolean;
}

function toNumber(value: AedInput): number {
  // Prisma hands Decimal back as a string. Parsing it here keeps every call site
  // from having to know that.
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isFinite(n)) {
    throw new TypeError(`formatAED received a value that is not a finite number: ${String(value)}`);
  }
  return n;
}

/**
 * `AED 15,624` for display, `15,624.00` inside a quote.
 *
 * Never abbreviated. A buyer comparing three quotes needs the digits to line up,
 * and `AED 15.6k` costs them the comparison.
 */
export function formatAED(value: AedInput, options: FormatAedOptions = {}): string {
  const { style = "display", accounting = false } = options;
  const n = toNumber(value);
  const digits = style === "quote" ? 2 : 0;

  const magnitude = new Intl.NumberFormat(UAE_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(n));

  const body = style === "display" ? `AED ${magnitude}` : magnitude;

  if (n < 0) return accounting ? `(${body})` : `-${body}`;
  return body;
}
