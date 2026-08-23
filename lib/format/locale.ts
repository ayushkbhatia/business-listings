/**
 * Formatting is pinned to the UAE, not to the machine.
 *
 * Vercel runs in UTC. A quote sent at 21:30 UTC on 13 August is 01:30 on the
 * 14th in Dubai, and a directory that shows the buyer a different date from the
 * one on the seller's screen is a directory nobody trusts. Every date and time
 * formatter takes the zone explicitly and defaults to Asia/Dubai; none of them
 * read the ambient TZ.
 */
export const UAE_TIME_ZONE = "Asia/Dubai";

/** Latin digits are forced — en-AE can otherwise resolve to Arabic-Indic. */
export const UAE_LOCALE = "en-AE-u-nu-latn";

/** En dash, U+2013. Ranges use it; hyphens are for compound words. */
export const EN_DASH = "–";

/** Middle dot, U+00B7. Separates paired units and metadata. */
export const MIDDLE_DOT = "·";

/** Bullet operator, U+2022. The masking character for phones and TRNs. */
export const MASK_CHAR = "•";

/** Non-breaking space, U+00A0. Keeps a unit attached to its number. */
export const NBSP = " ";
