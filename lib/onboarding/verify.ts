import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { maskPhone } from "@/lib/format";
import { EXPIRED_LICENCE_TIER, isVerified, licenceExpired } from "@/lib/verification";
import { extractLicence, LOW_CONFIDENCE } from "@/lib/verification/licence/extract";
import { classifyDocument, type OtherDocument } from "@/lib/verification/licence/document";
import { resolveLicenceReader } from "@/lib/verification/licence/reader";
import { signedReadUrl } from "@/lib/storage";

/**
 * Board 2b — everything the gate needs to know, and the one thing it must not do.
 *
 * This is the screen that decides whether a stranger gets to speak for a
 * licensed UAE business, so it is the one place in onboarding where friction is
 * correct. What it must not do is *decide*: submitting queues a review and
 * grants no tier. Criterion 6, and CLAUDE.md's second non-negotiable underneath
 * it — `verificationTier` is writable by an ops lead and the licence-expiry
 * sweep, and by nothing a claimant can reach.
 */

/**
 * The promise the screen makes out loud, in one place.
 *
 * Distinct from `SLA_DAYS.claim` in `lib/console/overview.ts`, and they are not
 * in conflict: this is the *usual* turnaround a supplier is told about, and that
 * is the point at which a queue row counts as late. A screen quoting the late
 * threshold would be promising three days.
 */
export const CLAIM_REVIEW_SLA_HOURS = 4;

/** The five the board names. Not a permission — it routes the review. */
export const CLAIMANT_ROLES = [
  "owner",
  "partner",
  "manager",
  "pro",
  "authorised_signatory",
] as const;
export type ClaimantRoleValue = (typeof CLAIMANT_ROLES)[number];

export function isClaimantRole(value: string): value is ClaimantRoleValue {
  return (CLAIMANT_ROLES as readonly string[]).includes(value);
}

export interface VerifyState {
  businessId: string;
  /**
   * The legal trade name, and the documented exception to the display-name rule.
   *
   * The claimant is proving ownership of a *licensed entity*, and the name in
   * the heading has to match the name printed on the document they are about to
   * upload. A friendly display name here would be actively confusing at the
   * moment of matching — and on an unclaimed record nobody has chosen one
   * anyway. Board 2a's rows and `1d`'s details panel are the only other places.
   */
  tradeName: string;
  licenceAuthority: string;
  slug: string;

  /** Route B's target, masked. Null where the register holds no number. */
  maskedPhone: string | null;
  /** Set only when a number exists; the route is absent otherwise, not disabled. */
  hasPhoneRoute: boolean;

  /**
   * Somebody else is on this listing — it has an owner, or another claim is
   * waiting on it — or this claimant's own claim is one side of a conflict.
   * The submission is still taken; it attaches no seat (board 4c).
   */
  contested: boolean;
  /** This claimant's own undecided claim is one side of an open conflict. */
  inConflict: boolean;
  /**
   * Board 4c Q4: an ops lead asked every side for the tenancy contract for
   * their unit. Null where nothing is being asked of this claimant.
   */
  tenancy: { requestedAt: Date; uploadedAt: Date | null } | null;
  /** This claimant's own undecided submission, if they have already sent one. */
  submittedAt: Date | null;
  submittedRoute: string | null;

  /** The register's own licence, and whether it has lapsed. */
  licenceNumber: string;
  licenceExpiry: Date;
  licenceHasExpired: boolean;
}

/**
 * Everything board 2b renders, bar the review count.
 *
 * The count is deliberately not fetched here. It is the one figure on the screen
 * with a cache — five minutes, per the board's data table — and `unstable_cache`
 * only runs inside a request, so folding it in would make this function
 * unusable from a job, a script or a test. The page composes the two.
 *
 * Returns null where the listing is gone. The caller redirects rather than
 * rendering a gate with nothing left to guard.
 */
const CONFLICT_STATE = { resolvedAt: true, dissolvedAt: true, docsRequestedAt: true, docsReceivedAt: true } as const;

