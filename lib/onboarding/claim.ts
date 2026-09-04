import "server-only";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { sameLicenceNumber } from "@/lib/verification/licence/number";
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
 *
 * ## What an unclaimed record is allowed to show
 *
 * The legal trade name, and only here. An unclaimed record has no display name
 * that anybody chose: nobody has claimed it, so `displayName` on those rows is
 * a derivation of the licence name and not a decision. More than that, the
 * legal name is what makes this screen work — three near-identical results are
 * told apart by their suffix, their authority prefix and their area, and a
 * supplier scanning the list is looking for *their* licence. Board 2a and the
 * details panel on `1d` are the only two surfaces a legal name belongs on.
 *
 * ## What a result never carries
 *
 * The incumbent claimant. A supplier who finds their business already claimed
 * is offered the dispute route, never the other party's name — that is a
 * privacy leak and an invitation to settle it off-platform. `ClaimCandidate`
 * has no field for it, which is the version of that rule a screen cannot break
 * by accident.
 */

export interface ClaimCandidate {
  id: string;
  tradeName: string;
  displayName: string;
  slug: string;
  licenceNumber: string;
  licenceAuthority: string;
  categoryName: string | null;
  categoryCode: string | null;
  areaName: string | null;
  emirate: string | null;
  claimStatus: string;
  /** What claiming would preserve. The number is the reassurance. */
  reviewCount: number;
  enquiryCount: number;
  verificationTier: number;
}

/**
 * How the query found them, which decides what the screen renders.
 *
 * `exact_licence` is a single result under an `EXACT LICENCE MATCH` line: a
 * licence number is unambiguous, so offering alternatives beside it would
 * invite somebody to pick the wrong one.
 */
export type ClaimMatchKind = "exact_licence" | "similar" | "none";

export interface ClaimMatches {
  kind: ClaimMatchKind;
  results: ClaimCandidate[];
  /** Everything found, before the six-row fold. The screen expands in place. */
  total: number;
}

/** How many rows the results card shows before "12 more matches". */
export const VISIBLE_MATCHES = 6;

/** Below this a query means nothing and the database is not asked. */
const MIN_QUERY = 2;

/** Shorter than this and a run of digits is not a licence or a phone number. */
const MIN_DIGITS = 4;

/** The ceiling on one search. Six are shown; the rest expand in place. */
const MAX_MATCHES = 30;

const CANDIDATE_SELECT = {
  id: true,
  tradeName: true,
  displayName: true,
  slug: true,
  licenceNumber: true,
  licenceAuthority: true,
  claimStatus: true,
  verificationTier: true,
  primaryCategory: { select: { name: true, code: true } },
  locations: {
    orderBy: { createdAt: "asc" },
    take: 1,
    select: { emirate: true, area: { select: { name: true } } },
  },
  _count: { select: { reviews: true, recipients: true } },
} as const;

type CandidateRow = {
  id: string;
  tradeName: string;
  displayName: string;
  slug: string;
  licenceNumber: string;
  licenceAuthority: string;
  claimStatus: string;
  verificationTier: number;
  primaryCategory: { name: string; code: string } | null;
  locations: { emirate: string; area: { name: string } | null }[];
  _count: { reviews: number; recipients: number };
};

function toCandidate(business: CandidateRow): ClaimCandidate {
  return {
    id: business.id,
    tradeName: business.tradeName,
    displayName: business.displayName,
    slug: business.slug,
    licenceNumber: business.licenceNumber,
    licenceAuthority: business.licenceAuthority,
    categoryName: business.primaryCategory?.name ?? null,
    categoryCode: business.primaryCategory?.code ?? null,
    areaName: business.locations[0]?.area?.name ?? null,
    emirate: business.locations[0]?.emirate ?? null,
    claimStatus: business.claimStatus,
    reviewCount: business._count.reviews,
    enquiryCount: business._count.recipients,
    verificationTier: business.verificationTier,
  };
}

/**
 * Search the imported records by trade name, licence number or phone.
 *
 * All three in one box, because a supplier looking for their own listing does
 * not know which of the three we hold — and because the three belong to three
 * different people in the same company. The PRO holds the licence number, the
 * owner remembers the trade name, and the office manager knows the landline.
 *
 * Licence and phone numbers are matched on their digits alone: an export writes
 * `DED-441908`, a person types `441908`, and a search that misses on the
 * punctuation sends them to "add from scratch" — which creates the duplicate
 * this screen exists to prevent.
 *
 * Ranking is trigram similarity against the trade name, then the display name,
 * with a number match ahead of both. `similarity()` and the `%` operator run on
 * the GIN indexes added in `20260824100000_trigram_search`; the `ILIKE` arm
 * catches the substring the similarity threshold rejects — "Gulf Cool" against
 * "Gulf Cool Technical Services LLC" scores below 0.3 and is obviously the row
 * somebody meant.
 */
