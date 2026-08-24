/**
 * Quote arithmetic, in fils.
 *
 * A quote total is the number a buyer compares against two other quotes and
 * then commits their company to. It is not allowed to be a float. 0.1 + 0.2 is
 * the oldest bug in software and it has no business appearing on a line that
 * says AED.
 *
 * So: parse the Decimal string Postgres gives us into integer fils, add in
 * bigint, and format once at the edge. `formatAED` still takes the string,
 * because display rounding is a different problem from addition.
 *
 * 1 dirham = 100 fils.
 */

const FILS_PER_AED = 100n;

/**
 * Exact. Rejects anything a price column should never hold rather than
 * silently rounding it — a third decimal place in a price is a data error, and
 * discovering it at the point of sale beats discovering it in a total.
 */
export function parseAedToFils(value: string | number): bigint {
  const raw = typeof value === "number" ? String(value) : value.trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) {
    throw new TypeError(`Not a dirham amount with at most two decimals: ${JSON.stringify(value)}`);
  }
  const [, sign, whole, frac = ""] = m;
  const fils = BigInt(whole!) * FILS_PER_AED + BigInt(frac.padEnd(2, "0"));
  return sign === "-" ? -fils : fils;
}

/** Back to the string `formatAED` and Prisma both understand. Always 2 places. */
export function filsToAed(fils: bigint): string {
  const negative = fils < 0n;
  const abs = negative ? -fils : fils;
  const whole = abs / FILS_PER_AED;
  const frac = abs % FILS_PER_AED;
  return `${negative ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

export interface PricedLine {
  qty: number;
  /** As stored: a Decimal string, or a number from an unsaved form. */
  unitPrice: string | number;
}

/** One line. Quantity is a count, so integer multiplication stays exact. */
export function lineTotalFils(line: PricedLine): bigint {
  if (!Number.isInteger(line.qty) || line.qty < 0) {
    throw new TypeError(`A quote line quantity must be a non-negative whole number: ${String(line.qty)}`);
  }
  return parseAedToFils(line.unitPrice) * BigInt(line.qty);
}

export function quoteTotalFils(lines: readonly PricedLine[]): bigint {
  return lines.reduce((sum, line) => sum + lineTotalFils(line), 0n);
}

/** `quoteTotalAed(lines)` → `"15344.00"`, ready for formatAED. */
export function quoteTotalAed(lines: readonly PricedLine[]): string {
  return filsToAed(quoteTotalFils(lines));
}

export interface Delta {
  fils: bigint;
  aed: string;
  direction: "up" | "down" | "same";
  /** Signed, to one decimal. Null when the previous total was zero. */
  percent: number | null;
}

/**
 * What a revision changed. Board 10h shows the previous price struck through
 * beside the new one; this is the number that sits next to it.
 */
export function delta(previousFils: bigint, currentFils: bigint): Delta {
  const diff = currentFils - previousFils;
  return {
    fils: diff,
    aed: filsToAed(diff),
    direction: diff > 0n ? "up" : diff < 0n ? "down" : "same",
    percent:
      previousFils === 0n
        ? null
        : Math.round((Number(diff) / Number(previousFils)) * 1000) / 10,
  };
}