export async function verifyStateFor(
  businessRef: string,
  claimantId: string,
  now: Date = new Date(),
): Promise<VerifyState | null> {
  const business = await prisma.business.findFirst({
    /*
       An id or a slug.

       2a hands over an id, which is what a link built by a screen carries. A
       link built by a *person* carries a slug — the ops CRM's recruitment mail
       on board 12d is written by somebody looking at a listing, and
       `?business=al-bariq-trading-llc` is a URL they can write and check, while
       `?business=cmtmb7ac700di26itwegmpf56` is one they can only paste and hope.
       Both resolve to the same row and neither grants anything.
    */
    where: { OR: [{ id: businessRef }, { slug: businessRef }] },
    select: {
      id: true,
      tradeName: true,
      slug: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      claimStatus: true,
      verificationTier: true,
      locations: {
        where: { phone: { not: null } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { phone: true },
      },
    },
  });
  if (!business) return null;

  const [mine, others] = await Promise.all([
    prisma.claimSubmission.findFirst({
      where: { businessId: business.id, claimantId, decidedAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        createdAt: true,
        route: true,
        tenancyDocument: { select: { createdAt: true } },
        conflict: { select: CONFLICT_STATE },
        // A conflict opened before board 4c names its sides here, not by `conflict_id`.
        conflictsAsA: { where: { resolvedAt: null, dissolvedAt: null }, take: 1, select: CONFLICT_STATE },
        conflictsAsB: { where: { resolvedAt: null, dissolvedAt: null }, take: 1, select: CONFLICT_STATE },
      },
    }),
    // A claim pending is read from the claims, never stored (decided 1 Oct 2026).
    prisma.claimSubmission.count({ where: { businessId: business.id, decidedAt: null, claimantId: { not: claimantId } } }),
  ]);
  const conflict =
    (mine?.conflict && !mine.conflict.resolvedAt && !mine.conflict.dissolvedAt ? mine.conflict : null) ??
    mine?.conflictsAsA[0] ??
    mine?.conflictsAsB[0] ??
    null;

  const phone = business.locations[0]?.phone ?? null;

  return {
    businessId: business.id,
    tradeName: business.tradeName,
    licenceAuthority: business.licenceAuthority,
    slug: business.slug,
    maskedPhone: phone ? maskPhone(phone) : null,
    hasPhoneRoute: phone !== null,
    contested: business.claimStatus === "claimed" || others > 0 || conflict !== null,
    inConflict: conflict !== null,
    tenancy: conflict?.docsRequestedAt
      ? { requestedAt: conflict.docsRequestedAt, uploadedAt: mine?.tenancyDocument?.createdAt ?? null }
      : null,
    submittedAt: mine?.createdAt ?? null,
    submittedRoute: mine?.route ?? null,
    licenceNumber: business.licenceNumber,
    licenceExpiry: business.licenceExpiry,
    licenceHasExpired: licenceExpired(business.licenceExpiry, now),
  };
}

/**
 * Where a claimant with no seat left off.
 *
 * Board 4c: a contested claim attaches no seat, so `actor.businessId` cannot
 * bring its claimant back to their status card on a refresh or from an emailed
 * link without a `?business=`. Their latest undecided claim can.
 */
export async function openClaimBusinessFor(claimantId: string): Promise<string | null> {
  const claim = await prisma.claimSubmission.findFirst({
    where: { claimantId, decidedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { businessId: true },
  });
  return claim?.businessId ?? null;
}

/**
 * True where this route has nothing left to do. Criterion 11.
 *
 * A supplier who reaches this URL on the back button after being verified must
 * not be able to submit again — a second queue row on a settled listing is work
 * for a reviewer that answers a question already answered.
 */
export async function alreadyVerified(businessRef: string): Promise<boolean> {
  const business = await prisma.business.findFirst({
    where: { OR: [{ id: businessRef }, { slug: businessRef }] },
    select: { verificationTier: true },
  });
  return business !== null && isVerified(business.verificationTier);
}

/**
 * The review count, cached five minutes per the board's data table.
 *
 * Cached because it is read on every render of a screen a supplier reloads while
 * hunting for a PDF, and it moves on the timescale of a buyer writing a review.
 *
 * `heldAt` is excluded alongside `removedAt`, and that is not bookkeeping: the
 * card built on this number tells a supplier their reviews "stay where they
 * are", and a review our own team is currently looking at is not one anybody can
 * promise that about.
 *
 * The uncached reader is exported too, the same as `lib/db/queries/home.ts`
 * does: `unstable_cache` only runs inside a request, and a job or a test needs
 * the plain query.
 */
const FIVE_MINUTES_S = 300;

export async function readPublishedReviews(businessId: string): Promise<number> {
  return prisma.review.count({ where: { businessId, removedAt: null, heldAt: null } });
}

export const countPublishedReviews = unstable_cache(
  readPublishedReviews,
  ["onboarding-verify-reviews"],
  { revalidate: FIVE_MINUTES_S },
);

// ─────────────────────────────────────────────────────────────────────────────
// Reading the uploaded document
// ─────────────────────────────────────────────────────────────────────────────

export interface LicenceScan {
  licenceNumber: string | null;
  /** `yyyy-mm-dd`, ready for a date input. */
  licenceExpiry: string | null;
  confidence: number;
  /** True where the fields should render empty with the "type it" helper. */
  lowConfidence: boolean;
  /** Set where the upload looks like a different document. Criterion 8. */
  wrongDocument: OtherDocument | null;
  /**
   * What the classifier read the file as — `trade_licence`, the other document,
   * or `unknown` where nothing could be read. Stored on the document (board 4b)
   * so the reviewer sees the warning the claimant saw.
   */
  detectedKind: "trade_licence" | "unknown" | OtherDocument;
}

/**
 * Read an uploaded licence, and never fail an upload because of it.
 *
 * Every failure path returns an empty scan rather than throwing: board 2b's
 * "OCR failed or low confidence" state is a designed state with its own helper
 * text, and a reader being down should land the claimant in it rather than on an
 * error page holding a file they have already uploaded.
 */
export async function scanLicenceDocument(input: {
  storagePath: string;
  mimeType: string | null;
  authority: string;
}): Promise<LicenceScan> {
  const empty: LicenceScan = {
    licenceNumber: null,
    licenceExpiry: null,
    confidence: 0,
    lowConfidence: true,
    wrongDocument: null,
    detectedKind: "unknown",
  };

  try {
    const url = await signedReadUrl(input.storagePath, 120);
    if (!url) return empty;

    const reader = resolveLicenceReader();
    const read = await reader.read({ url, mimeType: input.mimeType ?? "application/pdf" });
    if (!read.text) return empty;

    const extraction = extractLicence(read.text, input.authority);
    const verdict = classifyDocument(read.text);

    return {
      licenceNumber: extraction.licenceNumber,
      licenceExpiry: extraction.licenceExpiry
        ? extraction.licenceExpiry.toISOString().slice(0, 10)
        : null,
      confidence: extraction.confidence,
      lowConfidence: extraction.confidence < LOW_CONFIDENCE,
      wrongDocument: verdict.kind === "other" ? verdict.document : null,
      detectedKind: verdict.kind === "other" ? verdict.document : verdict.kind,
    };
  } catch (error) {
    console.warn("[verification] could not read an uploaded licence", error);
    return empty;
  }
}

/**
 * Keep what the scan found on the document it read. Board 4b.
 *
 * The claimant was shown "this looks like a DHA licence" on upload and could
 * submit anyway, which is right — a guess about somebody's document is not a
 * refusal. The reviewer is the person the warning was for, and until now it was
 * thrown away before they saw the claim. Written by the server that read the
 * file, never taken from the form.
 */
export async function recordScan(documentId: string, scan: LicenceScan, now = new Date()): Promise<void> {
  await prisma.document.updateMany({
    where: { id: documentId },
    data: { detectedKind: scan.detectedKind, scannedAt: now },
  });
}

/**
 * What an expired licence costs, said once.
 *
 * Board 2b: the claim is accepted, the badge is withheld, and the listing stays
 * claimed-but-unverified until a current licence arrives. *"Do not reject the
 * claim; an expired licence usually means a business under pressure, not a
 * fake."* The tier this holds at is the same floor the nightly sweep uses, so
 * the screen and the job cannot disagree about what expiry means.
 */
export const EXPIRED_LICENCE_HOLDS_AT = EXPIRED_LICENCE_TIER;
