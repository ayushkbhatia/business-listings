/**
 * When a guide's external facts were last checked, and whether that is overdue.
 *
 * Pure, and that is the point of the file. Board 6f's admin queue and board
 * 10b's public index have to answer this the same way: `6d`'s rule is that an
 * overdue article **stays published**, so the reader-facing half of it is the
 * index saying so out loud. An admin queue that called an article overdue while
 * the page it links to presented as current would be the version of that rule
 * that is not defensible.
 *
 * No `server-only` marker and no database: the index renders this per row on a
 * public page, and `overdueGuides` calls it on the same numbers.
 */

export interface FreshnessInput {
  /** Never moves. The baseline for an article nobody has re-checked. */
  publishedAt: Date | null;
  /** Moves when an editor re-checks the external facts. */
  regulatoryCheckedAt: Date | null;
  /**
   * Months between re-checks, or null.
   *
   * Null is the whole reason this is a function rather than a comparison.
   * Board 10b criterion 6: *"a guide with no cadence is never overdue rather
   * than always overdue"* — an article about how to write a good RFQ makes no
   * claim about the world, so there is nothing to go stale.
   */
  reviewCadenceMonths: number | null;
}

export interface Freshness {
  /** What the reader sees: the date a person last checked the facts. */
  checkedAt: Date | null;
  /** When the next check falls due, or null where none ever does. */
  dueAt: Date | null;
  overdue: boolean;
}

export function freshness(input: FreshnessInput, now = new Date()): Freshness {
  const checkedAt = input.regulatoryCheckedAt;
  const cadence = input.reviewCadenceMonths;

  if (cadence === null || cadence <= 0) return { checkedAt, dueAt: null, overdue: false };

  /*
     An article never re-checked is measured from publication.

     On the day it went out its facts had just been read, which is the honest
     baseline — and treating "never checked" as infinitely overdue would put
     every new article in the queue the moment it published.
  */
  const from = checkedAt ?? input.publishedAt;
  if (from === null) return { checkedAt, dueAt: null, overdue: false };

  const dueAt = addMonths(from, cadence);
  return { checkedAt, dueAt, overdue: dueAt <= now };
}

/**
 * Months, not 30-day blocks, and clamped to the end of a shorter month.
 *
 * `setMonth` rolls 31 August plus six months into 3 March, because February has
 * no 31st — so an article checked on the 31st would report a due date three
 * days into the following month and read as one day less overdue than it is.
 */
function addMonths(from: Date, months: number): Date {
  const day = from.getUTCDate();
  const target = new Date(from);
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
