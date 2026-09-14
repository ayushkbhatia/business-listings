import { phoneKey, nameSimilarity, licenceDigits } from "@/lib/dedupe/similarity";
import { AUTHORITY_EMIRATE } from "@/lib/ingest/sources";
import { normaliseLicenceNumber, sameLicenceNumber } from "@/lib/verification/licence/number";
import type { Authority, Emirate } from "@/lib/db/generated/enums";
import { compareCredential, type Submitted } from "@/lib/credentials/compare";
import type { RegisterFetch } from "@/lib/credentials/register-fetch";
import { ruleEnabled, type CheckRules, type QueueKind, type RuleId } from "./rules";

/**
 * Board 4b — every row carries the result of its automated checks.
 *
 * Pure, and the only place a check is decided. The queue, the per-row action,
 * the bulk-approve guard on the server and the tuning preview all call
 * `checksFor`, so "every check passed" means the same thing on the screen that
 * offers bulk approve and in the action that refuses it (B1, B2).
 *
 * **A check gives a reason, not a score** (B3). Each returns the sentence the
 * reviewer reads — *Licence expires in 21 days*, *RAK branch not on DMCC
 * licence* — as a catalogue key with its facts, and the outcome that colours
 * it. A failed or warning check also names what a person should do about it,
 * which is how the row's primary action is chosen (B6).
 *
 * The facts are plain values the loader has already read. Nothing here touches
 * the database, the clock or the catalogue.
 */

export type CheckOutcome = "pass" | "warn" | "fail";

/** What a check that did not pass asks a person to do. */
export type Suggestion = "review" | "request_doc" | "reject";

export interface CheckSentence {
  key: string;
  params?: Record<string, string | number>;
  /** Params that are themselves catalogue keys: an emirate, a document kind. */
  labels?: Record<string, string>;
}

export interface Check {
  rule: RuleId;
  outcome: CheckOutcome;
  suggests: Suggestion | null;
  sentence: CheckSentence;
}

export type RowAction = "approve" | "review" | "request_doc" | "reject";

const DAY_MS = 86_400_000;

/* ── Facts ─────────────────────────────────────────────────────────────────── */

export interface ClaimFacts {
  kind: "claim";
  route: "licence_upload" | "phone_callback";
  authority: string;
  registerLicenceNumber: string;
  registerExpiry: Date;
  statedLicenceNumber: string | null;
  ocrLicenceNumber: string | null;
  statedLicenceExpiry: Date | null;
  ocrLicenceExpiry: Date | null;
  ocrConfidence: number | null;
  /** What the classifier read the upload as. Null where it was never scanned. */
  detectedKind: string | null;
  phone: string | null;
  recordPhones: readonly string[];
  closing: boolean;
  /**
   * The listing's category, where it or its sector requires an extra licence
   * check (board 4d). Null where neither does.
   */
  extraCheckTrade: string | null;
}

export interface ProfileEditFacts {
  kind: "profile_edit";
  field: "trade_name" | "licence";
  before: string | null;
  after: string;
  authority: string;
  /** Trade name: the new public address, and whether another listing holds it. */
  nextSlug: string | null;
  slugTaken: boolean;
  /** Licence: another live listing carrying the same number. */
  duplicateOf: string | null;
}

export interface CategoryChangeFacts {
  kind: "category_change";
  field: "primary_category" | "additional_category";
  categoryName: string;
  /** `activityCovers` against the licence's own stated activity. */
  fitsLicence: boolean;
  /** Primary only: the trade kind before and after, where it moves. */
  tradeKindBefore: "goods" | "services" | null;
  tradeKindAfter: "goods" | "services" | null;
  /** The category moved into, where it or its sector requires an extra licence check. */
  extraCheckTrade: string | null;
}

export interface LocationFacts {
  kind: "locations";
  emirate: Emirate;
  authority: string;
  /** The branch's own registry number (board 12b B9), where it has one. */
  branchLicenceNumber: string | null;
}

export interface CredentialFacts {
  kind: "credential";
  displayName: string | null;
  validUntil: Date | null;
  publishable: boolean;
}

/**
 * Board 4c-s. A credential row against the register that issued it. Queued
 * under the `credential` kind beside board 3e's documents, because to the
 * person working the queue both are credentials — but decided by comparison,
 * never by a view of the file.
 */
export interface RegisterCredentialFacts {
  kind: "register_credential";
  submitted: Submitted;
  /** The last read, parsed. Null where none parses or none was taken. */
  read: RegisterFetch | null;
}

export interface ConflictFacts {
  kind: "conflict";
  claims: readonly { route: "licence_upload" | "phone_callback" }[];
}

