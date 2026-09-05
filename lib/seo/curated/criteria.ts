/**
 * Board 6b — what a list may be chosen on.
 *
 * Pure, and deliberately so: board 6f's editor is a client component and the
 * audit service is `server-only`, and both need these. The same split
 * `ranking.ts` and `settings.ts` already make.
 *
 * ## Nothing a seller buys appears in this file
 *
 * Not `planId`, not `rankingMultiplier`, not `PlacementSlot`, not
 * `ListingBoost`. Spec §5 requirement 3 is explicit that plan tier must be
 * **absent** from selection rather than weighted to zero, and
 * `lib/seo/curated/no-placement.test.ts` asserts it by reading this source
 * rather than by trusting the comment.
 *
 * A weight of zero is a decision somebody can revisit in a config screen. An
 * absent field is not.
 */

/** Median first reply, in milliseconds. Four hours, per board 6b. */
export const MAX_REPLY_MS = 4 * 3_600_000;

/** Reviews from real enquiries. Not testimonials, not imports. */
export const MIN_REVIEWS = 15;

/**
 * Below this a list does not publish.
 *
 * §Selection: *"If only five companies clear the criteria, the list is a list
 * of five and the H1 says five. If fewer than a floor — recommend 5 — the list
 * does not publish. Never pad to reach a round number, and never lower a
 * criterion for one list to fill it out."*
 */
export const MIN_MEMBERS = 5;

/** How long a snapshot may stand before the list unpublishes. Q2: quarterly. */
export const REAUDIT_DAYS = 90;

export type CriterionKey = "verified" | "reply" | "reviews" | "placement";

export interface Criterion {
  key: CriterionKey;
  /** Required to appear at all, or the one thing that never counts. */
  kind: "required" | "never";
}

/**
 * The criteria a new list is created with.
 *
 * A **default**, not the policy: §2 says the method panel renders from the
 * list's own record, so two lists with different criteria render different
 * panels. This is what a list starts with, stored on the row, and what the
 * audit service validates that list against thereafter.
 *
 * `placement` is in the list precisely because it is a "never" — a rule about
 * what does not count is the one a reader most wants stated, and the one every
 * competitor omits.
 *
 * There is no `weighted` kind any more. The one weighted criterion was the site
 * visit, withdrawn on 5 Sep, and nothing replaced it: inventing a new weight to
 * fill the slot would change who appears at the top of a published list for a
 * reason no reader was told about.
 */
export const DEFAULT_CRITERIA: readonly Criterion[] = [
  { key: "verified", kind: "required" },
  { key: "reply", kind: "required" },
  { key: "reviews", kind: "required" },
  { key: "placement", kind: "never" },
];

const KEYS = new Set<string>(["verified", "reply", "reviews", "placement"]);

/**
 * The criteria stored on a list, or the defaults.
 *
 * Anything unrecognised is dropped rather than rendered — the same
 * drop-the-unknown discipline the storefront blocks use. A criterion the code
 * cannot enforce must not appear on a page whose whole value is that its stated
 * method is true.
 */
export function readCriteria(value: unknown): Criterion[] {
  if (!Array.isArray(value)) return [...DEFAULT_CRITERIA];
  const rows = value.filter((entry): entry is Criterion => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as Partial<Criterion>;
    return (
      typeof row.key === "string" &&
      KEYS.has(row.key) &&
      (row.kind === "required" || row.kind === "never")
    );
  });
  return rows.length > 0 ? rows : [...DEFAULT_CRITERIA];
}

/** The measurements a candidate is judged on. Every one is staff- or buyer-written. */
export interface CandidateMetrics {
  verificationTier: number;
  /** Null is not "fast" — non-negotiable 6, and why the column is nullable. */
  responseTimeMedianMs: number | null;
  reviewCount: number;
}

export type CriterionFailure = { key: CriterionKey; have: string; need: string };

/**
 * Which required criteria a candidate fails, now.
 *
 * Used at **audit** time, never at render time. That is the whole of §3: the
 * page publishes a snapshot, and this is what the snapshot was checked against
 * when a person took it.
 */
export function failures(
  metrics: CandidateMetrics,
  criteria: readonly Criterion[],
  verifiedTier: number,
): CriterionFailure[] {
  const out: CriterionFailure[] = [];
  for (const criterion of criteria) {
    if (criterion.kind !== "required") continue;
    switch (criterion.key) {
      case "verified":
        if (metrics.verificationTier < verifiedTier) {
          out.push({
            key: "verified",
            have: `tier ${metrics.verificationTier}`,
            need: `tier ${verifiedTier}`,
          });
        }
        break;
      case "reply":
        if (metrics.responseTimeMedianMs === null) {
          out.push({ key: "reply", have: "never measured", need: "under 4 h" });
        } else if (metrics.responseTimeMedianMs > MAX_REPLY_MS) {
          out.push({
            key: "reply",
            have: `${Math.round(metrics.responseTimeMedianMs / 3_600_000)} h`,
            need: "under 4 h",
          });
        }
        break;
      case "reviews":
        if (metrics.reviewCount < MIN_REVIEWS) {
          out.push({
            key: "reviews",
            have: `${metrics.reviewCount}`,
            need: `${MIN_REVIEWS}`,
          });
        }
        break;
      case "placement":
        // Never a thing a candidate can fail: it is a rule about us. It is on
        // the panel because a reader wants it stated, and it is enforced by
        // `no-placement.test.ts` reading this directory's source.
        break;
    }
  }
  return out;
}
