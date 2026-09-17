/**
 * Board 4h `B11` — what the detectors are set to, and the bounds they move in.
 *
 * *"Auto-detected rows carry their detector and confidence, and the threshold is
 * configurable outside this screen."* This is the pure half: the shape of the
 * setting, its defaults and what a legal value is. `lib/reports/detector-settings.ts`
 * reads and writes it, `/admin/reports/detectors` is the screen, and
 * `lib/reports/detectors.ts` is the sweep that obeys it — the same four-file
 * split board 4b's `rules.ts` / `tuning.ts` / `queue.ts` / `/admin/queue/rules`
 * has, for the same reason: the decision has to be testable without a database.
 *
 * ## There is no confidence here
 *
 * The board draws `IMAGE MATCH · 88% CONFIDENCE`. The platform has no scoring
 * detector — every rule below is a count or a date, and both are either true or
 * not. A `confidence` column with no writer is a number a screen could one day
 * render out of nothing, which is the shape of defect this project's interface
 * rules exist to stop. What an auto-detected row carries instead is the figure
 * the detector actually measured, written into `SupplierReport.evidence`:
 * `SAME NUMBER ON 4 LISTINGS`, `LICENCE EXPIRED 14 MONTHS AGO`.
 *
 * ## Why a threshold is worth a screen
 *
 * The spec's flag 7: *"a threshold that produces too many false positives is a
 * moderator-time problem with no screen."* Two listings sharing a number is
 * routine — a group with two trading names — and at six it is one number
 * answering for a street. Where between those it becomes worth a moderator's
 * morning is a judgement that changes as the directory grows, so it is a
 * setting rather than a constant somebody has to open a pull request to move.
 */

export type DetectorId = "off_platform_message" | "shared_phone" | "licence_long_expired";

export interface DetectorRules {
  /**
   * How many published listings must share one telephone number before the
   * sweep files a report about it. Counted across *businesses*, never across
   * branches: a firm with the same switchboard on four of its own branches is
   * one business with one number, and reporting it would be reporting the
   * directory to itself.
   */
  sharedPhoneListings: number;
  /**
   * How long a trade licence must be past expiry before the sweep says the
   * business has gone.
   *
   * The board's own row is `LICENCE EXPIRED 14 MONTHS AGO`, found by two buyers
   * rather than by us — the spec calls that a symptom, and it is: `3e`'s expiry
   * pass drops the verification tier on the day, and nothing then asks whether
   * the firm is still there. Six months is long enough that a renewal in
   * progress has landed and short enough that a buyer has not yet driven to an
   * empty unit.
   */
  licenceExpiredDays: number;
  /**
   * Which sweeps run. `off_platform_message` is deliberately absent: it is not
   * a sweep, it runs at the moment a message is written, and a switch that
   * turns off fraud detection is a switch nobody notices is off — the same
   * decision board 4b makes for its two unswitchable rules.
   */
  sweeps: { shared_phone: boolean; licence_long_expired: boolean };
}

export const DETECTOR_SETTING_KEY = "report_detectors";

/**
 * How long a closed finding keeps a detector quiet about that business.
 *
 * A sweep that runs nightly and files the same finding every night buries the
 * queue it exists to fill. Ninety days, matching the window the outcomes rail
 * reports over: if the decision is still on the rail, it is still the answer,
 * and a moderator who looked at a shared number and decided it was a group with
 * two trading names should not be asked again tomorrow.
 */
export const COOLING_DAYS = 90;

export const DEFAULT_DETECTOR_RULES: DetectorRules = {
  sharedPhoneListings: 3,
  licenceExpiredDays: 180,
  sweeps: { shared_phone: true, licence_long_expired: true },
};

/** The bounds. Outside them the setting is refused, not clamped silently. */
export const DETECTOR_BOUNDS = {
  sharedPhoneListings: { min: 2, max: 20 },
  licenceExpiredDays: { min: 30, max: 1095 },
} as const;

export type DetectorProblem =
  | { field: "sharedPhoneListings"; min: number; max: number }
  | { field: "licenceExpiredDays"; min: number; max: number };

export function detectorProblem(rules: DetectorRules): DetectorProblem | null {
  const phone = DETECTOR_BOUNDS.sharedPhoneListings;
  if (
    !Number.isInteger(rules.sharedPhoneListings) ||
    rules.sharedPhoneListings < phone.min ||
    rules.sharedPhoneListings > phone.max
  ) {
    return { field: "sharedPhoneListings", ...phone };
  }
  const licence = DETECTOR_BOUNDS.licenceExpiredDays;
  if (
    !Number.isInteger(rules.licenceExpiredDays) ||
    rules.licenceExpiredDays < licence.min ||
    rules.licenceExpiredDays > licence.max
  ) {
    return { field: "licenceExpiredDays", ...licence };
  }
  return null;
}

/**
 * Read a stored value back, filling anything absent from the defaults.
 *
 * A setting written before a field existed has to keep working: the screen that
 * wrote it could not have known about a field added afterwards, and a sweep
 * that reads `undefined` as zero would file a report about every listing in the
 * directory.
 */
export function parseDetectorRules(value: unknown): DetectorRules {
  const raw = (value ?? {}) as Partial<DetectorRules> & { sweeps?: Partial<DetectorRules["sweeps"]> };
  const rules: DetectorRules = {
    sharedPhoneListings:
      typeof raw.sharedPhoneListings === "number" && Number.isInteger(raw.sharedPhoneListings)
        ? raw.sharedPhoneListings
        : DEFAULT_DETECTOR_RULES.sharedPhoneListings,
    licenceExpiredDays:
      typeof raw.licenceExpiredDays === "number" && Number.isInteger(raw.licenceExpiredDays)
        ? raw.licenceExpiredDays
        : DEFAULT_DETECTOR_RULES.licenceExpiredDays,
    sweeps: {
      shared_phone:
        typeof raw.sweeps?.shared_phone === "boolean"
          ? raw.sweeps.shared_phone
          : DEFAULT_DETECTOR_RULES.sweeps.shared_phone,
      licence_long_expired:
        typeof raw.sweeps?.licence_long_expired === "boolean"
          ? raw.sweeps.licence_long_expired
          : DEFAULT_DETECTOR_RULES.sweeps.licence_long_expired,
    },
  };
  // A stored value outside the bounds is a value the screen cannot have
  // written. Fall back rather than sweep on it.
  return detectorProblem(rules) ? DEFAULT_DETECTOR_RULES : rules;
}