export type SubmissionFacts =
  | ClaimFacts
  | ProfileEditFacts
  | CategoryChangeFacts
  | LocationFacts
  | CredentialFacts
  | RegisterCredentialFacts
  | ConflictFacts;

/* ── Helpers ───────────────────────────────────────────────────────────────── */

const pass = (rule: RuleId, sentence: CheckSentence): Check => ({ rule, outcome: "pass", suggests: null, sentence });
const warn = (rule: RuleId, suggests: Suggestion, sentence: CheckSentence): Check => ({
  rule,
  outcome: "warn",
  suggests,
  sentence,
});
const fail = (rule: RuleId, suggests: Suggestion, sentence: CheckSentence): Check => ({
  rule,
  outcome: "fail",
  suggests,
  sentence,
});

/** Whole days until a date, rounded up so "expires today" is 0 and never negative for a future instant. */
function daysUntil(date: Date, now: Date): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A banned term as a word, not a substring: "bestway" is not "best". */
export function bannedTermIn(text: string, terms: readonly string[]): string | null {
  const haystack = ` ${text.toLowerCase().replace(/[^\p{Letter}\p{Number}.]+/gu, " ")} `;
  for (const term of terms) {
    const needle = term.toLowerCase().replace(/[^\p{Letter}\p{Number}.]+/gu, " ").trim();
    if (needle && haystack.includes(` ${needle} `)) return term;
  }
  return null;
}

/* ── The checks, by kind ───────────────────────────────────────────────────── */

function claimChecks(facts: ClaimFacts, rules: CheckRules, now: Date): Check[] {
  const checks: Check[] = [];
  const on = (id: RuleId) => ruleEnabled(rules, id);

  if (facts.closing) {
    checks.push(fail("business_closing", "reject", { key: "admin.queue.check.business_closing.closing" }));
  }
  const extra = extraLicenceCheck(facts.extraCheckTrade);
  if (extra) checks.push(extra);

  if (on("licence_current")) {
    const days = daysUntil(facts.registerExpiry, now);
    if (days < 0) {
      checks.push(
        fail("licence_current", "request_doc", {
          key: "admin.queue.check.licence_current.expired",
          params: { date: isoDay(facts.registerExpiry) },
        }),
      );
    } else if (days <= rules.expiryWarnDays) {
      // Q1 and B10: valid today, approvable, and the expiry stays on the record
      // for the sweep. The reviewer is told before they approve.
      checks.push(
        warn("licence_current", "review", {
          key: "admin.queue.check.licence_current.expiring",
          params: { count: days, n: days },
        }),
      );
    } else {
      checks.push(pass("licence_current", { key: "admin.queue.check.licence_current.valid" }));
    }
  }

  if (facts.route === "licence_upload") {
    if (on("document_type")) {
      if (facts.detectedKind === "trade_licence") {
        checks.push(pass("document_type", { key: "admin.queue.check.document_type.trade_licence" }));
      } else if (facts.detectedKind && facts.detectedKind !== "unknown") {
        checks.push(
          fail("document_type", "request_doc", {
            key: "admin.queue.check.document_type.other",
            labels: { document: `verify.document.${facts.detectedKind}` },
          }),
        );
      } else {
        checks.push(warn("document_type", "review", { key: "admin.queue.check.document_type.unread" }));
      }
    }

    const claimed = facts.statedLicenceNumber ?? facts.ocrLicenceNumber;
    if (on("licence_number") && claimed) {
      checks.push(
        sameLicenceNumber(claimed, facts.registerLicenceNumber, facts.authority)
          ? pass("licence_number", { key: "admin.queue.check.licence_number.matches" })
          : fail("licence_number", "review", { key: "admin.queue.check.licence_number.differs" }),
      );
    }

    if (on("scan_agrees") && facts.ocrLicenceNumber && facts.statedLicenceNumber) {
      const numberAgrees = sameLicenceNumber(facts.ocrLicenceNumber, facts.statedLicenceNumber, facts.authority);
      const expiryAgrees =
        !facts.ocrLicenceExpiry ||
        !facts.statedLicenceExpiry ||
        facts.ocrLicenceExpiry.getTime() === facts.statedLicenceExpiry.getTime();
      checks.push(
        numberAgrees && expiryAgrees
          ? pass("scan_agrees", { key: "admin.queue.check.scan_agrees.agrees" })
          : warn("scan_agrees", "review", { key: "admin.queue.check.scan_agrees.corrected" }),
      );
    }

    if (on("scan_confidence") && facts.ocrConfidence !== null) {
      checks.push(
        facts.ocrConfidence >= rules.scanConfidenceFloor
          ? pass("scan_confidence", { key: "admin.queue.check.scan_confidence.clear" })
          : warn("scan_confidence", "review", {
              key: "admin.queue.check.scan_confidence.low",
              params: { percent: `${Math.round(facts.ocrConfidence * 100)}%` },
            }),
      );
    }
  } else {
    if (on("phone_on_record")) {
      const wanted = facts.phone ? phoneKey(facts.phone) : "";
      const onRecord = wanted.length >= 7 && facts.recordPhones.some((phone) => phoneKey(phone) === wanted);
      checks.push(
        onRecord
          ? pass("phone_on_record", { key: "admin.queue.check.phone_on_record.matches" })
          : fail("phone_on_record", "reject", { key: "admin.queue.check.phone_on_record.missing" }),
      );
    }
    // A number on the record proves the number, not the person who will answer
    // it. Somebody has to call, so a phone claim is never bulk-approvable.
    if (on("callback")) {
      checks.push(warn("callback", "review", { key: "admin.queue.check.callback.pending" }));
    }
  }

  return checks;
}

