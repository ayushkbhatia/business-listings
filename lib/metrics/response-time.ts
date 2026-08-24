/**
 * How fast a supplier actually replies.
 *
 * Rule 3 of the enquiry engine: "Response time is measured. First-reply latency
 * per enquiry, median per business, banded green under 2h / amber under 6h /
 * red beyond. Sellers cannot edit it."
 *
 * Median rather than mean, and that is the whole design. One supplier who
 * ignored an enquiry over Eid drags a mean into the red for a quarter; the
 * median says what usually happens, which is what a buyer is actually asking.
 *
 * Pure. The job fetches, this decides.
 */

/** Bands, in hours. The same numbers ResponseTime draws with. */
export const FAST_MS = 2 * 3_600_000;
export const SLOW_MS = 6 * 3_600_000;

/**
 * Below this, a median is noise.
 *
 * Two enquiries is a coin toss and showing it as a reply time invites a new
 * supplier to game it by answering their first enquiry in ninety seconds. The
 * unmeasured state says "not enough enquiries to measure", which is true and
 * is not a penalty.
 */
export const MIN_SAMPLE = 3;

/**
 * How far back the window reaches.
 *
 * A supplier who was fast last year and slow since should read slow. Ninety
 * days is long enough to gather a sample in a market where a supplier sees a
 * handful of enquiries a month, and short enough that improving shows up in a
 * quarter rather than never.
 */
export const WINDOW_DAYS = 90;

export interface ReplyObservation {
  /** When the enquiry reached the supplier. */
  deliveredAt: Date;
  /** Their first reply — a message or a quote, whichever came first. Null if none. */
  firstReplyAt: Date | null;
}

/**
 * Milliseconds from delivery to first reply, for the replies that happened.
 *
 * An enquiry with no reply contributes nothing rather than counting as
 * infinity. It is a different fact — "they did not answer" — and folding it in
 * here would let one ignored enquiry swamp a median that is meant to describe
 * the replies a buyer will get. Non-response belongs on its own number, which
 * the recipient state already carries.
 */
export function latencies(observations: readonly ReplyObservation[]): number[] {
  const out: number[] = [];
  for (const { deliveredAt, firstReplyAt } of observations) {
    if (!firstReplyAt) continue;
    const ms = firstReplyAt.getTime() - deliveredAt.getTime();
    // A reply stamped before delivery is a clock problem, not a fast supplier.
    if (ms >= 0) out.push(ms);
  }
  return out;
}

/** The middle value; the mean of the two middles on an even count. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/**
 * The median a business should display, or null when there is not enough to
 * say. Null is a real answer here and the UI has a state for it.
 */
export function medianResponseMs(
  observations: readonly ReplyObservation[],
  minSample = MIN_SAMPLE,
): number | null {
  const measured = latencies(observations);
  if (measured.length < minSample) return null;
  return median(measured);
}

export type Band = "fast" | "moderate" | "slow" | "unmeasured";

/** The same banding the component draws, so the two can never disagree. */
export function band(medianMs: number | null): Band {
  if (medianMs === null) return "unmeasured";
  if (medianMs < FAST_MS) return "fast";
  if (medianMs < SLOW_MS) return "moderate";
  return "slow";
}

/** The oldest delivery a window includes. */
export function windowStart(now: Date, days = WINDOW_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