export async function findClaimMatches(
  query: string,
  limit = MAX_MATCHES,
): Promise<ClaimMatches> {
  const text = query.trim();
  if (text.length < MIN_QUERY) return { kind: "none", results: [], total: 0 };

  const digits = text.replace(/\D/g, "");

  /*
   * A licence number first, and on its own.
   *
   * The one case where a single result is returned: a licence number
   * identifies exactly one record, so a list of alternatives beside it would
   * only invite somebody to pick a wrong one. Matched on digits so the
   * authority prefix is optional, and anchored at the end so `441908` finds
   * `DED-441908` without also finding `DED-9441908`.
   *
   * Every match is fetched rather than the first, and that is the point.
   * `licence_number` carries no unique constraint — it cannot, because the
   * licence importer stages near-duplicates on purpose and `MergeCandidate` is
   * the queue that settles them — so a `findFirst` here would pick one of a
   * duplicate pair arbitrarily and present it as the answer. Where the number
   * matches more than one record it is not unambiguous, so the claim to be an
   * exact match is withdrawn and all of them are listed. A supplier choosing
   * between two rows they can read is better served than one handed a coin
   * toss dressed as certainty, and "nothing matched" would be the worst of the
   * three answers when we plainly hold the licence they typed.
   */
  if (digits.length >= MIN_DIGITS) {
    const onLicence = await prisma.business.findMany({
      where: {
        mergedIntoId: null,
        OR: [
          { licenceNumber: text },
          { licenceNumber: { endsWith: `-${digits}` } },
          { licenceNumber: digits },
        ],
      },
      orderBy: { tradeName: "asc" },
      take: limit,
      select: CANDIDATE_SELECT,
    });

    if (onLicence.length === 1) {
      return { kind: "exact_licence", results: [toCandidate(onLicence[0]!)], total: 1 };
    }
    if (onLicence.length > 1) {
      const results = onLicence.map(toCandidate);
      return { kind: "similar", results, total: results.length };
    }
  }

  const ranked = await rankByName(text, digits, limit);
  if (ranked.length === 0) return { kind: "none", results: [], total: 0 };

  return { kind: "similar", results: ranked, total: ranked.length };
}

/**
 * Rank by name, in three tiers.
 *
 * Two queries rather than one join: the ordering is computed in SQL because the
 * ranking lives there, and the rows are then read through Prisma so the counts
 * and the relations come back typed. Ordering by ids in JavaScript afterwards
 * is what keeps the second query a plain `findMany`.
 *
 * The tiers, and why there are three rather than one:
 *
 *   1. **A number the searcher typed.** Somebody who reaches for the landline
 *      is identifying a company, not describing one.
 *   2. **The typed text, verbatim, inside the name.** This tier exists because
 *      trigram similarity alone gets this exact screen wrong. `similarity()`
 *      divides by the longer string's trigram count, so a short name scores
 *      higher than a long one containing the query outright: searching
 *      `Al Wadi` scored `Al Waha FZE` above `Al Wadi Technical Services LLC`,
 *      and with more than one near-namesake in the register the record somebody
 *      is actually looking for falls off the first page entirely. UAE trade
 *      names are long and the distinctive part is short, which is precisely the
 *      shape that breaks. A supplier who types their own name and does not see
 *      it goes to "add from scratch", which creates the duplicate this screen
 *      exists to prevent.
 *   3. **Trigram similarity**, for the misspellings and the transliterations
 *      the substring cannot reach — which is what it is good at, and all it is
 *      being asked to do now.
 */