function profileEditChecks(facts: ProfileEditFacts, rules: CheckRules): Check[] {
  const checks: Check[] = [];
  const on = (id: RuleId) => ruleEnabled(rules, id);

  if (facts.field === "trade_name") {
    if (on("banned_terms")) {
      const term = bannedTermIn(facts.after, rules.bannedTerms);
      checks.push(
        term
          ? fail("banned_terms", "reject", { key: "admin.queue.check.banned_terms.found", params: { term } })
          : pass("banned_terms", { key: "admin.queue.check.banned_terms.clear" }),
      );
    }
    if (on("licensed_name") && facts.before) {
      checks.push(
        nameSimilarity(facts.before, facts.after) >= rules.nameSimilarityFloor
          ? pass("licensed_name", { key: "admin.queue.check.licensed_name.close" })
          : warn("licensed_name", "request_doc", { key: "admin.queue.check.licensed_name.far" }),
      );
    }
    if (on("address_free") && facts.nextSlug) {
      checks.push(
        facts.slugTaken
          ? fail("address_free", "review", {
              key: "admin.queue.check.address_free.taken",
              params: { slug: facts.nextSlug },
            })
          : pass("address_free", { key: "admin.queue.check.address_free.free" }),
      );
    }
    return checks;
  }

  if (on("licence_format")) {
    const normalised = normaliseLicenceNumber(facts.after, facts.authority);
    checks.push(
      normalised.ok
        ? pass("licence_format", { key: "admin.queue.check.licence_format.ok", params: { authority: facts.authority } })
        : fail("licence_format", "reject", {
            key: "admin.queue.check.licence_format.bad",
            params: { authority: facts.authority },
          }),
    );
  }
  if (on("no_duplicate")) {
    checks.push(
      facts.duplicateOf
        ? fail("no_duplicate", "review", { key: "admin.queue.check.no_duplicate.found", params: { name: facts.duplicateOf } })
        : pass("no_duplicate", { key: "admin.queue.check.no_duplicate.clear" }),
    );
  }
  return checks;
}

/**
 * Board 4d — a trade the taxonomy marks as needing an extra licence check.
 *
 * Never a pass and never a rejection. It says a person has to read the licence
 * against the trade, which is exactly what bulk approve cannot do, so the row
 * leaves the bulk set (B2) and opens for review. Only present where the flag is
 * on: a check that passed on every other category would make "every check
 * passed" mean less everywhere.
 */
function extraLicenceCheck(trade: string | null): Check | null {
  if (!trade) return null;
  return warn("licence_extra_check", "review", {
    key: "admin.queue.check.licence_extra_check.required",
    params: { trade },
  });
}

function categoryChecks(facts: CategoryChangeFacts, rules: CheckRules): Check[] {
  const checks: Check[] = [];
  const extra = extraLicenceCheck(facts.extraCheckTrade);
  if (extra) checks.push(extra);
  if (ruleEnabled(rules, "category_fits")) {
    checks.push(
      facts.fitsLicence
        ? pass("category_fits", { key: "admin.queue.check.category_fits.fits" })
        : fail("category_fits", "reject", {
            key: "admin.queue.check.category_fits.outside",
            params: { category: facts.categoryName },
          }),
    );
  }
  // Q5: a primary category that moves the listing between goods and services
  // changes which screens the seller is shown, not only where it is filed.
  if (
    ruleEnabled(rules, "trade_kind") &&
    facts.field === "primary_category" &&
    facts.tradeKindBefore &&
    facts.tradeKindAfter &&
    facts.tradeKindBefore !== facts.tradeKindAfter
  ) {
    checks.push(
      warn("trade_kind", "review", {
        key: "admin.queue.check.trade_kind.changes",
        labels: { kind: `admin.queue.trade_kind.${facts.tradeKindAfter}` },
      }),
    );
  }
  return checks;
}

