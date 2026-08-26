import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";

/**
 * Board 12h — field visits, and the report that licenses a tier.
 *
 * This is the piece that makes `lib/auth/subject.ts` mean something.
 * `canSetVerificationTier` lets a field verifier set a tier **only for a visit
 * they recorded**, and until now `Business.visitedByStaffId` was written by the
 * seed and by nothing else — so the subject check was reading a column that no
 * code path filled in.
 *
 * ## Two geotagged photographs
 *
 * Not decoration and not paperwork. Tier 3 is the rung that says somebody from
 * this platform stood in the building, and a visit report with no coordinates
 * is a form somebody could fill in from a desk. The coordinates are checked
 * against the UAE bounding box at the database level — a photograph taken
 * somewhere else is not evidence about this business.
 *
 * Two is a floor rather than a shape: a warehouse with three entrances gets
 * three, which is why the photos are rows rather than columns.
 */

export const MIN_PHOTOS = 2;

export interface VisitPhoto {
  mediaId: string;
  lat: number;
  lng: number;
  takenAt: Date;
}

export type RecordVisitResult =
  | { ok: true; reportId: string }
  | {
      ok: false;
      error: "not_found" | "needs_photos" | "outside_the_uae";
      message: string;
    };

export interface RecordVisitInput {
  actor: Actor;
  businessId: string;
  /** The seller's request, where there was one. A visit can be unsolicited. */
  requestId?: string;
  visitedAt: Date;
  premisesFound: boolean;
  signageMatches: boolean;
  stockPresent: boolean;
  notes?: string;
  photos: readonly VisitPhoto[];
  reason: string;
}

/** The UAE, roughly. Enough to catch a photograph from the wrong country. */
const BOUNDS = { minLat: 22, maxLat: 27, minLng: 51, maxLng: 57 };

export function withinTheUae(photo: { lat: number; lng: number }): boolean {
  return (
    photo.lat >= BOUNDS.minLat &&
    photo.lat <= BOUNDS.maxLat &&
    photo.lng >= BOUNDS.minLng &&
    photo.lng <= BOUNDS.maxLng
  );
}

/**
 * Record a visit.
 *
 * `visit.record` is ops lead or field verifier. It writes
 * `Business.visitedAt` and `visitedByStaffId` — the two columns the tier check
 * reads — and it is the only path that does. There is no form field for either.
 *
 * It does **not** set a tier. Recording what somebody found and deciding what
 * it is worth are two decisions, they are made by two different capabilities,
 * and collapsing them would mean a field verifier who visits a business has
 * thereby tiered it.
 */
export async function recordVisit(
  input: RecordVisitInput,
  now = new Date(),
): Promise<RecordVisitResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, visitedAt: true, visitedByStaffId: true },
  });
  if (!business) {
    return { ok: false, error: "not_found", message: "That business is not in the directory." };
  }

  if (input.photos.length < MIN_PHOTOS) {
    return {
      ok: false,
      error: "needs_photos",
      message: `A visit report needs at least ${MIN_PHOTOS} geotagged photographs. Tier 3 rests on somebody having been there.`,
    };
  }

  const stray = input.photos.find((photo) => !withinTheUae(photo));
  if (stray) {
    return {
      ok: false,
      error: "outside_the_uae",
      message: `One photograph is at ${stray.lat.toFixed(3)}, ${stray.lng.toFixed(3)} — outside the UAE. A photograph from somewhere else is not evidence about this business.`,
    };
  }

  const reportId = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "visit.record",
        subject: `Business:${business.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const report = await tx.siteVisitReport.create({
          data: {
            requestId: input.requestId ?? null,
            businessId: business.id,
            staffId: input.actor.id,
            visitedAt: input.visitedAt,
            premisesFound: input.premisesFound,
            signageMatches: input.signageMatches,
            stockPresent: input.stockPresent,
            notes: input.notes?.trim() || null,
            photos: {
              create: input.photos.map((photo) => ({
                mediaId: photo.mediaId,
                lat: photo.lat,
                lng: photo.lng,
                takenAt: photo.takenAt,
              })),
            },
          },
          select: { id: true },
        });

        /*
         * The two columns the tier check reads. Written here and nowhere else —
         * `canSetVerificationTier` denies a field verifier whose id is not in
         * `visitedByStaffId`, and until this function existed the column was
         * filled in by the seed alone.
         */
        await tx.business.update({
          where: { id: business.id },
          data: { visitedAt: input.visitedAt, visitedByStaffId: input.actor.id },
        });

        if (input.requestId) {
          await tx.siteVisitRequest.update({
            where: { id: input.requestId },
            data: { completedAt: now },
          });
        }

        return {
          result: report.id,
          before: {
            visitedAt: business.visitedAt,
            visitedByStaffId: business.visitedByStaffId,
          },
          after: {
            visitedAt: input.visitedAt,
            visitedByStaffId: input.actor.id,
            premisesFound: input.premisesFound,
            signageMatches: input.signageMatches,
            stockPresent: input.stockPresent,
            photos: input.photos.length,
          },
        };
      },
    ),
  );

  return { ok: true, reportId };
}

/** Visits asked for and not yet made, oldest first. */
export async function openVisitRequests(limit = 100) {
  const rows = await prisma.siteVisitRequest.findMany({
    where: { completedAt: null, cancelledAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: {
      id: true,
      preferredNote: true,
      scheduledFor: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          displayName: true,
          slug: true,
          verificationTier: true,
          locations: {
            take: 1,
            select: { emirate: true, addressLine: true, area: { select: { name: true } } },
          },
        },
      },
    },
  });

  const now = new Date();
  return rows.map((row) => ({
    ...row,
    ageDays: Math.floor((now.getTime() - row.createdAt.getTime()) / 86_400_000),
  }));
}

/** What was found, most recent first. The evidence behind a tier. */
export async function visitHistory(businessId: string) {
  return prisma.siteVisitReport.findMany({
    where: { businessId },
    orderBy: { visitedAt: "desc" },
    select: {
      id: true,
      visitedAt: true,
      premisesFound: true,
      signageMatches: true,
      stockPresent: true,
      notes: true,
      staff: { select: { id: true, fullName: true } },
      photos: { select: { id: true, lat: true, lng: true, takenAt: true } },
    },
  });
}
