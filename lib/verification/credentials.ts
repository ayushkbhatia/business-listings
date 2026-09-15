import { daysUntil, LICENCE_NOTICE_DAYS } from "@/lib/verification";
import type { DocumentKind } from "@/lib/db/generated/enums";

/**
 * Document kinds a public surface may show.
 *
 * `trade_licence` and `vat_certificate` are absent and that is the whole point.
 * They live in the same private bucket as everything else in `Document`, and
 * `verify_listing.documents_hint` promises the seller they are never on their
 * public listing. `/b/:slug/d/:document` serves nothing outside this list.
 */
export const PUBLISHABLE_DOCUMENT_KINDS = ["certificate", "catalogue", "datasheet"] as const;

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
 * Stated as a constant rather than as "not publishable" so that adding a
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
 * Three states, and each one names a different consequence:
 *
 *  · `on_file`     we hold it and it is current. Nothing to do.
 *  · `expiring`    inside the notice window. Time to upload the renewal.
 *  · `lapsed`      past its validity, and **nothing else** follows — the tier
 *                  and the badge are untouched, which is the whole reason this
 *                  is a different pill from the licence's.
 *
 * There was a fourth, `in_review`, when a seller could ask for a certificate to
 * be named on their storefront. No storefront names one since the builder cut
 * (15 Sep 2026), so there is nothing to ask for and nothing to review.
 *
 * A lapsed credential is never deleted. Board 3e open question 5: it is
 * evidence of a past state, and deleting it makes the tier history unauditable.
 */
export type CredentialState = "on_file" | "expiring" | "lapsed";

export interface CredentialInput {
  validUntil: Date | null;
}

/**
 * `now` is a parameter and never `Date.now()` in the body — the same rule as
 * `licenceExpired`, and for the same reason: this runs in render.
 */
export function credentialState(document: CredentialInput, now: Date): CredentialState {
  if (document.validUntil) {
    if (document.validUntil.getTime() < now.getTime()) return "lapsed";
    if (daysUntil(document.validUntil, now) <= LICENCE_NOTICE_DAYS) return "expiring";
  }
  return "on_file";
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
 * So two sets, not one. `PUBLISHABLE_DOCUMENT_KINDS` fences what a public route
 * may serve; this governs what board 3e's second table shows.
 */
export const CREDENTIAL_KINDS = ["certificate"] as const;

export function isCredential(kind: DocumentKind): boolean {
  return (CREDENTIAL_KINDS as readonly string[]).includes(kind);
}

/**
 * A kind `/b/:slug/d/:document` may serve. Staff review and the credential
 * queue read the same fence to refuse a trade licence.
 */
export function isPublishable(kind: DocumentKind): boolean {
  return (PUBLISHABLE_DOCUMENT_KINDS as readonly string[]).includes(kind);
}
