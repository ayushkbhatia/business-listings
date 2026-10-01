import { licenceParts, nameTokens } from "@/lib/dedupe/similarity";
import { sameLicenceNumber } from "@/lib/verification/licence/number";

/**
 * Board 4c — every claim on a listing, scored on the same rows.
 *
 * Pure, and computed every time the screen is read (`B5`). A listing edit, a
 * register import or a document arriving in the `docs_requested` state has to
 * re-derive them, for the same reason board 4b's `allPassed` is never stored:
 * a stored verdict outlives the facts it was computed from.
 *
 * ## What each row is compared against (`B6`)
 *
 * | Row          | Claim side                                  | Listing side                     |
 * |--------------|---------------------------------------------|----------------------------------|
 * | Trade name   | the register's name for the claim's licence | the source record's legal name   |
 * | Address      | the register's address for that licence     | the listing's head office        |
 * | Phone        | the number called (phone route), or the     | every number on the listing      |
 * |              | register's numbers for that licence         |                                  |
 * | Email domain | the claimant's own account email            | the business's own domain        |
 *
 * The claim side is read from **our licence register** for the number the
 * claimant stated — never from what the claimant typed about themselves. A
 * claimant can type any trade name; they cannot type a register row. Where the
 * register holds nothing for their licence the row says so, in grey, rather
 * than scoring an absence as a mismatch (*unfilled data stays visible*).
 *
 * The licence number itself is not a scored row. It is the fact that settles
 * most conflicts outright — whether the claim holds the licence this listing
 * was minted from (§Flagged 1) — and it outranks the count (`B5`, Q1).
 */

export type SignalOutcome = "match" | "partial" | "none" | "unknown";

export type SignalKey = "trade_name" | "address" | "phone" | "email_domain";

export const SIGNAL_KEYS: readonly SignalKey[] = ["trade_name", "address", "phone", "email_domain"];

/**
 * Why a row came out the way it did, for the sentence beside it. A code, not a
 * string: words are resolved on the server by the screen (`lib/i18n`), and the
 * same signal reads one way on a card and another in a test.
 */
export type SignalDetail =
  | "exact"
  | "similar"
  | "different"
  | "same_area"
  | "public_record"
  | "free_mail"
  | "not_in_register"
  | "no_address"
  | "no_phone"
  | "no_email"
  | "no_domain_on_record";

export interface Signal {
  key: SignalKey;
  outcome: SignalOutcome;
  detail: SignalDetail;
  /** What the claim side holds, shown in the row — a name, an area, a number, a domain. */
  value: string | null;
}

export interface Place {
  areaName: string | null;
  emirate: string | null;
  addressLine: string | null;
}

/** The record the listing was minted from, and what it holds today. */
export interface SourceRecord {
  legalName: string;
  licenceNumber: string;
  authority: string;
  address: Place | null;
  phones: readonly string[];
  /** The business's own domain, where anything on record names one. */
  domain: string | null;
}

/** What our licence register holds for the number a claimant stated. */
export interface RegisterEntry extends Place {
  tradeName: string | null;
  phones: readonly string[];
}

export interface ClaimFacts {
  id: string;
  route: "licence_upload" | "phone_callback";
  /** As stated (normalised), or as read where the claimant stated nothing. */
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  /** The phone route's number — taken from the public record, never typed. */
  calledNumber: string | null;
  register: RegisterEntry | null;
  /** The claimant's account email's domain, lower-cased. */
  emailDomain: string | null;
  /**
   * The latest call staff logged to this claimant (`B7`). Evidence of
   * ownership only when it went to the number on the public licence record —
   * a number the claimant supplied proves contact, not ownership.
   */
  call: { to: "public_record" | "claimant_supplied"; confirmed: boolean } | null;
}

export interface ScoredClaim {
  id: string;
  signals: Signal[];
  exactMatches: number;
  holdsSourceLicence: boolean;
  /** The licence fails the check we can make: it has expired. Such a claim cannot be awarded. */
  licenceLapsed: boolean;
  /** `B7`: a logged call to the public-record number that the claimant answered as the company. */
  confirmedOnPublicRecord: boolean;
}

/**
 * Domains that say nothing about which company somebody works for (`B6`).
 * Board 4c scores them as no match, never as unknown: a claimant writing from
 * `@gmail.com` has given us an address, and it is not the business's.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "mail.com",
  "gmx.com",
  "yandex.com",
]);

export function emailDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 ? domain : null;
}

/**
 * A domain out of whatever a record holds — an email, a URL, a bare host.
 * `www.` is not part of anybody's identity.
 */
