import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Board 1i criterion 14: an enquiry that closes with no quotes is a supply
 * signal, and it is written down.
 *
 * A buyer who described a real requirement, reached up to eight suppliers, and
 * got nothing back has told the platform something no search log can: not that
 * a phrase found no results, but that a specified job found no seller willing to
 * price it. That is the strongest input there is to deciding which trade to
 * recruit next.
 *
 * It lands in `ZeroResultQuery`, which board 12d's gap report already reads —
 * one table for "we could not answer this", with `tab` saying which kind of
 * failure it was. Board 1h writes `rfq` there for a fan-out that matched
 * nobody; this writes `zero_quote` for one that matched somebody and still came
 * back empty. Those are different problems: the first is coverage, the second is
 * willingness.
 */

export const ZERO_QUOTE_TAB = "zero_quote";

export async function recordZeroQuote(enquiryId: string): Promise<{ written: boolean }> {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      id: true,
      ref: true,
      requirement: true,
      closesAt: true,
      lines: { select: { description: true }, orderBy: { sortOrder: "asc" } },
      recipients: {
        select: { businessId: true, business: { select: { primaryCategoryId: true } } },
      },
      quotes: { where: { status: { not: "draft" } }, select: { id: true } },
    },
  });
  if (!enquiry) return { written: false };

  // Only once the window has actually closed, and only with nothing back.
  if (enquiry.quotes.length > 0) return { written: false };
  if (enquiry.recipients.length === 0) return { written: false };

  /*
     Idempotent by reference. The daily job may see the same closed enquiry more
     than once, and a gap report that counted one silence five times would
     recommend recruiting for a trade on the strength of a rerun.
  */
  const already = await prisma.zeroResultQuery.findFirst({
    where: { tab: ZERO_QUOTE_TAB, query: { startsWith: enquiry.ref } },
    select: { id: true },
  });
  if (already) return { written: false };

  /*
     The category, or the row is written and never read.

     `lib/crm/call-list.ts` groups these by `categoryId` and skips the nulls, so
     a zero-quote row with no category would land in the table and never reach
     the call list it exists to feed. `Enquiry` does not store its own category
     — the fan-out matched on one but only the recipients kept it — so it is
     taken from the suppliers who were actually asked. That is the trade the
     demand went to, which is the trade with nobody willing to price it.
  */
  const categoryId = enquiry.recipients[0]?.business.primaryCategoryId ?? null;

  await prisma.zeroResultQuery.create({
    data: {
      ...(categoryId ? { categoryId } : {}),
      /*
         The reference first, so the row is traceable back to the enquiry, then
         the lines — which are the things nobody would price, and what a
         recruiter actually needs to read.
      */
      query: `${enquiry.ref} · ${enquiry.lines.map((l) => l.description).join(" · ")}`.slice(0, 500),
      tab: ZERO_QUOTE_TAB,
      filters: {
        requirement: enquiry.requirement.slice(0, 2000),
        recipients: enquiry.recipients.length,
      },
    },
  });

  return { written: true };
}

/**
 * Every enquiry that has just closed with nothing back.
 *
 * Run from the daily job rather than at read time: the tracking page is opened
 * by a buyer, and a page render is the wrong place to write a business record —
 * an enquiry nobody revisits would never be counted, and one somebody refreshes
 * would be counted whenever they looked.
 */
export async function sweepZeroQuoteEnquiries(now = new Date()): Promise<{
  closed: number;
  written: number;
}> {
  const closed = await prisma.enquiry.findMany({
    where: {
      closesAt: { lt: now },
      contactReleasedToBusinessId: null,
      quotes: { none: { status: { not: "draft" } } },
      recipients: { some: {} },
    },
    select: { id: true },
    take: 200,
  });

  let written = 0;
  for (const enquiry of closed) {
    const result = await recordZeroQuote(enquiry.id);
    if (result.written) written += 1;
  }

  return { closed: closed.length, written };
}
