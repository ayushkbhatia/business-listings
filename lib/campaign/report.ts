import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Criterion 9's second half — "and attribute it in admin".
 *
 * Enquiries grouped by where they came from. Deliberately a count and a date
 * range and nothing else: this is a marketing report, and a marketing report
 * that lists individual buyers is a profile of people who asked for a quote.
 *
 * Untagged enquiries are a row rather than an omission. A report that showed
 * only the attributed ones would make every campaign look like the whole of
 * demand, which is the way this number is usually misread.
 */

export interface AttributionRow {
  campaign: string | null;
  source: string | null;
  medium: string | null;
  enquiries: number;
  first: Date;
  last: Date;
}

export interface AttributionReport {
  rows: AttributionRow[];
  total: number;
  attributed: number;
}

export async function attributionReport(): Promise<AttributionReport> {
  const [grouped, total] = await Promise.all([
    prisma.enquiry.groupBy({
      by: ["utmCampaign", "utmSource", "utmMedium"],
      _count: { _all: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    }),
    prisma.enquiry.count(),
  ]);

  const rows: AttributionRow[] = grouped
    .map((row) => ({
      campaign: row.utmCampaign,
      source: row.utmSource,
      medium: row.utmMedium,
      enquiries: row._count._all,
      first: row._min.createdAt as Date,
      last: row._max.createdAt as Date,
    }))
    .sort((a, b) => b.enquiries - a.enquiries);

  const attributed = rows
    .filter((row) => row.campaign !== null || row.source !== null || row.medium !== null)
    .reduce((sum, row) => sum + row.enquiries, 0);

  return { rows, total, attributed };
}
