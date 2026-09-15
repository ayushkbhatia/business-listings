import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import { formatPhone } from "@/lib/format/phone";
import { leadSource, type LeadSource } from "./lead-form";

/**
 * Board `1d` amendment — the leads a landline reveal records, read back.
 *
 * Two readers and one row shape: the seller's `/dashboard/leads/phone`, scoped
 * to their own listing, and staff's `/admin/leads`, across every listing with a
 * supplier filter. One mapping, so the two screens cannot word the same lead
 * two ways.
 */

export const LEADS_PAGE_SIZE = 50;
export const RECENT_DAYS = 30;
const DAY_MS = 86_400_000;

export interface ContactLeadRow {
  id: string;
  name: string;
  email: string;
  /** `+971 50 123 4567`. */
  mobile: string;
  /** E.164, for the `tel:` href. */
  mobileTel: string;
  source: LeadSource;
  createdAt: Date;
  /** Sessions this lead revealed the number in — the first, and every return. */
  reveals: number;
  lastRevealedAt: Date | null;
  business: { id: string; displayName: string; slug: string };
}

export interface ContactLeadPage {
  rows: ContactLeadRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Leads created in the last thirty days, over the same filter. */
  recent: number;
}

const SELECT = {
  id: true,
  name: true,
  email: true,
  mobile: true,
  sourcePath: true,
  createdAt: true,
  business: { select: { id: true, displayName: true, slug: true } },
  _count: { select: { reveals: true } },
  reveals: { select: { createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
} as const satisfies Prisma.ContactLeadSelect;

type Selected = Prisma.ContactLeadGetPayload<{ select: typeof SELECT }>;

function toRow(lead: Selected): ContactLeadRow {
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    mobile: formatPhone(lead.mobile, { style: "international" }),
    mobileTel: lead.mobile,
    source: leadSource(lead.sourcePath, lead.business.slug),
    createdAt: lead.createdAt,
    reveals: lead._count.reveals,
    lastRevealedAt: lead.reveals[0]?.createdAt ?? null,
    business: lead.business,
  };
}

/** A page number from the query string, never below one. */
export function pageFrom(raw: string | string[] | undefined): number {
  const value = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? Math.min(value, 10_000) : 1;
}

async function leadPage(
  where: Prisma.ContactLeadWhereInput,
  page: number,
  now: Date,
): Promise<ContactLeadPage> {
  const [rows, total, recent] = await Promise.all([
    prisma.contactLead.findMany({
      where,
      select: SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * LEADS_PAGE_SIZE,
      take: LEADS_PAGE_SIZE,
    }),
    prisma.contactLead.count({ where }),
    prisma.contactLead.count({
      where: { AND: [where, { createdAt: { gte: new Date(now.getTime() - RECENT_DAYS * DAY_MS) } }] },
    }),
  ]);
  return { rows: rows.map(toRow), total, page, pageSize: LEADS_PAGE_SIZE, recent };
}

/** One listing's leads, newest first. The caller has already decided the seat may read them. */
export function leadsForBusiness(businessId: string, page = 1, now = new Date()): Promise<ContactLeadPage> {
  return leadPage({ businessId }, page, now);
}

/**
 * Every listing's leads, for staff, narrowed by a supplier's display name or
 * slug the way `/admin/reviews?supplier=` narrows reviews.
 */
export function leadsForStaff(
  { supplier = null, page = 1 }: { supplier?: string | null; page?: number },
  now = new Date(),
): Promise<ContactLeadPage> {
  const term = supplier?.trim();
  const where: Prisma.ContactLeadWhereInput = term
    ? {
        business: {
          OR: [{ displayName: { contains: term, mode: "insensitive" } }, { slug: term.toLowerCase() }],
        },
      }
    : {};
  return leadPage(where, page, now);
}

/**
 * Whether the seller's own listing has a number a buyer could ask for.
 *
 * The empty state says different things either way: no leads yet, or no
 * landline on the storefront for anybody to reveal.
 */
export async function hasPublishedLandline(businessId: string): Promise<boolean> {
  const count = await prisma.location.count({
    where: { businessId, published: true, phone: { not: null } },
  });
  return count > 0;
}
