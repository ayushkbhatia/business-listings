import type { CredentialRejectReason } from "@/lib/db/generated/enums";
import { licenceDigits, nameSimilarity } from "@/lib/dedupe/similarity";
import { normaliseTaan } from "./fta";
import { isFresh, type RegisterFetch, type RegisterRecord } from "./register-fetch";

/**
 * What they submitted against what the register holds — board `4c-s`.
 *
 * Pure, and the only place the comparison is made. The review screen draws its
 * ticks from it, the queue row takes its checks from it, the service refuses a
 * verification with it, and the sweep decides whether the machine can settle a
 * credential with it — so "all three match" means one thing on the button, in
 * the row and in the transaction.
 *
 * ## Three fields and a join, never four fields
 *
 * The three that have to agree are the **agent number**, the **registered
 * name** and the **status**. Beneath them the trade licence the register names
 * is compared with the one on the listing — not a fourth field but the join,
 * confirming the register is describing *this* business and not a similarly
 * named one. The export corrected a button that counted three against a panel
 * that ticked four; `matched` counts the three and `entity` is reported apart,
 * so no screen can add them together by accident.
 *
 * ## What the submission is
 *
 * The agent number and the certificate's expiry are what the seller typed. The
 * name is the listing's **licensed trade name** — the one name on the platform
 * a register of legal entities could hold, and the one the seller cannot edit
 * outside moderation. Comparing the register with the display name would fail
 * every firm that trades under a shorter one.
 */

export interface Submitted {
  /** The agent number as the seller typed it. */
  identifier: string | null;
  /** `Business.tradeName`. */
  name: string;
  /** The expiry on the certificate, where the seller gave one. */
  expiresOn: Date | null;
  /** `Business.licenceNumber` and its authority. */
  licenceNumber: string;
  licenceAuthority: string;
}

export type NumberVerdict = "match" | "mismatch";
export type NameVerdict = "match" | "near" | "mismatch";
/** `contradicts`: active on the register, with a different date on the certificate. */
export type StatusVerdict = "match" | "lapsed" | "contradicts";
export type EntityVerdict = "same" | "different" | "unconfirmed";

export interface Word {
  text: string;
  /** In this name and not the other. */
  differs: boolean;
}

export interface FoundComparison {
  state: "found";
  fetch: Extract<RegisterFetch, { outcome: "found" }>;
  fresh: boolean;
  number: NumberVerdict;
  name: { verdict: NameVerdict; submitted: Word[]; register: Word[] };
  status: { verdict: StatusVerdict; certificateDay: string | null; registerDay: string | null };
  entity: EntityVerdict;
  /** Of the three fields — never the entity join. */
  matched: 0 | 1 | 2 | 3;
  /** All three match **and** the licence names the same entity. */
  allMatch: boolean;
}

export type Comparison =
  /** No agent number, or not the shape of one: nothing a register could be asked. */
  | { state: "no_number" }
  /** Never asked. */
  | { state: "no_read" }
  | { state: "unavailable"; fetch: Extract<RegisterFetch, { outcome: "unavailable" }>; fresh: boolean }
  | { state: "not_found"; fetch: Extract<RegisterFetch, { outcome: "not_found" }>; fresh: boolean }
  | FoundComparison;

/* ── Names ─────────────────────────────────────────────────────────────────── */

const LEGAL_FORMS: Record<string, string> = {
  "limited liability company": "llc",
  "free zone establishment": "fze",
  "free zone company": "fzco",
};

/**
 * A name reduced to what two registers would both print.
 *
 * Case, accents, punctuation and the spelling of the legal form: `Nexus Tax
 * Consultancy L.L.C.` and `Nexus Tax Consultancy LLC` are one name. Nothing
 * that carries meaning is dropped — "trading" and "general" stay, because
 * `Al Noor Trading` and `Al Noor General Trading` are two companies more often
 * than they are one, and deciding otherwise is the reviewer's call, not this
 * function's.
 */
export function canonicalName(value: string): string {
  let text = value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  for (const [long, short] of Object.entries(LEGAL_FORMS)) {
    text = text.replace(new RegExp(`\\b${long}\\b`, "g"), short);
  }
  // `l l c` → `llc`: a run of single letters is one abbreviation, dotted.
  const tokens: string[] = [];
  let run = "";
  for (const token of text.split(/\s+/).filter(Boolean)) {
    if (token.length === 1 && /\p{L}/u.test(token)) {
      run += token;
      continue;
    }
    if (run) tokens.push(run);
    run = "";
    tokens.push(token);
  }
  if (run) tokens.push(run);
  return tokens.join(" ");
}

/** A near-match keeps at least half of the identifying words. Below that, it is a different name. */
export const NEAR_NAME_FLOOR = 0.5;

export function compareNames(submitted: string, register: string): NameVerdict {
  if (canonicalName(submitted) === canonicalName(register)) return "match";
  return nameSimilarity(submitted, register) >= NEAR_NAME_FLOOR ? "near" : "mismatch";
}

/**
 * Which words differ, for the text-diff the near-match state draws.
 *
 * A longest-common-subsequence over canonical words, so the diff marks
 * `Advisory` against `Consultants` and leaves `Al Bayan Tax` alone — and marks
 * nothing at all on a pair that only differs in punctuation, which is a match.
 */
