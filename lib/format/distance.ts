/**
 * Kilometres, as a buyer would say them.
 *
 * Board 1c prints a distance on every result row — "2.1 km", "14 km", "19 km".
 * Note the board's own precision: one decimal close in, none further out. That
 * is not inconsistency, it is the useful amount of information. The difference
 * between 2.1 and 2.4 km decides which supplier somebody drives to before lunch;
 * the difference between 19.2 and 19.4 decides nothing, and printing it implies
 * an accuracy that a pin dropped on a warehouse roof does not have.
 */

const NBSP = " ";

export function formatKm(km: number | null | undefined): string | undefined {
  if (km === null || km === undefined || !Number.isFinite(km)) return undefined;

  /*
     Under 100 m reads as "here" rather than a number.

     A buyer filtered to Al Quoz, measuring from Al Quoz's own centroid, will
     produce distances of a few dozen metres for suppliers on the next street.
     "0.0 km" looks like a bug and "43 m" is more precision than a centroid
     earns.
  */
  if (km < 0.1) return `<${NBSP}0.1${NBSP}km`;

  // A non-breaking space so a row never wraps between the number and its unit.
  if (km < 10) return `${km.toFixed(1)}${NBSP}km`;
  return `${Math.round(km)}${NBSP}km`;
}