async function rankByName(
  text: string,
  digits: string,
  limit: number,
): Promise<ClaimCandidate[]> {
  const pattern = `%${text}%`;
  const phone = digits.length >= MIN_DIGITS ? digits : null;

  const ordered = await prisma.$queryRaw<{ id: string }[]>`
    SELECT b."id"
    FROM "business" b
    WHERE b."merged_into_id" IS NULL
      AND (
        b."trade_name" % ${text}
        OR b."display_name" % ${text}
        OR b."trade_name" ILIKE ${pattern}
        OR b."display_name" ILIKE ${pattern}
        OR (
          ${phone}::text IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM "location" l
            WHERE l."business_id" = b."id"
              AND regexp_replace(COALESCE(l."phone", ''), '[^0-9]', '', 'g') LIKE '%' || ${phone}::text
          )
        )
      )
    ORDER BY
      -- 1. A number they typed.
      (
        ${phone}::text IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM "location" l
          WHERE l."business_id" = b."id"
            AND regexp_replace(COALESCE(l."phone", ''), '[^0-9]', '', 'g') LIKE '%' || ${phone}::text
        )
      ) DESC,
      -- 2. The name contains what they typed, exactly.
      (b."trade_name" ILIKE ${pattern} OR b."display_name" ILIKE ${pattern}) DESC,
      -- 3. Similarity, for the spellings a substring cannot reach.
      GREATEST(
        similarity(b."trade_name", ${text}),
        similarity(b."display_name", ${text})
      ) DESC,
      b."trade_name" ASC
    LIMIT ${limit}::int
  `;

  if (ordered.length === 0) return [];

  const ids = ordered.map((row) => row.id);
  const rows = await prisma.business.findMany({
    where: { id: { in: ids } },
    select: CANDIDATE_SELECT,
  });

  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids
    .map((id) => byId.get(id))
    .filter((row): row is (typeof rows)[number] => row !== undefined)
    .map(toCandidate);
}

/**
 * The old shape, kept for callers that only want the list.
 *
 * `findClaimMatches` is the one board 2a renders, because the screen changes
 * shape depending on *how* the match was found.
 */
export async function findClaimCandidates(query: string, limit = 8): Promise<ClaimCandidate[]> {
  return (await findClaimMatches(query, limit)).results;
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

  // ── Board 2b's evidence ───────────────────────────────────────────────────
  /** As printed on the licence or the power of attorney, not the account name. */
  claimantName?: string;
  claimantRole?: ClaimantRole;
  /** What the claimant submitted, after any correction to what OCR read. */
  statedLicenceNumber?: string;
  statedLicenceExpiry?: Date;
  /** What OCR read before the claimant touched it, so a correction is visible. */
  ocrLicenceNumber?: string;
  ocrLicenceExpiry?: Date;
  ocrConfidence?: number;
}

/** The five board 2b names. A review path, never a permission. */
export type ClaimantRole = "owner" | "partner" | "manager" | "pro" | "authorised_signatory";

/**
 * Did the claimant correct what the reader produced? Criterion 3.
 *
 * Derived from the pair rather than stored as a boolean, because a flag says
 * somebody changed something and the pair says from what, to what — which is
 * what a reviewer opening the row actually needs. Nothing read means nothing
 * corrected: an empty extraction that the claimant then filled in by hand is the
 * expected path on every deployment with no OCR provider, and calling that a
 * correction would flag every claim.
 *
 * The number is compared as a licence number, not as a string, so a claimant who
 * typed `618402` over a read `DED-618402` has corrected nothing.
 */
export function claimCorrections(
  submission: {
    statedLicenceNumber: string | null;
    statedLicenceExpiry: Date | null;
    ocrLicenceNumber: string | null;
    ocrLicenceExpiry: Date | null;
  },
  authority: string,
): { number: boolean; expiry: boolean; any: boolean } {
  const number =
    submission.ocrLicenceNumber !== null &&
    submission.statedLicenceNumber !== null &&
    !sameLicenceNumber(submission.ocrLicenceNumber, submission.statedLicenceNumber, authority);

  const expiry =
    submission.ocrLicenceExpiry !== null &&
    submission.statedLicenceExpiry !== null &&
    submission.ocrLicenceExpiry.getTime() !== submission.statedLicenceExpiry.getTime();

  return { number, expiry, any: number || expiry };
}

/**
 * Take the claim.
 *
 * Nothing about the business moves. `claimStatus` stays where it is until a
 * person decides, which is handoff 4 — criterion 1 asks that a supplier can
 * reach a dashboard without staff involvement, and they can, because the
 * listing goes live on Free and the dashboard opens regardless. What waits for
 * staff is the *ownership*, and it should.
 *
 * `verificationTier` does not move either, and that is board 2a's own
 * criterion 7 as much as it is CLAUDE.md's second non-negotiable. Claiming
 * inherits history, not trust: the reviews, the enquiries and the slug carry
 * over intact, and the tier is still a decision a person makes with the licence
 * in front of them. The screen says exactly that rather than letting a supplier
 * discover it on the storefront.
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
      claimantName: input.claimantName?.trim() || null,
      claimantRole: input.claimantRole ?? null,
      statedLicenceNumber: input.statedLicenceNumber?.trim() || null,
      statedLicenceExpiry: input.statedLicenceExpiry ?? null,
      ocrLicenceNumber: input.ocrLicenceNumber?.trim() || null,
      ocrLicenceExpiry: input.ocrLicenceExpiry ?? null,
      ocrConfidence: input.ocrConfidence ?? null,
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
