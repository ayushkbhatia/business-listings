import "server-only";
import { prisma } from "@/lib/db/client";
// `lib/quote/money`'s, which takes the bigint the quote totals are in.
// `lib/billing/proration` has a same-named helper over `number` for the fils
// the billing side counts in; they are different units and both are right.
import { filsToAed, quoteTotalFils } from "@/lib/quote/money";

/**
 * What the last sponsored slot actually did. Board `11e`'s measurement rail.
 *
 * ## Against a comparable month, never against zero
 *
 * `B6`, and it is the sentence that makes this a measurement rather than a
 * sales figure. A placement product that counted every enquiry arriving while a
 * slot ran would claim all of them — including the ones the seller would have
 * had anyway, which on a listing that already ranks well is most of them. So
 * the run is compared against the **same span immediately before it**, and what
 * is reported is the difference.
 *
 * The comparison is imperfect and the screen says so: trade is seasonal, a
 * seller may have done other things that month, and one month either side of a
 * line is a small sample. It is still the honest shape. The alternative is a
 * number that is always flattering and never true.
 *
 * ## Nothing is reported until a slot has actually run
 *
 * No slot, or one still in its first days, produces `null` and the rail says
 * there is nothing to report yet. An impact figure from four days of a slot is
 * noise presented as evidence, and this is the panel a seller decides on.
 */

/** A run has to be at least this long before its difference means anything. */
export const MIN_RUN_DAYS = 14;

export interface PlacementImpact {
  categoryId: string;
  categoryName: string;
  emirate: string | null;
  /** The run being reported, and the span it is compared against. */
  ranFrom: Date;
  ranTo: Date;
  days: number;
  /** Enquiries reaching this seller while the slot ran. */
  enquiries: number;
  /** Enquiries over the same span immediately before it. */
  before: number;
  /** The difference. Negative is reported as it is — see `B6`. */
  extra: number;
  /**
   * What each extra enquiry cost, in whole dirhams, ex-VAT.
   *
   * Null where the run produced no extra enquiries: dividing by nought or by a
   * negative gives a figure that reads as a bargain, and "it produced none" is
   * the answer that sentence should carry.
   */
  costPerEnquiryAed: number | null;
  /** What the slot cost over the run, ex-VAT, pro-rated to the days it ran. */
  spentAed: number;
  /** Quotes accepted out of the run, and what they were worth. */
  won: number;
  wonAed: string;
  /** Still running, so the figures are a partial month. */
  live: boolean;
}

const DAY_MS = 86_400_000;

export async function lastRunImpact(
  businessId: string,
  now: Date = new Date(),
): Promise<PlacementImpact | null> {
  /*
     The most recently started slot with enough of a run behind it. Not the most
     recently *ended*: a slot running now is the one a seller is asking about,
     and one that has been live a month has as much to say as one that finished.
  */
  const slot = await prisma.placementSlot.findFirst({
    where: {
      businessId,
      startsOn: { lte: new Date(now.getTime() - MIN_RUN_DAYS * DAY_MS) },
    },
    orderBy: [{ startsOn: "desc" }, { id: "desc" }],
    select: {
      categoryId: true,
      emirate: true,
      monthlyPriceAed: true,
      startsOn: true,
      endsOn: true,
      category: { select: { name: true } },
    },
  });
  if (!slot) return null;

  const ranTo = slot.endsOn && slot.endsOn < now ? slot.endsOn : now;
  const ranFrom = slot.startsOn;
  const days = Math.max(1, Math.round((ranTo.getTime() - ranFrom.getTime()) / DAY_MS));
  const before = new Date(ranFrom.getTime() - days * DAY_MS);

  const [during, prior, accepted] = await Promise.all([
    prisma.enquiryRecipient.count({
      where: { businessId, createdAt: { gte: ranFrom, lt: ranTo } },
    }),
    prisma.enquiryRecipient.count({
      where: { businessId, createdAt: { gte: before, lt: ranFrom } },
    }),
    /*
       Accepted out of the run, by the date the buyer accepted — not by the date
       the quote was sent. A quote sent on the last day of a run and accepted a
       week later was still won off that run, and the acceptance is the event
       the seller is being asked to value.
    */
    prisma.quote.findMany({
      where: { businessId, status: "accepted", acceptedAt: { gte: ranFrom, lt: ranTo } },
      select: { lines: { select: { unitPrice: true, qty: true } } },
    }),
  ]);

  const extra = during - prior;
  // Pro-rated to the days the slot actually ran, so a half month is half the
  // cost. The board divides a whole month's price by a whole month's extra.
  const spentAed = Math.round((Number(slot.monthlyPriceAed) * days) / 30);

  const wonFils = accepted.reduce(
    (total, quote) =>
      total +
      quoteTotalFils(
        quote.lines.map((line) => ({ unitPrice: String(line.unitPrice), qty: line.qty })),
      ),
    0n,
  );

  return {
    categoryId: slot.categoryId,
    categoryName: slot.category.name,
    emirate: slot.emirate,
    ranFrom,
    ranTo,
    days,
    enquiries: during,
    before: prior,
    extra,
    costPerEnquiryAed: extra > 0 ? Math.round(spentAed / extra) : null,
    spentAed,
    won: accepted.length,
    wonAed: filsToAed(wonFils),
    live: !slot.endsOn || slot.endsOn > now,
  };
}
