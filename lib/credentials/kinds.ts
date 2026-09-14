import type { CredentialKind, TrustTier } from "@/lib/db/generated/enums";

/**
 * Credentials — board `8b-s`, the task that replaces "upload five photographs".
 *
 * Pure, so the two rules that matter can be tested without a database: which
 * kinds can reach a register, and what a tier is allowed to say.
 *
 * ## Nothing here is required, and the rules encode that
 *
 * There is no `validate` in this file that can refuse a save. A credentials
 * form on a B2B directory reads like a compliance gate, and a seller who thinks
 * they are being audited abandons the screen — so the screen states three times
 * that it is optional, and the only way to keep that true is for the code
 * underneath to have no refusal in it. What a credential can be missing is
 * everything except its kind.
 */

/** In the order the screen offers them: the checkable one first. */
export const CREDENTIAL_KINDS = [
  "fta_tax_agent",
  "mof_audit_approval",
  "professional_body",
  "indemnity_insurance",
  "other",
] as const;

export function isCredentialKind(value: string): value is CredentialKind {
  return (CREDENTIAL_KINDS as readonly string[]).includes(value);
}

/**
 * The kinds a register can answer for — board `8b-s` B2, AC2.
 *
 * **One.** The trade licence is the other checkable thing and it is not a
 * credential row: it lives on `Business`, and the screen renders it read-only
 * from there rather than asking for it twice.
 *
 * Everything else saves as a claim, and that is a constraint rather than a
 * phase-one limitation — there is no register to check an indemnity schedule
 * against. A moderator looking at a PDF of an insurance certificate is not
 * verification; it is theatre with a queue attached, and `4c-s` says the same.
 */
export const CHECKABLE_KINDS = ["fta_tax_agent"] as const;

export function isCheckable(kind: CredentialKind): boolean {
  return (CHECKABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * The credentials that stand: every row but one a person checked against the
 * register and rejected — board `4c-s`.
 *
 * A rejected credential is off the storefront, out of the comparison a buyer
 * reads, out of every count that sits over those, and earns no setup points.
 * It was the seller's claim until somebody looked it up and found it untrue.
 *
 * Spelled as an `OR` with the null, because `review: { not: "rejected" }` is
 * SQL `review <> 'rejected'`, which is null — and so false — on every row that
 * never entered review, and would silently drop them all.
 */
export const STANDING_CREDENTIAL = {
  OR: [{ review: null }, { review: { not: "rejected" as const } }],
};

/**
 * The credentials a buyer may filter on and see a check mark beside — board
 * `1c-s` B7: *register-checked per `4c-s`, never self-declared, and the facet
 * filters on the checked state only.*
 *
 * Standing, and verified against the issuing register. Only `fta_tax_agent`
 * can reach that tier, and on production nothing does until a register client
 * exists, so the rail's accreditation group is absent there rather than a list
 * of claims wearing a tick.
 */
export const CHECKED_CREDENTIAL = {
  AND: [STANDING_CREDENTIAL, { trust: "register_verified" as const }],
};

/**
 * What a credential says about itself, given what actually happened to it.
 *
 * Three labels over two stored tiers. `we_verify_this` is **not** a state a row
 * can be in — it is the promise the form makes about a field before anything
 * has been submitted, and it never survives a save. A row is either checked
 * against a register or it is the seller's own word.
 */
export type TrustLabel = "register_verified" | "we_verify_this" | "seller_claim";

export function labelFor(kind: CredentialKind, trust: TrustTier): TrustLabel {
  return trust === "register_verified" ? "register_verified" : "seller_claim";
}

/** The label a *field* wears before anything is typed into it. */
export function promiseFor(kind: CredentialKind): TrustLabel | null {
  return isCheckable(kind) ? "we_verify_this" : null;
}

/* ── Points ──────────────────────────────────────────────────────────────── */

/**
 * Two credentials is the whole ask — board `8a-s`'s completion rule, and
 * `8b-s` B7 defers to it.
 *
 * `8b-s` Q1 proposes 1 = 16 points and 2 = the full 32, which is exactly what
 * `ratio(held, 2) * 32` produces, so the shape was already implemented when the
 * hub shipped. What `8a-s` settled and this board inherits is that the second
 * half of the board's rule — *at least one verified* — is not required: there
 * is one checkable kind and a firm that holds no FTA agent number could
 * otherwise never finish the largest task on the hub.
 */
export const CREDENTIAL_TARGET = 2;

/* ── The suggestion rate ─────────────────────────────────────────────────── */

/**
 * Below this, the row is suppressed rather than shown weak — B6, AC6.
 *
 * A suggestion is only worth making because it carries a real number: a seller
 * does not know what their competitors show, and the subcategory rate answers
 * it in one line. Suggesting a credential most of them do **not** hold makes
 * the seller distrust the rest of the screen, which is expensive for one row.
 *
 * Twenty-five per cent is `8b-s` Q3's starting point rather than a finding.
 */
export const SUGGESTION_FLOOR = 0.25;

export interface SuggestionRate {
  kind: CredentialKind;
  /** Verified suppliers in this subcategory holding this kind. */
  holders: number;
  /** Verified suppliers in this subcategory at all. */
  peers: number;
  /** `holders / peers`, or zero where there are no peers. */
  rate: number;
}

/**
 * Which suggestions are worth showing, strongest first.
 *
 * A rate computed over no peers is zero rather than `NaN`, and zero is below
 * the floor, so a directory with nothing in it suggests nothing — which is the
 * honest cold state and is exactly where this platform is today.
 */
export function worthSuggesting(
  rates: readonly SuggestionRate[],
  held: readonly CredentialKind[],
  floor = SUGGESTION_FLOOR,
): SuggestionRate[] {
  return rates
    .filter((row) => !held.includes(row.kind))
    .filter((row) => row.peers > 0 && row.rate >= floor)
    .sort((a, b) => b.rate - a.rate || a.kind.localeCompare(b.kind));
}

export function rateOf(holders: number, peers: number): number {
  return peers <= 0 ? 0 : Math.min(1, holders / peers);
}
