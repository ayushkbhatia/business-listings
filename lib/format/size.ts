import { MIDDLE_DOT, NBSP } from "./locale";

/**
 * Nominal diameter to nominal imperial bore. Trade sizes, not conversions —
 * DN100 is called 4 inch and measures 114.3 mm, and nobody in Al Quoz cares.
 */
const DN_TO_INCH: ReadonlyMap<number, string> = new Map([
  [6, "1/8"], [8, "1/4"], [10, "3/8"], [15, "1/2"], [20, "3/4"],
  [25, "1"], [32, "1-1/4"], [40, "1-1/2"], [50, "2"], [65, "2-1/2"],
  [80, "3"], [90, "3-1/2"], [100, "4"], [125, "5"], [150, "6"],
  [200, "8"], [250, "10"], [300, "12"], [350, "14"], [400, "16"],
  [450, "18"], [500, "20"], [600, "24"], [700, "28"], [750, "30"],
  [800, "32"], [900, "36"], [1000, "40"], [1200, "48"],
]);

const MM_PER_INCH = 25.4;

export interface SizeInput {
  /** Nominal diameter, the metric trade size. Preferred. */
  dn?: number;
  /** A plain millimetre measurement, for anything that is not nominal-bore. */
  mm?: number;
  /** An imperial-first source, e.g. an imported catalogue. Converted for display. */
  inch?: number;
}

/**
 * `DN100 · 4 inch` · `100 mm · 3.94 inch`
 *
 * Metric leads because the licence, the drawing and the customs paperwork are
 * metric. Imperial follows because half the counter still asks for four inch.
 */
export function formatSize(input: SizeInput): string {
  if (input.dn !== undefined) {
    const imperial = DN_TO_INCH.get(input.dn);
    const metric = `DN${input.dn}`;
    return imperial ? `${metric} ${MIDDLE_DOT} ${imperial}${NBSP}inch` : metric;
  }

  if (input.mm !== undefined) {
    const inch = input.mm / MM_PER_INCH;
    return `${trim(input.mm)}${NBSP}mm ${MIDDLE_DOT} ${trim(inch, 2)}${NBSP}inch`;
  }

  if (input.inch !== undefined) {
    const mm = input.inch * MM_PER_INCH;
    return `${trim(mm, 1)}${NBSP}mm ${MIDDLE_DOT} ${trim(input.inch, 2)}${NBSP}inch`;
  }

  throw new TypeError("formatSize needs one of dn, mm or inch");
}

/** `DN100` alone, for a filter chip where the pairing would not fit. */
export function formatNominalDiameter(dn: number): string {
  return `DN${dn}`;
}

function trim(value: number, maxDigits = 1): string {
  return String(Number(value.toFixed(maxDigits)));
}

/** `2.4 MB`. Media library and document uploads. Decimal, as every OS now reports. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new TypeError(`formatBytes expects a non-negative number, received: ${String(bytes)}`);
  }
  if (bytes < 1000) return `${Math.round(bytes)}${NBSP}B`;
  const units = ["kB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${trim(value, value < 10 ? 1 : 0)}${NBSP}${units[unit]}`;
}
