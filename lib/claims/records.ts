import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import { licenceDigits } from "@/lib/dedupe/similarity";
import { domainOf, emailDomain, FREE_MAIL_DOMAINS, type Place, type RegisterEntry, type SourceRecord } from "./signals";

/**
 * Board 4c — the two records a conflict is scored against.
 *
 *   - **The source record.** What the listing was minted from: its legal name,
 *     the licence number the register gave it, the address and the numbers on
 *     the public record. `12a` keeps the raw registry row on every record
 *     (`12a` B5), so "Licence import, Jan 2026" can also say *which* licence —
 *     §Flagged 1, the fact that settles most conflicts outright.
 *   - **The register entry for each claim's licence.** What *our* register holds
 *     for the number a claimant stated: a listing that already carries it, or a
 *     row a licence import staged. Never what the claimant typed about
 *     themselves.
 *
 * Both are read, never stored (`B5`).
 */

type Db = PrismaClient | Prisma.TransactionClient;

export interface SourceFacts {
  record: SourceRecord;
  /** `licence_import` with the run's date, or a listing a business added itself. */
  origin: { kind: "licence_import"; importedAt: Date; run: number } | { kind: "self_added" } | { kind: "licence_import_unknown_run" };
  categoryName: string;
}

/** The first location the listing was drawn from: published first, then oldest (`12b`'s rule). */
const HEAD_OFFICE_ORDER = [{ published: "desc" as const }, { createdAt: "asc" as const }, { id: "asc" as const }];

export async function sourceRecordFor(businessId: string, db: Db = prisma): Promise<SourceFacts | null> {
  const business = await db.business.findUnique({
    where: { id: businessId },
    select: {
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      source: true,
      primaryCategory: { select: { name: true } },
      licenceImportRun: { select: { number: true, decidedAt: true, createdAt: true } },
      customDomain: { select: { hostname: true, status: true } },
      locations: {
        orderBy: HEAD_OFFICE_ORDER,
        select: { addressLine: true, emirate: true, phone: true, area: { select: { name: true } } },
      },
      stagedListings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1, select: { raw: true } },
      team: { where: { roles: { has: "seller_owner" } }, orderBy: { id: "asc" }, select: { email: true } },
      claimStatus: true,
    },
  });
  if (!business) return null;

  const head = business.locations[0];
  const address: Place | null = head ? { areaName: head.area?.name ?? null, emirate: head.emirate, addressLine: head.addressLine } : null;

  return {
    record: {
      legalName: business.tradeName,
      licenceNumber: business.licenceNumber,
      authority: business.licenceAuthority,
      address,
      phones: business.locations.map((location) => location.phone).filter((phone): phone is string => !!phone),
      domain: ownDomain(business),
    },
    origin:
      business.source === "self_added"
        ? { kind: "self_added" }
        : business.licenceImportRun
          ? {
              kind: "licence_import",
              importedAt: business.licenceImportRun.decidedAt ?? business.licenceImportRun.createdAt,
              run: business.licenceImportRun.number,
            }
          : { kind: "licence_import_unknown_run" },
    categoryName: business.primaryCategory.name,
  };
}

/**
 * The business's own domain (`B6`), from the first of: a custom domain it has
 * verified, an address or a website in the registry row it was imported from,
 * and — for a listing that already has an owner — that owner's work address.
 * Free mail is never anybody's own domain.
 */
function ownDomain(business: {
  customDomain: { hostname: string; status: string } | null;
  stagedListings: { raw: Prisma.JsonValue }[];
  team: { email: string | null }[];
  claimStatus: string;
}): string | null {
  if (business.customDomain && business.customDomain.status === "verified") {
    return domainOf(business.customDomain.hostname);
  }
  const raw = business.stagedListings[0]?.raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (typeof value !== "string" || !/@|www\.|https?:\/\//i.test(value)) continue;
      const domain = domainOf(value);
      if (domain && !FREE_MAIL_DOMAINS.has(domain)) return domain;
    }
  }
  if (business.claimStatus === "claimed") {
    for (const member of business.team) {
      const domain = emailDomain(member.email);
      if (domain && !FREE_MAIL_DOMAINS.has(domain)) return domain;
    }
  }
  return null;
}

export interface RegisterHit extends RegisterEntry {
  /** A listing already carrying this licence, where one does. */
  businessId: string | null;
  businessSlug: string | null;
  businessName: string | null;
  /** The staged import row, where the licence is only in the register. */
  stagedId: string | null;
  licenceExpiry: Date | null;
  authority: string | null;
}

/**
 * What our register holds for each licence number, keyed by its digits.
 *
 * A listing wins over a staged row: it is the same register row after a person
 * approved it, with its address and numbers kept current since. Matched on the
 * digits and, where the row records one, the authority — exports write
 * `771204` and `ADDED-771204` for the same licence.
 */
export async function registerEntriesFor(
  numbers: readonly { number: string; authority: string }[],
  db: Db = prisma,
): Promise<Map<string, RegisterHit>> {
  const wanted = new Map<string, string>();
  for (const { number, authority } of numbers) {
    const key = licenceDigits(number);
    if (key.length >= 4) wanted.set(key, authority.toUpperCase());
  }
  const found = new Map<string, RegisterHit>();
  if (wanted.size === 0) return found;
  const keys = [...wanted.keys()];

  const [businesses, staged] = await Promise.all([
    db.business.findMany({
      where: { mergedIntoId: null, OR: keys.flatMap((key) => [{ licenceNumber: { endsWith: `-${key}` } }, { licenceNumber: key }]) },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        displayName: true,
        tradeName: true,
        licenceNumber: true,
        licenceAuthority: true,
        licenceExpiry: true,
        locations: {
          orderBy: HEAD_OFFICE_ORDER,
          select: { addressLine: true, emirate: true, phone: true, area: { select: { name: true } } },
        },
      },
    }),
    db.stagedListing.findMany({
      where: {
        disposition: { notIn: ["rejected", "discarded"] },
        OR: keys.map((key) => ({ licenceNumber: { contains: key } })),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        tradeName: true,
        licenceNumber: true,
        licenceAuthority: true,
        licenceExpiry: true,
        emirate: true,
        areaName: true,
        phone: true,
      },
    }),
  ]);

  for (const business of businesses) {
    const key = licenceDigits(business.licenceNumber);
    if (!wanted.has(key) || wanted.get(key) !== business.licenceAuthority || found.has(key)) continue;
    const head = business.locations[0];
    found.set(key, {
      tradeName: business.tradeName,
      areaName: head?.area?.name ?? null,
      emirate: head?.emirate ?? null,
      addressLine: head?.addressLine ?? null,
      phones: business.locations.map((location) => location.phone).filter((phone): phone is string => !!phone),
      businessId: business.id,
      businessSlug: business.slug,
      businessName: business.displayName,
      stagedId: null,
      licenceExpiry: business.licenceExpiry,
      authority: business.licenceAuthority,
    });
  }

  for (const row of staged) {
    const key = licenceDigits(row.licenceNumber ?? "");
    if (!wanted.has(key) || found.has(key)) continue;
    if (row.licenceAuthority && row.licenceAuthority.toUpperCase() !== wanted.get(key)) continue;
    found.set(key, {
      tradeName: row.tradeName,
      areaName: row.areaName,
      emirate: row.emirate,
      addressLine: null,
      phones: row.phone ? [row.phone] : [],
      businessId: null,
      businessSlug: null,
      businessName: null,
      stagedId: row.id,
      licenceExpiry: row.licenceExpiry,
      authority: row.licenceAuthority,
    });
  }

  return found;
}
