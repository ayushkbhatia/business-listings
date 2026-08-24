import "server-only";
import { prisma } from "@/lib/db/client";
import { windowStart } from "@/lib/metrics/response-time";

/**
 * Board 3l — where enquiries come from.
 *
 * Every figure here is counted from rows, over the same ninety-day window the
 * response-time job uses. Nothing is estimated, extrapolated or smoothed, which
 * is why an empty period renders as an empty chart and says so rather than
 * drawing a flat line that looks like data.
 *
 * No buyer identity anywhere. The area comes off the enquiry's delivery area
 * and the category off the products they asked about; there is no column here
 * that could name a person, which is rule 1 expressed as a query shape rather
 * than as discipline.
 */

export interface Slice {
  label: string;
  count: number;
}

export interface AnalyticsView {
  windowDays: number;
  received: number;
  quoted: number;
  accepted: number;
  byArea: Slice[];
  byCategory: Slice[];
}

export async function getAnalytics(businessId: string, now = new Date()): Promise<AnalyticsView> {
  const since = windowStart(now);

  const [recipients, quotes, accepted] = await Promise.all([
    prisma.enquiryRecipient.findMany({
      where: { businessId, createdAt: { gte: since } },
      select: {
        enquiry: {
          select: {
            deliverToArea: true,
            lines: { select: { description: true } },
          },
        },
      },
    }),
    prisma.quote.count({ where: { businessId, createdAt: { gte: since } } }),
    prisma.quote.count({ where: { businessId, status: "accepted", createdAt: { gte: since } } }),
  ]);

  const areas = new Map<string, number>();
  for (const recipient of recipients) {
    const area = recipient.enquiry.deliverToArea?.trim();
    if (!area) continue;
    areas.set(area, (areas.get(area) ?? 0) + 1);
  }

  /*
   * Categories come from the seller's own catalogue, matched against what the
   * buyer wrote — the same surface `lib/quote/match.ts` uses. Reading the
   * enquiry's category directly would be simpler and wrong: an enquiry is sent
   * to a category, and what a seller wants to know is which of *their* lines
   * it was about.
   */
  const products = await prisma.product.findMany({
    where: { businessId },
    select: { category: { select: { name: true } }, name: true },
  });
  const categoryNames = [...new Set(products.map((p) => p.category.name))];

  const categories = new Map<string, number>();
  for (const recipient of recipients) {
    const text = recipient.enquiry.lines.map((l) => l.description.toLowerCase()).join(" ");
    for (const name of categoryNames) {
      const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3);
      if (words.length === 0) continue;
      if (words.some((word) => text.includes(word))) {
        categories.set(name, (categories.get(name) ?? 0) + 1);
      }
    }
  }

  const top = (map: Map<string, number>): Slice[] =>
    [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 8);

  return {
    windowDays: 90,
    received: recipients.length,
    quoted: quotes,
    accepted,
    byArea: top(areas),
    byCategory: top(categories),
  };
}
