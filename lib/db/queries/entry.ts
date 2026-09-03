import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * The measured half of the two entry surfaces.
 *
 * Board 1a's rule, applied to a page whose whole job is persuasion: "a stale
 * count is worse than no count, because the whole proposition is that we know
 * what is actually out there". So every number here is a query. None of them is
 * a constant, a rounded-up figure, or a range.
 *
 * The two audiences need opposite evidence. A buyer is deciding whether the
 * directory has the supplier they need, so the numbers are supply — how many
 * listings, how many with a checked trade licence, how many trades and
 * emirates. A supplier is deciding whether buyers are actually asking, so the
 * numbers are demand — enquiries sent in the last thirty days and how many
 * separate buyers sent them.
 *
 * A zero is never rendered. The caller drops any fact that came back zero,
 * which is the home page's rule for its own sections: on a young directory
 * "0 enquiries in the last 30 days" is worse evidence than saying nothing, and
 * padding it to look better is the one thing a page about verification cannot
 * do.
 */

export const ENTRY_CACHE_TAG = "entry-facts";

const HOUR_S = 3600;
const DEMAND_WINDOW_DAYS = 30;

/** Mirrors `PUBLIC_BUSINESS` in the search queries: live and not suspended. */
const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

export interface BuyerFacts {
  listings: number;
  verified: number;
  sectors: number;
  subcategories: number;
  emirates: number;
}

export interface SupplierFacts {
  enquiries: number;
  buyers: number;
  listings: number;
  verified: number;
  windowDays: number;
}

async function readBuyerFacts(): Promise<BuyerFacts> {
  const [listings, verified, sectors, subcategories, emirates] = await Promise.all([
    prisma.business.count({ where: PUBLIC_BUSINESS }),
    prisma.business.count({
      where: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
    }),
    prisma.category.count({ where: { parentId: null } }),
    prisma.category.count({ where: { parentId: { not: null } } }),
    prisma.location.groupBy({
      by: ["emirate"],
      where: { published: true, business: PUBLIC_BUSINESS },
    }),
  ]);

  return { listings, verified, sectors, subcategories, emirates: emirates.length };
}

async function readSupplierFacts(): Promise<SupplierFacts> {
  const since = new Date(Date.now() - DEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [enquiries, buyers, listings, verified] = await Promise.all([
    prisma.enquiry.count({ where: { createdAt: { gte: since } } }),
    /*
       Distinct buyers, not enquiries. Ten enquiries from one buyer is one
       buyer's worth of demand, and a supplier deciding whether to pay us is
       entitled to know which of the two this is.
    */
    prisma.enquiry
      .groupBy({ by: ["buyerId"], where: { createdAt: { gte: since } } })
      .then((rows) => rows.length),
    prisma.business.count({ where: PUBLIC_BUSINESS }),
    prisma.business.count({
      where: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
    }),
  ]);

  return { enquiries, buyers, listings, verified, windowDays: DEMAND_WINDOW_DAYS };
}

export const getBuyerFacts = unstable_cache(readBuyerFacts, ["entry-buyer-facts"], {
  revalidate: HOUR_S,
  tags: [ENTRY_CACHE_TAG],
});

export const getSupplierFacts = unstable_cache(readSupplierFacts, ["entry-supplier-facts"], {
  revalidate: HOUR_S,
  tags: [ENTRY_CACHE_TAG],
});
