import { UAE_LOCALE } from "./locale";

export type AedInput = number | string;

export type AedStyle =
  /** Public and interface copy: `AED 15,624`. Rounded to whole dirhams. */
  | "display"
  /** Quote and invoice lines: `15,624.00`. The column head carries the currency. */
  | "quote"
  /**
   * Billing totals: `AED 1,783.95`. The currency **and** the fils.
   *
   * Board 3m, criterion 3: *"no total is rounded."* Its second correction is a
   * `THIS PERIOD` panel reading `AED 1,784` over two lines that summed to 1,699
   * — a seller could not reproduce the number they owed, and the missing 84.95
   * was VAT that had been folded in and then rounded away.
   *
   * `display` cannot serve that panel because rounding is the whole point of
   * `display`: a category page saying "from AED 15,624" is better without the
   * fils. A billing screen whose invoice shows cents is not, and the difference
   * is worth a style rather than a per-call option nobody remembers to pass.
   */
  | "exact";

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
  const digits = style === "display" ? 0 : 2;

  const magnitude = new Intl.NumberFormat(UAE_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(n));

  // `quote` is the only style without the currency: it renders inside a column
  // whose head already carries it.
  const body = style === "quote" ? magnitude : `AED ${magnitude}`;

  if (n < 0) return accounting ? `(${body})` : `-${body}`;
  return body;
}
