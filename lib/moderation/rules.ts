/**
 * Board 4b — the automated checks a submission is read against, and the lines
 * an ops lead may move.
 *
 * Pure. The queue, the tuning preview and the tests all read this, and none of
 * them may disagree about which rules exist or what a setting means.
 *
 * ## What "tuning" is allowed to do
 *
 * Switch a rule off, and move three thresholds. It is not allowed to turn a
 * check into a hard block (Q3 — a person can approve anything, and a failed
 * check is a reason to look, not a lock), and two rules cannot be switched off
 * at all: a claim on a business that is closing, and two claims on one
 * listing. Switching either off would let bulk approve decide who owns a
 * company, which is the one call this queue must never make without a person.
 */

export type QueueKind = "claim" | "profile_edit" | "category_change" | "locations" | "credential" | "conflict";

/** The chip order, which is the order the board draws them in. */
export const QUEUE_KINDS: readonly QueueKind[] = [
  "claim",
  "profile_edit",
  "category_change",
  "locations",
  "credential",
  "conflict",
];

export function isQueueKind(value: string): value is QueueKind {
  return (QUEUE_KINDS as readonly string[]).includes(value);
}

export type RuleId =
  | "licence_current"
  | "document_type"
  | "licence_number"
  | "scan_agrees"
  | "scan_confidence"
  | "phone_on_record"
  | "callback"
  | "business_closing"
  | "banned_terms"
  | "licensed_name"
  | "address_free"
  | "licence_format"
  | "no_duplicate"
  | "category_fits"
  | "trade_kind"
  | "branch_emirate"
  | "credential_name"
  | "credential_validity"
  | "two_claims"
  | "claim_evidence";

export interface RuleSpec {
  id: RuleId;
  kinds: readonly QueueKind[];
  /** False for the two rules no setting may switch off. */
  switchable: boolean;
}

export const RULES: readonly RuleSpec[] = [
  { id: "business_closing", kinds: ["claim"], switchable: false },
  { id: "licence_current", kinds: ["claim"], switchable: true },
  { id: "document_type", kinds: ["claim"], switchable: true },
  { id: "licence_number", kinds: ["claim"], switchable: true },
  { id: "scan_agrees", kinds: ["claim"], switchable: true },
  { id: "scan_confidence", kinds: ["claim"], switchable: true },
  { id: "phone_on_record", kinds: ["claim"], switchable: true },
  { id: "callback", kinds: ["claim"], switchable: true },
  { id: "banned_terms", kinds: ["profile_edit", "credential"], switchable: true },
  { id: "licensed_name", kinds: ["profile_edit"], switchable: true },
  { id: "address_free", kinds: ["profile_edit"], switchable: true },
  { id: "licence_format", kinds: ["profile_edit"], switchable: true },
  { id: "no_duplicate", kinds: ["profile_edit"], switchable: true },
  { id: "category_fits", kinds: ["category_change"], switchable: true },
  { id: "trade_kind", kinds: ["category_change"], switchable: true },
  { id: "branch_emirate", kinds: ["locations"], switchable: true },
  { id: "credential_name", kinds: ["credential"], switchable: true },
  { id: "credential_validity", kinds: ["credential"], switchable: true },
  { id: "two_claims", kinds: ["conflict"], switchable: false },
  { id: "claim_evidence", kinds: ["conflict"], switchable: true },
];

export const RULE_IDS: ReadonlySet<string> = new Set(RULES.map((rule) => rule.id));

export interface CheckRules {
  /** Rules not evaluated. Never contains an unswitchable rule. */
  disabled: RuleId[];
  /** A licence or credential expiring within this many days is a warning. */
  expiryWarnDays: number;
  /** A scan read under this confidence is a warning. 0..1. */
  scanConfidenceFloor: number;
  /** A renamed trade name keeping less than this share of the licensed name's words is a warning. 0..1. */
  nameSimilarityFloor: number;
  /** Words a trade name or credential name may not carry. Lower case. */
  bannedTerms: string[];
}