function locationChecks(facts: LocationFacts, rules: CheckRules): Check[] {
  if (!ruleEnabled(rules, "branch_emirate")) return [];
  if (facts.branchLicenceNumber) {
    return [
      pass("branch_emirate", {
        key: "admin.queue.check.branch_emirate.own_licence",
        params: { licence: facts.branchLicenceNumber },
      }),
    ];
  }
  const licensed = AUTHORITY_EMIRATE[facts.authority as Authority];
  if (licensed === facts.emirate) {
    return [pass("branch_emirate", { key: "admin.queue.check.branch_emirate.on_licence", params: { authority: facts.authority } })];
  }
  return [
    fail("branch_emirate", "review", {
      key: "admin.queue.check.branch_emirate.outside",
      params: { authority: facts.authority },
      labels: { emirate: `emirate.${facts.emirate}` },
    }),
  ];
}

function credentialChecks(facts: CredentialFacts, rules: CheckRules, now: Date): Check[] {
  const checks: Check[] = [];
  const on = (id: RuleId) => ruleEnabled(rules, id);

  if (!facts.publishable) {
    checks.push(fail("credential_name", "reject", { key: "admin.queue.check.credential_name.not_publishable" }));
    return checks;
  }
  if (on("credential_name")) {
    checks.push(
      facts.displayName
        ? pass("credential_name", { key: "admin.queue.check.credential_name.named" })
        : fail("credential_name", "request_doc", { key: "admin.queue.check.credential_name.unnamed" }),
    );
  }
  if (on("banned_terms") && facts.displayName) {
    const term = bannedTermIn(facts.displayName, rules.bannedTerms);
    checks.push(
      term
        ? fail("banned_terms", "reject", { key: "admin.queue.check.banned_terms.found", params: { term } })
        : pass("banned_terms", { key: "admin.queue.check.banned_terms.clear" }),
    );
  }
  if (on("credential_validity")) {
    if (!facts.validUntil) {
      checks.push(pass("credential_validity", { key: "admin.queue.check.credential_validity.no_expiry" }));
    } else {
      const days = daysUntil(facts.validUntil, now);
      checks.push(
        days < 0
          ? fail("credential_validity", "reject", {
              key: "admin.queue.check.credential_validity.expired",
              params: { date: isoDay(facts.validUntil) },
            })
          : days <= rules.expiryWarnDays
            ? warn("credential_validity", "review", {
                key: "admin.queue.check.credential_validity.expiring",
                params: { count: days, n: days },
              })
            : pass("credential_validity", { key: "admin.queue.check.credential_validity.valid" }),
      );
    }
  }
  return checks;
}

/**
 * Board 4c-s. What the comparison found, one sentence a field — the three
 * fields and the entity join, never merged, and a stale read said first.
 *
 * `rules` is not consulted: none of these can be switched off.
 */