export function domainOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.trim().toLowerCase();
  const fromEmail = /@([a-z0-9.-]+\.[a-z]{2,})/.exec(text)?.[1];
  const fromHost = /^(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/.exec(text)?.[1];
  const domain = fromEmail ?? fromHost ?? null;
  return domain ? domain.replace(/^www\./, "") : null;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

/**
 * UAE numbers arrive as `02 553 1190`, `+971 2 553 1190` and `0097125531190`.
 * Compared on the national significant number: country code and trunk zero off.
 */
export function samePhone(a: string, b: string): boolean {
  const national = (value: string) => digits(value).replace(/^(?:00)?971/, "").replace(/^0/, "");
  const left = national(a);
  const right = national(b);
  return left.length >= 7 && left === right;
}

function sameText(a: string | null, b: string | null): boolean {
  const norm = (value: string | null) =>
    (value ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
      .trim();
  return norm(a) !== "" && norm(a) === norm(b);
}

/**
 * Names are compared on the words that identify them (`nameTokens`, board 12b's
 * reducer: legal suffixes and *general*, *trading*, *co* are noise). All of
 * them shared is a match; half of the shorter name shared is similar — *Cool
 * Breeze Air Cond. Maint.* against *Cool Breeze Technical Services*.
 */
function compareNames(claim: string, listing: string): SignalOutcome {
  const left = new Set(nameTokens(claim));
  const right = new Set(nameTokens(listing));
  if (left.size === 0 || right.size === 0) return "none";
  const shared = [...left].filter((token) => right.has(token)).length;
  if (shared === left.size && shared === right.size) return "match";
  return shared / Math.min(left.size, right.size) >= 0.5 ? "partial" : "none";
}

function tradeNameSignal(claim: ClaimFacts, source: SourceRecord): Signal {
  const name = claim.register?.tradeName ?? null;
  if (!name) return { key: "trade_name", outcome: "unknown", detail: "not_in_register", value: null };
  const outcome = compareNames(name, source.legalName);
  return {
    key: "trade_name",
    outcome,
    detail: outcome === "match" ? "exact" : outcome === "partial" ? "similar" : "different",
    value: name,
  };
}

function addressSignal(claim: ClaimFacts, source: SourceRecord): Signal {
  const register = claim.register;
  if (!register) return { key: "address", outcome: "unknown", detail: "not_in_register", value: null };
  const value = [register.areaName, register.addressLine].filter(Boolean).join(" · ") || null;
  if (!register.areaName && !register.addressLine) return { key: "address", outcome: "unknown", detail: "no_address", value };
  const listing = source.address;
  if (!listing || (!listing.areaName && !listing.addressLine)) {
    return { key: "address", outcome: "unknown", detail: "no_address", value };
  }
  const sameArea = sameText(register.areaName, listing.areaName) && (!register.emirate || !listing.emirate || register.emirate === listing.emirate);
  if (sameArea && sameText(register.addressLine, listing.addressLine)) {
    return { key: "address", outcome: "match", detail: "exact", value };
  }
  // The same area and not provably the same unit: *same building*, at best.
  if (sameArea) return { key: "address", outcome: "partial", detail: "same_area", value };
  return { key: "address", outcome: "none", detail: "different", value };
}

function phoneSignal(claim: ClaimFacts, source: SourceRecord): Signal {
  // The phone route called a number off the public record. That is the check.
  if (claim.route === "phone_callback" && claim.calledNumber) {
    const onRecord = source.phones.some((phone) => samePhone(phone, claim.calledNumber!));
    return {
      key: "phone",
      outcome: onRecord ? "match" : "none",
      detail: onRecord ? "public_record" : "different",
      value: claim.calledNumber,
    };
  }
  const phones = claim.register?.phones ?? [];
  if (!claim.register) return { key: "phone", outcome: "unknown", detail: "not_in_register", value: null };
  if (phones.length === 0 || source.phones.length === 0) {
    return { key: "phone", outcome: "unknown", detail: "no_phone", value: phones[0] ?? null };
  }
  const shared = phones.find((phone) => source.phones.some((own) => samePhone(own, phone)));
  return shared
    ? { key: "phone", outcome: "match", detail: "exact", value: shared }
    : { key: "phone", outcome: "none", detail: "different", value: phones[0]! };
}

function emailSignal(claim: ClaimFacts, source: SourceRecord): Signal {
  const domain = claim.emailDomain;
  if (!domain) return { key: "email_domain", outcome: "unknown", detail: "no_email", value: null };
  const value = `@${domain}`;
  if (FREE_MAIL_DOMAINS.has(domain)) return { key: "email_domain", outcome: "none", detail: "free_mail", value };
  if (!source.domain) return { key: "email_domain", outcome: "unknown", detail: "no_domain_on_record", value };
  const own = source.domain.toLowerCase();
  const matches = domain === own || domain.endsWith(`.${own}`);
  return { key: "email_domain", outcome: matches ? "match" : "none", detail: matches ? "exact" : "different", value };
}

export function scoreClaim(claim: ClaimFacts, source: SourceRecord, now: Date): ScoredClaim {
  const signals = [tradeNameSignal(claim, source), addressSignal(claim, source), phoneSignal(claim, source), emailSignal(claim, source)];
  return {
    id: claim.id,
    signals,
    exactMatches: signals.filter((signal) => signal.outcome === "match").length,
    holdsSourceLicence:
      claim.licenceNumber !== null && sameLicenceNumber(claim.licenceNumber, source.licenceNumber, source.authority),
    licenceLapsed: claim.licenceExpiry !== null && claim.licenceExpiry.getTime() < now.getTime(),
    confirmedOnPublicRecord: claim.call?.to === "public_record" && claim.call.confirmed,
  };
}

export type Strength = "stronger" | "partial" | "none";

export type RecommendationBasis = "source_licence" | "matches" | "call";

export interface Assessment {
  /** Per claim id. Null where a claim tied for the lead: a tie has no tag (criterion 5). */
  strength: ReadonlyMap<string, Strength | null>;
  /** The claim the computed rules recommend, or null where they do not separate the claims. */
  recommended: string | null;
  basis: RecommendationBasis | null;
}

/**
 * `STRONGER` and `PARTIAL` are computed, never chosen (`B5`), in the order Q1
 * sets out:
 *
 *   1. **The holder of the source licence**, where exactly one eligible claim
 *      holds it. A lapsed licence is not eligible: that card cannot be awarded.
 *   2. Otherwise **the strict lead on exact matches** — strictly: a tie names
 *      nobody.
 *   3. A tie on matches is broken by **a call answered on the public-record
 *      number** (`B7`), where exactly one of the tied claims has one.
 *
 * Everyone else is `partial` where any row matched or nearly matched, `none`
 * where nothing did. The reviewer may overrule all of it, and the note they
 * must write anyway is the reason (`B4`).
 */
export function assess(claims: readonly ScoredClaim[]): Assessment {
  const eligible = claims.filter((claim) => !claim.licenceLapsed);
  const holders = eligible.filter((claim) => claim.holdsSourceLicence);

  let recommended: string | null = null;
  let basis: RecommendationBasis | null = null;
  let tied: string[] = [];

  if (holders.length === 1) {
    recommended = holders[0]!.id;
    basis = "source_licence";
  } else {
    const pool = holders.length > 1 ? holders : eligible;
    const top = Math.max(0, ...pool.map((claim) => claim.exactMatches));
    const leaders = top > 0 ? pool.filter((claim) => claim.exactMatches === top) : [];
    if (leaders.length === 1) {
      recommended = leaders[0]!.id;
      basis = "matches";
    } else if (leaders.length > 1) {
      const called = leaders.filter((claim) => claim.confirmedOnPublicRecord);
      if (called.length === 1) {
        recommended = called[0]!.id;
        basis = "call";
      } else {
        tied = leaders.map((claim) => claim.id);
      }
    }
  }

  const strength = new Map<string, Strength | null>();
  for (const claim of claims) {
    if (claim.id === recommended) strength.set(claim.id, "stronger");
    else if (tied.includes(claim.id)) strength.set(claim.id, null);
    else {
      const any = claim.signals.some((signal) => signal.outcome === "match" || signal.outcome === "partial");
      strength.set(claim.id, any ? "partial" : "none");
    }
  }
  return { strength, recommended, basis };
}

/**
 * Board 12b's branch hint (`B13`), applied to a merge from a conflict: a branch
 * licence usually carries the parent's number with a short suffix. Saying so
 * when it does not is the point — *ADDED-802116 is not a suffix of
 * ADDED-771204* is something the reviewer should read before merging.
 */
export function looksLikeBranchOf(branch: string, parent: string): boolean {
  const child = licenceParts(branch);
  const root = licenceParts(parent).root;
  return child.suffix !== null && root !== "" && child.root === root;
}
