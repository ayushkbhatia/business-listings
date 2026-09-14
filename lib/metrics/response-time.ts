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

/**
 * One enquiry as the reply rate sees it: the median's observation, plus when
 * the enquiry closed.
 */
export interface RateObservation extends ReplyObservation {
  /** When the buyer's window for replies closed. */
  closesAt: Date;
}

export interface ReplyRate {
  /** Replied over counted, 0..1. */
  rate: number;
  /** How many enquiries were counted. */
  sample: number;
}

/**
 * The share of enquiries a supplier answered. Board 4f `B5`.
 *
 * Measured over the same recipients, window and sample floor as the median, so
 * the two numbers an ops lead reads side by side — "62% · 3 h 20" — cannot be
 * about different enquiries. A reply is whatever stamps `firstReplyAt`: a
 * message, a quote, a proposal, or a decline, which is an answer.
 *
 * **An unanswered enquiry counts only once its window has closed.** The same
 * rule `effectiveState` applies before it calls a recipient `no_response`: a
 * supplier with twelve hours left has not failed to reply, they have not
 * replied *yet*, and counting them as a miss would put a busy supplier on the
 * churn list for enquiries they are about to answer. An answered enquiry counts
 * the moment it is answered, whether or not its window is still open.
 *
 * Null below the floor. One reply in two enquiries is not "50%"; it is not
 * enough to say, and the health state reads that as unmeasured, not at risk.
 */
export function replyRate(
  observations: readonly RateObservation[],
  now: Date,
  minSample = MIN_SAMPLE,
): ReplyRate | null {
  let counted = 0;
  let replied = 0;
  for (const observation of observations) {
    if (observation.firstReplyAt) {
      counted += 1;
      replied += 1;
    } else if (observation.closesAt.getTime() <= now.getTime()) {
      counted += 1;
    }
  }
  if (counted < minSample) return null;
  return { rate: replied / counted, sample: counted };
}

export interface MeasuredReplies {
  medianMs: number | null;
  rate: number | null;
  sample: number | null;
}

/**
 * Both measures for one business, from one set of recipients. The job and the
 * seed both call this, so a seeded supplier is measured the way a live one is —
 * a seed that measures differently from production is a seed that claims.
 */
export function measureReplies(observations: readonly RateObservation[], now: Date): MeasuredReplies {
  const rate = replyRate(observations, now);
  return {
    medianMs: medianResponseMs(observations),
    rate: rate?.rate ?? null,
    sample: rate?.sample ?? null,
  };
}

/** The oldest delivery a window includes. */
export function windowStart(now: Date, days = WINDOW_DAYS): Date {
  return new Date(now.getTime() - days * 86_400_000);
}
