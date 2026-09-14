import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import { activityKey } from "@/lib/ingest/classify";
import { parseBands } from "./bands";
import type { Bands, Listing } from "./similarity";

/**
 * What the matcher reads from the database, in one place.
 *
 * The importer, the rescan, the tuning preview and the pair screen must agree
 * on what a listing *is* for matching — which fields, which location, which
 * listings count at all — or a pair found at staging is a different pair on
 * screen.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const BANDS_SETTING_KEY = "dedupe.bands";

/** The tuned lines, or the defaults. Never throws on a malformed row. */
export async function readBands(db: Db = prisma): Promise<Bands> {
  const row = await db.platformSetting.findUnique({
    where: { key: BANDS_SETTING_KEY },
    select: { value: true },
  });
  return parseBands(row?.value);
}

/**
 * Every listing a record can be a duplicate of.
 *
 * Live listings, and claimed ones whatever their state — a claimed listing the
 * owner has not finished publishing is still somebody's company. Not a listing
 * merged into another: the survivor is the one to match. Not an unclaimed
 * listing a rollback or a discard took down: it is not in the directory, and a
 * record pairing with it would be pairing with a ghost.
 *
 * Every location's phone, because a branch's number is how a head office is
 * most often recognised; the first location's area and address, in a fixed
 * order, because "first" has to mean the same thing on every call.
 */
export async function loadMatchListings(db: Db = prisma): Promise<Listing[]> {
  const rows = await db.business.findMany({
    where: {
      mergedIntoId: null,
      // A closed business (board 11i) is off the directory and waiting to be
      // reopened or forgotten; a registry row is not a branch of it.
      closedAt: null,
      OR: [{ publishedAt: { not: null } }, { claimStatus: { not: "unclaimed" } }],
    },
    select: {
      id: true,
      tradeName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceActivity: true,
      locations: {
        // Live locations first, so a branch held for its owner never becomes
        // the area a listing is matched by.
        orderBy: [{ published: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        select: {
          emirate: true,
          areaId: true,
          addressLine: true,
          phone: true,
          area: { select: { name: true } },
        },
      },
    },
  });

  return rows.map((row) => {
    const first = row.locations[0];
    return {
      id: row.id,
      tradeName: row.tradeName,
      licenceNumber: row.licenceNumber,
      licenceAuthority: row.licenceAuthority,
      emirate: first?.emirate ?? null,
      areaId: first?.areaId ?? null,
      areaName: first?.area.name ?? null,
      addressLine: first?.addressLine ?? null,
      phones: row.locations.map((location) => location.phone).filter((phone): phone is string => !!phone),
      activityKey: activityKey(row.licenceActivity) || null,
    };
  });
}

export interface RecordFields {
  id: string;
  tradeName: string | null;
  licenceNumber: string | null;
  /** The effective authority: the record's own, or its run's. */
  authority: string;
  emirate: string | null;
  areaId: string | null;
  areaName: string | null;
  phone: string | null;
  activityKey: string;
}

/** A staged record, in the shape the matcher compares. */
export function recordAsListing(record: RecordFields): Listing {
  return {
    id: `record:${record.id}`,
    tradeName: record.tradeName ?? "",
    licenceNumber: record.licenceNumber ?? "",
    licenceAuthority: record.authority,
    emirate: record.emirate,
    areaId: record.areaId,
    areaName: record.areaName,
    addressLine: record.areaName,
    phones: record.phone ? [record.phone] : [],
    activityKey: record.activityKey || null,
  };
}
