/**
 * How long claiming takes with the trade licence to hand.
 *
 * Board 2b: "onboarding takes six minutes with the licence to hand and a
 * fortnight without it." Two screens make that promise — 2a's add-new card and
 * 10g's claim card — and the 10g render drew "about four minutes" until its
 * export corrected it. The cause was the number typed as a literal on each
 * board, so it is one value here and both strings take it as `{minutes}`, the
 * same way `CLAIM_REVIEW_SLA_HOURS` feeds 2b's "within 4 working hours".
 *
 * Its own file rather than beside that constant: `lib/onboarding/verify.ts` is
 * `server-only` and imports the database client, and a number should not.
 */
export const CLAIM_MINUTES_WITH_LICENCE = 6;
