/**
 * The tier at which a listing counts as verified.
 *
 * Rung 2 is "trade licence checked against the issuing authority". Rung 1 is
 * "licence number recorded", which is a number somebody typed and nothing else
 * — `components/domain/verification.ts` says so on the badge, and `/verified`
 * filters, the home page counters and the sitemap have all read 2 since
 * handoff 1.
 *
 * The page matrix and the taxonomy screen read 1, which made both of them
 * report a verified share the public surfaces did not agree with: a category
 * could show "publishes" on board 6f and still be held out of the sitemap by
 * the same gate computed with the stricter number. That is criterion 12's
 * failure mode — "sitemap page count matches the admin matrix exactly" — and it
 * was live before handoff 5 went near it.
 *
 * One number, imported. A second definition is how the first one drifted.
 */
export const VERIFIED_TIER = 2;

export function isVerified(tier: number): boolean {
  return tier >= VERIFIED_TIER;
}

/**
 * Where an expired trade licence puts a listing.
 *
 * Rung 1 is "licence number recorded" — a number somebody typed — and that
 * stays true after expiry. Rung 2, the badge threshold, means "checked with the
 * issuing authority and confirmed current", which is the one claim expiry
 * falsifies. The schema said "drops to 2" until the sweep was written; see
 * `lib/verification/expiry-job.ts` for why that was wrong in the dangerous
 * direction.
 *
 * Beside `VERIFIED_TIER` because the two are one decision. The nightly sweep
 * drops to this and `setVerificationTier` refuses to raise above it while the
 * licence is lapsed — a floor only one of them knew about would be a nightly
 * flip-flop between staff and cron.
 */
export const EXPIRED_LICENCE_TIER = 1;

/**
 * The highest rung a listing can actually get to, and the divisor for any score
 * that reads the tier as a fraction.
 *
 * Equal to `VERIFIED_TIER` and that is not a coincidence: rung 3 is trade
 * references, reserved and unbuilt, so the top rung anybody has a path to is
 * the same one the badge threshold sits on. `components/domain/verification.ts`
 * derives the same number from `TIERS` and a unit test asserts the two agree,
 * so funding trade references cannot move one without the other.
 *
 * ## Why this exists rather than a literal
 *
 * Two scores divided the tier by **4** — `lib/search/ranking.ts` and
 * `lib/enquiry/fanout.ts` — which was right when the ladder ran to four and has
 * been wrong since site visits were withdrawn. A verified supplier scored 0.75
 * of the verification component instead of 1, in the ranking that decides
 * search order and in the fan-out that decides which eight suppliers receive an
 * enquiry.
 *
 * It is the same cut as every other correction on board 3e, surviving in the
 * one corpus no scan reads: a divisor. `pnpm check:vocabulary` reads copy, and
 * there is no wording here to find.
 */
export const TOP_ACHIEVABLE_TIER = VERIFIED_TIER;

/**
 * The highest tier the column will accept, which is not the highest anybody can
 * reach.
 *
 * `business_verification_tier_range` is `BETWEEN 0 AND 3`: rung 3 is trade
 * references, drawn on the ladder and unbuilt, so the schema permits it while
 * `TOP_ACHIEVABLE_TIER` says nobody has a path to it. Two different numbers
 * answering two different questions — "what may be stored" and "what may be
 * earned" — and code that wants one has reliably reached for the other.
 *
 * It exists because the ceiling was written out as a literal `4` in two places
 * that outlived the four-rung ladder: `setVerificationTier`, which now imports
 * it, and `parseSearchQuery`, which clamped an inbound `?tier=` to a rung the
 * database had already stopped accepting.
 *
 * Raising this is a migration, not an edit. The CHECK underneath is what makes
 * it true rather than merely asserted.
 */
export const MAX_STORED_TIER = 3;

/**
 * How long a seller waits for a decision on a credential they asked to publish.
 *
 * Board 3e §4 puts "two working days" on the seller's own screen, which makes
 * this number **copy** as much as configuration: the screen states it and
 * `/admin/queue` bands a row late against it, and a screen promising two days
 * over a queue that goes amber at five is the same defect as a badge that
 * outlives its licence. `SLA_DAYS.credential` in `lib/console/overview.ts`
 * reads it from here rather than restating it.
 *
 * Here rather than beside the queue because that module is `server-only` and
 * imports Prisma, and the seller's page needs the number too.
 */
