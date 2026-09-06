import { daysUntil, LICENCE_NOTICE_DAYS } from "@/lib/verification";
import { PUBLISHABLE_DOCUMENT_KINDS } from "@/lib/storefront/section-types";
import type { DocumentKind } from "@/lib/db/generated/enums";

/**
 * The two kinds of document board 3e splits the screen down the middle for.
 *
 * The board ran one table, five rows, one `Status` column, and `Verified` on
 * all but one of them. Two of those rows are the trade licence and the TRN,
 * checked against the issuing authority. The other three are an ISO
 * certificate, a Civil Defence approval and a DEWA registration — PDFs the
 * seller uploaded, which nobody at the platform has looked at. `Verified`
 * across both is a claim the platform cannot back.
 *
 * The split is not new to the database. `PUBLISHABLE_DOCUMENT_KINDS` has fenced
 * a trade licence off every storefront since handoff 1, and this is the same
 * line drawn from the other side: the kinds that set the tier are exactly the
 * kinds that can never be published, because a document that decides a badge is
 * a document we hold rather than one the seller shows.
 *
 * Stated as a constant rather than as `!isPublishable(kind)` so that adding a
 * kind forces a decision about which table it belongs in. A document in neither
 * list renders in neither table, which is visible; a document that silently
 * defaults into `Verified by us` would be a certificate claiming a check.
 */
export const CHECKED_BY_US_KINDS = ["trade_licence", "vat_certificate"] as const;

export type CheckedByUsKind = (typeof CHECKED_BY_US_KINDS)[number];

export function isCheckedByUs(kind: string): kind is CheckedByUsKind {
  return (CHECKED_BY_US_KINDS as readonly string[]).includes(kind);
}

/**
 * What a row in `Uploaded by you` says, and it is never `Verified`.
 *
 * Four states, and each one names a different consequence:
 *
 *  · `on_file`     we hold it and it is good. Nothing to do.
 *  · `in_review`   the seller asked to publish it and nobody has looked yet.
 *                  Two working days, in the moderation queue.
 *  · `expiring`    inside the notice window. It still counts; it will not.
 *  · `lapsed`      past its validity. Dropped from the filters that read it,
 *                  and **nothing else** — the tier and the badge are untouched,
 *                  which is the whole reason this is a different pill from the
 *                  licence's.
 *
 * A lapsed credential is never deleted. Board 3e open question 5: it is
 * evidence of a past state, and deleting it makes the tier history unauditable.
 */
export type CredentialState = "on_file" | "in_review" | "expiring" | "lapsed";

export interface CredentialInput {
  validUntil: Date | null;
  isPublic: boolean;
  reviewedAt: Date | null;
}

/**
 * `now` is a parameter and never `Date.now()` in the body — the same rule as
 * `licenceExpired`, and for the same reason: this runs in render.
 *
 * Order matters. A lapsed document that is also waiting on a review reads
 * `Lapsed`, because that is the state with the consequence: publishing a
 * certificate that expired last month is not a decision worth queueing.
 */
export function credentialState(document: CredentialInput, now: Date): CredentialState {
  if (document.validUntil) {
    if (document.validUntil.getTime() < now.getTime()) return "lapsed";
    if (daysUntil(document.validUntil, now) <= LICENCE_NOTICE_DAYS) {
      return document.isPublic && !document.reviewedAt ? "in_review" : "expiring";
    }
  }
  if (document.isPublic && !document.reviewedAt) return "in_review";
  return "on_file";
}

/**
 * Is this document actually on the storefront?
 *
 * Two facts, because they are two people's decisions. The seller says whether
 * they want it public; a moderator says whether it may be. `lib/storefront/
 * loader.ts` asks the same question in SQL, and this is the copy of it the
 * seller's own screen reads so that the `WHO SEES IT` column cannot claim a
 * visibility the public query does not grant.
 */
export function isOnStorefront(document: CredentialInput): boolean {
  return document.isPublic && document.reviewedAt !== null;
}

/**
 * What `Uploaded by you` is a table of, and it is narrower than "publishable".
 *
 * A certificate or an approval — ISO 9001, Civil Defence, a DEWA registration.
 * The table's footer states the consequence of holding one: *"a credential here
 * puts you in the filters buyers use"*, and that is true of a certificate and
 * false of a catalogue. A product catalogue and a datasheet are literature; they
 * are publishable, they belong to the media library board 3i built, and listing
 * them here under a sentence about filters would be a sentence that is wrong
 * for two of its three rows.
 *
 * So two sets, not one. `isPublishable` governs review and visibility, because
 * anything reaching a storefront needs both. This governs what board 3e's
 * second table shows.
 */
export const CREDENTIAL_KINDS = ["certificate"] as const;

export function isCredential(kind: DocumentKind): boolean {
  return (CREDENTIAL_KINDS as readonly string[]).includes(kind);
}

/**
 * Anything a seller can put on their storefront.
 *
 * The fence the storefront query already applies, read from the same constant
 * so the seller's visibility control and the public query cannot disagree about
 * what is publishable.
 */
export function isPublishable(kind: DocumentKind): boolean {
  return (PUBLISHABLE_DOCUMENT_KINDS as readonly string[]).includes(kind);
}
