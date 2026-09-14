import { CERTAIN, DEFAULT_BANDS, type Bands } from "./similarity";

/**
 * What `Tune matching` may set — board `12b` B8.
 *
 * Pure, so the limits are unit-tested and the screen, the service and the
 * preview all refuse the same values.
 *
 * ## The certain line cannot go below 90%
 *
 * The matcher's safety property is that no pair reaches the certain band
 * without a licence number agreeing: every other path is capped at 0.89
 * (`similarity.ts`). A certain line at 0.85 would quietly undo that — a shared
 * name, phone and address would start bulk-merging — so the tuning that exists
 * to protect reviews cannot be used to put them at risk. Raising it is allowed:
 * a stricter bulk band sends more pairs to a person, which is the safe
 * direction.
 *
 * ## The floor can move
 *
 * Lower it and more pairs reach the manual queue; raise it and fewer do. Q1's
 * worry is the second: a floor set too high hides real duplicates, which is why
 * the near-miss count exists, and why the preview states the new queue size
 * before anything is applied.
 */

export const FLOOR_MIN = 0.4;
/** The gap a manual band must keep. A band of nothing is not a band. */
export const BAND_MIN_WIDTH = 0.05;
export const CERTAIN_MIN = CERTAIN;
export const CERTAIN_MAX = 0.99;

export type BandsProblem = "floor_too_low" | "certain_too_low" | "certain_too_high" | "band_too_narrow";

export function bandsProblem(bands: Bands): BandsProblem | null {
  if (!Number.isFinite(bands.floor) || bands.floor < FLOOR_MIN) return "floor_too_low";
  if (!Number.isFinite(bands.certain) || bands.certain < CERTAIN_MIN) return "certain_too_low";
  if (bands.certain > CERTAIN_MAX) return "certain_too_high";
  if (bands.certain - bands.floor < BAND_MIN_WIDTH - 1e-9) return "band_too_narrow";
  return null;
}

/** Two places, the precision a person can type and a screen can show. */
export function roundBand(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A stored setting, read defensively: anything malformed is the default. */
export function parseBands(value: unknown): Bands {
  if (!value || typeof value !== "object") return DEFAULT_BANDS;
  const { floor, certain } = value as Record<string, unknown>;
  const candidate = { floor: Number(floor), certain: Number(certain) };
  return bandsProblem(candidate) === null ? candidate : DEFAULT_BANDS;
}

/** "60%" — how a line is written on screen and in an audit row. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