export const CREDENTIAL_REVIEW_DAYS = 2;

/**
 * The tier as a 0..1 signal, for a weighted score.
 *
 * Clamped, because a legacy row stored above the top rung is a row nobody
 * re-checked rather than a stronger claim, and it must not out-score a supplier
 * whose licence we verified this morning.
 */
export function trustScore(tier: number): number {
  return Math.min(1, Math.max(0, tier) / TOP_ACHIEVABLE_TIER);
}

/**
 * True where a trade licence has lapsed.
 *
 * Here rather than beside the sweep that acts on it, because the sweep is
 * `server-only` and imports Prisma, and this is a date comparison two server
 * components need. One definition, because the render and the job disagreeing
 * about what "expired" means is how a badge outlives its licence in exactly one
 * of the two places somebody remembered to check.
 *
 * `now` is a parameter and never `Date.now()` in a body: the purity lint refuses
 * it in render, and it is right to.
 */
export function licenceExpired(licenceExpiry: Date, now: Date): boolean {
  return licenceExpiry.getTime() < now.getTime();
}

/**
 * How far out the licence-expiry sequence starts, and where it turns urgent.
 *
 * Board 3e §5 writes the whole sequence on the screen — 60 days an email and a
 * banner, 14 days the banner stays and the licence row goes amber, day zero the
 * tier drops — which makes these two numbers copy as much as configuration. A
 * screen that promises a warning at sixty days and a job that sends one at
 * thirty is the same class of defect as a badge that outlives its licence.
 *
 * So both the render and `lib/verification/licence-notice-job.ts` read them
 * from here, and the strings that state them interpolate rather than restate.
 */
export const LICENCE_NOTICE_DAYS = 60;
export const LICENCE_URGENT_DAYS = 14;

/**
 * Whole days from `now` to `at`, counted in Dubai calendar days.
 *
 * Not `(at - now) / 86_400_000`. A licence expiring at midnight on 14 April is
 * "1 day" away at 23:00 on the 13th and "0 days" away at 01:00 on the same
 * night in UTC — the seller reads two different numbers either side of a
 * boundary that means nothing to them. Both instants are floored to the Dubai
 * day first, so the count changes when the date on the seller's wall changes.
 *
 * Board 3e's data table: **computed from the expiry date, never stored**. A
 * countdown in a column is a countdown that is wrong every morning.
 */
export function daysUntil(at: Date, now: Date): number {
  return Math.round((dubaiDay(at) - dubaiDay(now)) / 86_400_000);
}

/**
 * The Dubai calendar day an instant falls in, as a UTC midnight.
 *
 * `Intl` rather than a fixed +04:00 offset: the offset is right today and
 * hard-coding it is how a date library acquires a bug it keeps for a decade.
 */
function dubaiDay(at: Date): number {
  const parts = DAY_PARTS.formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"));
}

const DAY_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Dubai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Where a licence sits in the sequence board 3e's rail writes down.
 *
 * Four states and no fifth, because each one has a different consequence on the
 * screen: `current` says nothing, `notice` puts a banner on the dashboard,
 * `urgent` turns the licence row amber and makes Renew the primary action, and
 * `lapsed` is the day the tier has already dropped.
 *
 * `lapsed` agrees with `licenceExpired` by construction — it is the same
 * comparison — so the render and the nightly sweep cannot disagree about which
 * side of the date a listing is on.
 */
export type LicenceStage = "current" | "notice" | "urgent" | "lapsed";

export function licenceStage(licenceExpiry: Date, now: Date): LicenceStage {
  if (licenceExpired(licenceExpiry, now)) return "lapsed";
  const days = daysUntil(licenceExpiry, now);
  if (days <= LICENCE_URGENT_DAYS) return "urgent";
  if (days <= LICENCE_NOTICE_DAYS) return "notice";
  return "current";
}
