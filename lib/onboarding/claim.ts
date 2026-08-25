import "server-only";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { openConflictIfContested } from "./conflict";

/**
 * Finding a listing, and saying it is yours. Boards 2a and 2b.
 *
 * Three outcomes from the search, and the middle one is the interesting one:
 *
 *   - No match. Add from scratch.
 *   - A match nobody holds. Claim it.
 *   - A match somebody already holds. **Take the submission anyway.** A
 *     conflicting claim is a thing staff need to see, not a door to close in
 *     front of the second person — who may well be the real owner of a listing
 *     an ex-employee claimed.
 *
 * Criterion 2 is the load-bearing one here: claiming preserves existing reviews
 * and any historical enquiries. It does so by construction — a claim attaches a
 * user to a business that already exists, and touches nothing that hangs off it
 * — and the screen says so, because a supplier's first fear is that claiming
 * resets them to zero.
 */

export interface ClaimCandidate {
  id: string;
  tradeName: string;
  displayName: string;
  slug: string;
  licenceNumber: string;
  licenceAuthority: string;
  areaName: string | null;
  emirate: string | null;
  claimStatus: string;
  /** What claiming would preserve. The number is the reassurance. */
  reviewCount: number;
  enquiryCount: number;
  verificationTier: number;
}

/**
 * Search the imported records by trade name, licence number or phone.
 *
 * All three in one box, because a supplier looking for their own listing does
 * not know which of the three we hold. Licence numbers and phone numbers are
 * matched on their digits alone: an export writes `DED-123456`, a person types
 * `123456`, and a search that misses on the punctuation sends them to "add from
 * scratch" — which creates the duplicate this screen exists to prevent.
 */
export async function findClaimCandidates(query: string, limit = 8): Promise<ClaimCandidate[]> {
  const text = query.trim();
  if (text.length < 2) return [];

  const digits = text.replace(/\D/g, "");

  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { tradeName: { contains: text, mode: "insensitive" } },
        { displayName: { contains: text, mode: "insensitive" } },
        ...(digits.length >= 4
          ? [
              { licenceNumber: { contains: digits } },
              { locations: { some: { phone: { contains: digits } } } },
            ]
          : []),
      ],
    },
    take: limit,
    orderBy: [{ claimStatus: "asc" }, { tradeName: "asc" }],
    select: {
      id: true,
      tradeName: true,
      displayName: true,
      slug: true,
      licenceNumber: true,
      licenceAuthority: true,
      claimStatus: true,
      verificationTier: true,
      locations: { take: 1, select: { emirate: true, area: { select: { name: true } } } },
      _count: { select: { reviews: true, recipients: true } },
    },
  });

  return businesses.map((business) => ({
    id: business.id,
    tradeName: business.tradeName,
    displayName: business.displayName,
    slug: business.slug,
    licenceNumber: business.licenceNumber,
    licenceAuthority: business.licenceAuthority,
    areaName: business.locations[0]?.area.name ?? null,
    emirate: business.locations[0]?.emirate ?? null,
    claimStatus: business.claimStatus,
    reviewCount: business._count.reviews,
    enquiryCount: business._count.recipients,
    verificationTier: business.verificationTier,
  }));
}

export type ClaimRoute = "licence_upload" | "phone_callback";

export type ClaimResult =
  | { ok: true; submissionId: string; contested: boolean }
  | { ok: false; error: string };

export interface SubmitClaimInput {
  businessId: string;
  route: ClaimRoute;
  /** Required on the licence route. */
  documentId?: string;
  /** Required on the phone route, and taken from the licence record. */
  phone?: string;
}

/**
 * Take the claim.
 *
 * Nothing about the business moves. `claimStatus` stays where it is until a
 * person decides, which is handoff 4 — criterion 1 asks that a supplier can
 * reach a dashboard without staff involvement, and they can, because the
 * listing goes live on Free and the dashboard opens regardless. What waits for
 * staff is the *ownership*, and it should.
 */
export async function submitClaim(
  actor: Actor,
  input: SubmitClaimInput,
): Promise<ClaimResult> {
  const business = await prisma.business.findUnique({
    where: { id: input.businessId },
    select: { id: true, claimStatus: true },
  });
  if (!business) return { ok: false, error: "That listing cannot be found." };

  if (input.route === "licence_upload" && !input.documentId) {
    return { ok: false, error: "Upload the trade licence before submitting." };
  }
  if (input.route === "phone_callback" && !input.phone) {
    return { ok: false, error: "Choose the number on the licence record." };
  }

  const mine = await prisma.claimSubmission.findFirst({
    where: { businessId: input.businessId, claimantId: actor.id, decidedAt: null },
    select: { id: true },
  });
  if (mine) {
    return { ok: false, error: "You have already claimed this listing. We are looking at it." };
  }

  const contested = business.claimStatus === "claimed";

  const created = await prisma.claimSubmission.create({
    data: {
      businessId: input.businessId,
      claimantId: actor.id,
      route: input.route,
      documentId: input.documentId ?? null,
      phone: input.phone ?? null,
      contested,
    },
    select: { id: true },
  });

  /*
   * A second undecided claim on one listing is a conflict, and board 4c needs a
   * row to put in the queue. Opening it here rather than leaving staff to
   * notice a pair: `contested` has been a flag since handoff 3 and flagged
   * nothing to anybody.
   */
  if (contested) await openConflictIfContested(input.businessId);

  return { ok: true, submissionId: created.id, contested };
}

/** What the claimant already has waiting on the listing, for the reassurance line. */
export async function whatClaimingPreserves(businessId: string) {
  const [reviews, enquiries, products] = await Promise.all([
    prisma.review.count({ where: { businessId, removedAt: null } }),
    prisma.enquiryRecipient.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId } }),
  ]);
  return { reviews, enquiries, products };
}

export async function claimsFor(businessId: string) {
  return prisma.claimSubmission.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { id: true, route: true, contested: true, status: true, createdAt: true },
  });
}