function registerCredentialChecks(facts: RegisterCredentialFacts, now: Date): Check[] {
  const comparison = compareCredential(facts.submitted, facts.read, now);
  switch (comparison.state) {
    case "no_number":
      return [fail("register_answered", "review", { key: "admin.queue.check.register_answered.no_number" })];
    case "no_read":
      return [warn("register_answered", "review", { key: "admin.queue.check.register_answered.not_read" })];
    case "unavailable":
      return [fail("register_answered", "review", { key: "admin.queue.check.register_answered.unavailable" })];
    case "not_found":
      return [
        ...(comparison.fresh ? [] : [warn("register_answered", "review", { key: "admin.queue.check.register_answered.stale" })]),
        fail("register_number", "reject", { key: "admin.queue.check.register_number.not_found" }),
      ];
    case "found": {
      const record = comparison.fetch.record;
      const checks: Check[] = comparison.fresh
        ? []
        : [warn("register_answered", "review", { key: "admin.queue.check.register_answered.stale" })];
      checks.push(
        comparison.number === "match"
          ? pass("register_number", { key: "admin.queue.check.register_number.match" })
          : fail("register_number", "reject", { key: "admin.queue.check.register_number.other", params: { number: record.taan } }),
      );
      checks.push(
        comparison.name.verdict === "match"
          ? pass("register_name", { key: "admin.queue.check.register_name.match" })
          : comparison.name.verdict === "near"
            ? warn("register_name", "review", { key: "admin.queue.check.register_name.near", params: { name: record.name } })
            : fail("register_name", "reject", { key: "admin.queue.check.register_name.other", params: { name: record.name } }),
      );
      const status = comparison.status;
      checks.push(
        status.verdict === "match"
          ? pass("register_status", status.registerDay
              ? { key: "admin.queue.check.register_status.active_until", params: { date: status.registerDay } }
              : { key: "admin.queue.check.register_status.active" })
          : status.verdict === "lapsed"
            ? fail(
                "register_status",
                "reject",
                record.status === "active"
                  ? { key: "admin.queue.check.register_status.ended", params: { date: status.registerDay ?? "" } }
                  : { key: "admin.queue.check.register_status.inactive", labels: { status: `admin.credential_review.status.${record.status}` } },
              )
            : warn("register_status", "request_doc", {
                key: "admin.queue.check.register_status.contradicts",
                params: { certificate: status.certificateDay ?? "", register: status.registerDay ?? "" },
              }),
      );
      checks.push(
        comparison.entity === "same"
          ? pass("register_entity", { key: "admin.queue.check.register_entity.same" })
          : comparison.entity === "different"
            ? fail("register_entity", "reject", {
                key: "admin.queue.check.register_entity.different",
                params: { licence: record.tradeLicence?.number ?? "" },
              })
            : warn("register_entity", "review", { key: "admin.queue.check.register_entity.unconfirmed" }),
      );
      return checks;
    }
  }
}

function conflictChecks(facts: ConflictFacts, rules: CheckRules): Check[] {
  const checks: Check[] = [
    // Never switched off and never passed: who owns a company is a person's call.
    fail("two_claims", "review", {
      key: "admin.queue.check.two_claims.open",
      params: { count: facts.claims.length, n: facts.claims.length },
    }),
  ];
  if (ruleEnabled(rules, "claim_evidence")) {
    const byPhone = facts.claims.filter((claim) => claim.route === "phone_callback").length;
    checks.push(
      byPhone === 0
        ? pass("claim_evidence", { key: "admin.queue.check.claim_evidence.documents" })
        : warn("claim_evidence", "review", {
            key: "admin.queue.check.claim_evidence.by_phone",
            params: { count: byPhone, n: byPhone },
          }),
    );
  }
  return checks;
}

/* ── The row ───────────────────────────────────────────────────────────────── */

export function checksFor(facts: SubmissionFacts, rules: CheckRules, now: Date): Check[] {
  switch (facts.kind) {
    case "claim":
      return claimChecks(facts, rules, now);
    case "profile_edit":
      return profileEditChecks(facts, rules);
    case "category_change":
      return categoryChecks(facts, rules);
    case "locations":
      return locationChecks(facts, rules);
    case "credential":
      return credentialChecks(facts, rules, now);
    case "register_credential":
      return registerCredentialChecks(facts, now);
    case "conflict":
      return conflictChecks(facts, rules);
  }
}

/**
 * Every check ran and every one passed (B2). A submission with no checks at all
 * has not been checked, so it is not "all passed" — switching every rule off
 * must not turn the queue into a bulk approve.
 */
export function allPassed(checks: readonly Check[]): boolean {
  return checks.length > 0 && checks.every((check) => check.outcome === "pass");
}

const SEVERITY: Record<Suggestion, number> = { review: 1, request_doc: 2, reject: 3 };

/**
 * The per-row primary action (B6). All passed: approve. Otherwise the most
 * serious thing a check asked for. A conflict always opens for review — it is
 * never one button.
 */
export function rowAction(kind: QueueKind, checks: readonly Check[]): RowAction {
  if (kind === "conflict") return "review";
  if (allPassed(checks)) return "approve";
  let worst: Suggestion = "review";
  for (const check of checks) {
    if (check.suggests && SEVERITY[check.suggests] > SEVERITY[worst]) worst = check.suggests;
  }
  return worst;
}

/** The colour of a row's check column: the worst outcome in it. */
export function worstOutcome(checks: readonly Check[]): CheckOutcome {
  if (checks.some((check) => check.outcome === "fail")) return "fail";
  if (checks.some((check) => check.outcome === "warn")) return "warn";
  return "pass";
}

/** Failures first, then warnings, then passes: what to look at, in order. */
export function orderedChecks(checks: readonly Check[]): Check[] {
  const rank: Record<CheckOutcome, number> = { fail: 0, warn: 1, pass: 2 };
  return [...checks].sort((a, b) => rank[a.outcome] - rank[b.outcome]);
}

/** Licence digits, for the duplicate lookup the loader runs. */
export { licenceDigits };