/**
 * The defaults.
 *
 * Thirty days of expiry notice matches the licence notice the seller side
 * already gives. The banned terms are claims a trade name cannot make on a
 * directory whose badge is the thing being claimed — an "official" or
 * "verified" supplier in a name is a verification tier nobody granted.
 */
export const DEFAULT_RULES: CheckRules = {
  disabled: [],
  expiryWarnDays: 30,
  scanConfidenceFloor: 0.5,
  nameSimilarityFloor: 0.5,
  bannedTerms: ["official", "government", "verified", "certified", "authorised", "authorized", "no. 1", "number one", "guaranteed", "best", "cheapest"],
};

export const RULES_SETTING_KEY = "queue.checks";

export const EXPIRY_WARN_MIN = 1;
export const EXPIRY_WARN_MAX = 180;
export const TERMS_MAX = 60;
export const TERM_MAX_LENGTH = 40;

export type RulesProblem =
  | "expiry_out_of_range"
  | "confidence_out_of_range"
  | "similarity_out_of_range"
  | "too_many_terms"
  | "term_too_long"
  | "unknown_rule"
  | "rule_not_switchable";

export function rulesProblem(rules: CheckRules): RulesProblem | null {
  if (!Number.isInteger(rules.expiryWarnDays) || rules.expiryWarnDays < EXPIRY_WARN_MIN || rules.expiryWarnDays > EXPIRY_WARN_MAX) {
    return "expiry_out_of_range";
  }
  if (!Number.isFinite(rules.scanConfidenceFloor) || rules.scanConfidenceFloor < 0 || rules.scanConfidenceFloor > 1) {
    return "confidence_out_of_range";
  }
  if (!Number.isFinite(rules.nameSimilarityFloor) || rules.nameSimilarityFloor < 0 || rules.nameSimilarityFloor > 1) {
    return "similarity_out_of_range";
  }
  if (rules.bannedTerms.length > TERMS_MAX) return "too_many_terms";
  if (rules.bannedTerms.some((term) => term.length > TERM_MAX_LENGTH)) return "term_too_long";
  for (const id of rules.disabled) {
    const spec = RULES.find((rule) => rule.id === id);
    if (!spec) return "unknown_rule";
    if (!spec.switchable) return "rule_not_switchable";
  }
  return null;
}

/** One term per line or comma, trimmed, lower-cased, de-duplicated, blanks dropped. */
export function parseTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\n,]/)) {
    const term = raw.trim().replace(/\s+/g, " ").toLowerCase();
    if (term) seen.add(term);
  }
  return [...seen];
}

/** A stored setting, read defensively: anything malformed falls back field by field. */
export function parseRules(value: unknown): CheckRules {
  if (!value || typeof value !== "object") return DEFAULT_RULES;
  const raw = value as Record<string, unknown>;
  const candidate: CheckRules = {
    disabled: Array.isArray(raw.disabled)
      ? (raw.disabled.filter((id): id is RuleId => typeof id === "string" && RULE_IDS.has(id)) as RuleId[])
      : DEFAULT_RULES.disabled,
    expiryWarnDays: typeof raw.expiryWarnDays === "number" ? raw.expiryWarnDays : DEFAULT_RULES.expiryWarnDays,
    scanConfidenceFloor:
      typeof raw.scanConfidenceFloor === "number" ? raw.scanConfidenceFloor : DEFAULT_RULES.scanConfidenceFloor,
    nameSimilarityFloor:
      typeof raw.nameSimilarityFloor === "number" ? raw.nameSimilarityFloor : DEFAULT_RULES.nameSimilarityFloor,
    bannedTerms: Array.isArray(raw.bannedTerms)
      ? parseTerms(raw.bannedTerms.filter((term): term is string => typeof term === "string").join("\n"))
      : DEFAULT_RULES.bannedTerms,
  };
  return rulesProblem(candidate) === null ? candidate : DEFAULT_RULES;
}

export function ruleEnabled(rules: CheckRules, id: RuleId): boolean {
  return !rules.disabled.includes(id);
}