export function nameDiff(a: string, b: string): { a: Word[]; b: Word[] } {
  const left = a.trim().split(/\s+/).filter(Boolean);
  const right = b.trim().split(/\s+/).filter(Boolean);
  const key = (word: string) => canonicalName(word);
  const table: number[][] = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i]![j] =
        key(left[i]!) === key(right[j]!) ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const keptLeft = new Set<number>();
  const keptRight = new Set<number>();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (key(left[i]!) === key(right[j]!)) {
      keptLeft.add(i);
      keptRight.add(j);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return {
    // A word that canonicalises to nothing — a lone "&" — never counts as a difference.
    a: left.map((text, index) => ({ text, differs: !keptLeft.has(index) && key(text) !== "" })),
    b: right.map((text, index) => ({ text, differs: !keptRight.has(index) && key(text) !== "" })),
  };
}

/* ── Dates ─────────────────────────────────────────────────────────────────── */

/** The calendar day in Dubai, `yyyy-mm-dd`. A register's "valid until" is a local date. */
export function dubaiDay(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** A date input's day. Stored at UTC midnight by `8b-s`, so read in UTC. */
function certificateDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function statusOf(record: RegisterRecord, submitted: Submitted, now: Date): FoundComparison["status"] {
  const registerDay = record.validUntil;
  const certificate = submitted.expiresOn ? certificateDay(submitted.expiresOn) : null;
  const lapsed = record.status !== "active" || (registerDay !== null && registerDay < dubaiDay(now));
  if (lapsed) return { verdict: "lapsed", certificateDay: certificate, registerDay };
  if (certificate !== null && registerDay !== null && certificate !== registerDay) {
    return { verdict: "contradicts", certificateDay: certificate, registerDay };
  }
  return { verdict: "match", certificateDay: certificate, registerDay };
}

function entityOf(record: RegisterRecord, submitted: Submitted): EntityVerdict {
  const licence = record.tradeLicence;
  if (!licence) return "unconfirmed";
  if (licence.authority && licence.authority.trim().toUpperCase() !== submitted.licenceAuthority.trim().toUpperCase()) {
    return "different";
  }
  const theirs = licenceDigits(licence.number);
  return theirs !== "" && theirs === licenceDigits(submitted.licenceNumber) ? "same" : "different";
}

/* ── The comparison ────────────────────────────────────────────────────────── */

export function compareCredential(submitted: Submitted, fetch: RegisterFetch | null, now: Date): Comparison {
  const asked = submitted.identifier === null ? null : normaliseTaan(submitted.identifier);
  if (asked === null) return { state: "no_number" };
  // A read of a number the seller has since changed is not a read of this credential.
  if (fetch === null || fetch.asked !== asked) return { state: "no_read" };

  const fresh = isFresh(fetch, now);
  if (fetch.outcome === "unavailable") return { state: "unavailable", fetch, fresh };
  if (fetch.outcome === "not_found") return { state: "not_found", fetch, fresh };

  const record = fetch.record;
  const number: NumberVerdict = normaliseTaan(record.taan) === asked ? "match" : "mismatch";
  const verdict = compareNames(submitted.name, record.name);
  const diff = verdict === "match" ? null : nameDiff(submitted.name, record.name);
  const name = {
    verdict,
    submitted: diff?.a ?? submitted.name.split(/\s+/).map((text) => ({ text, differs: false })),
    register: diff?.b ?? record.name.split(/\s+/).map((text) => ({ text, differs: false })),
  };
  const status = statusOf(record, submitted, now);
  const entity = entityOf(record, submitted);
  const matched = [number === "match", verdict === "match", status.verdict === "match"].filter(Boolean).length as 0 | 1 | 2 | 3;

  return {
    state: "found",
    fetch,
    fresh,
    number,
    name,
    status,
    entity,
    matched,
    allMatch: matched === 3 && entity === "same",
  };
}

/* ── What a person may do about it ─────────────────────────────────────────── */

/**
 * B3. Verify only against a fresh read where all three match and the licence
 * names the same entity. A disagreement on any of them replaces the button with
 * the mismatch path; nobody ticks through one.
 */
export function mayVerify(comparison: Comparison): boolean {
  return comparison.state === "found" && comparison.fresh && comparison.allMatch;
}

/**
 * Whether anything may be decided at all. The register did not answer, or the
 * read is stale: a reviewer cannot decide against a panel that did not load, or
 * one that describes an hour ago.
 */
export function mayDecide(comparison: Comparison): boolean {
  return (comparison.state === "found" || comparison.state === "not_found") && comparison.fresh;
}

export const REJECT_REASONS: readonly CredentialRejectReason[] = [
  "not_on_register",
  "different_entity",
  "lapsed",
  "unreadable",
];

/**
 * The rejections the evidence supports. A reason the read contradicts is not
 * offered: "lapsed" against a register that says active is a sentence the
 * seller would take to the FTA and be told is untrue.
 *
 * `unreadable` is about the certificate, not the register, so it needs a file.
 */
export function supportedReasons(comparison: Comparison, hasDocument: boolean): Set<CredentialRejectReason> {
  const reasons = new Set<CredentialRejectReason>();
  if (!mayDecide(comparison)) return reasons;
  if (hasDocument) reasons.add("unreadable");
  if (comparison.state === "not_found") {
    reasons.add("not_on_register");
    return reasons;
  }
  if (comparison.state !== "found") return reasons;
  if (comparison.number === "mismatch" || comparison.entity === "different" || comparison.name.verdict !== "match") {
    reasons.add("different_entity");
  }
  if (comparison.status.verdict === "lapsed") reasons.add("lapsed");
  return reasons;
}

/** The reason pre-selected on the reject form, where the read makes one plain. */
export function suggestedReason(comparison: Comparison): CredentialRejectReason | null {
  if (comparison.state === "not_found") return "not_on_register";
  if (comparison.state !== "found") return null;
  if (comparison.number === "mismatch" || comparison.entity === "different" || comparison.name.verdict === "mismatch") {
    return "different_entity";
  }
  if (comparison.status.verdict === "lapsed") return "lapsed";
  return null;
}
