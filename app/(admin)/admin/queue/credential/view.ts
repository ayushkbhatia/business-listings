import type { CredentialRejectReason } from "@/lib/db/generated/enums";
import {
  dubaiDay,
  mayDecide,
  mayVerify,
  REJECT_REASONS,
  suggestedReason,
  supportedReasons,
  type Comparison,
  type Submitted,
  type Word,
} from "@/lib/credentials/compare";
import { formatBytes, formatClock, formatCount, formatDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `4c-s` — the review screen, as words.
 *
 * Pure and resolved on the server, so the comparison crosses into the client
 * decision form as strings and flags rather than as `t` or a formatter — the
 * repository's most repeated defect. The gallery builds its states through the
 * same function from the fixture register, so a state drawn there is a state
 * this screen can actually reach.
 */

export type Tone = "ok" | "warn" | "bad" | "neutral";

export interface Cell {
  /** Plain text, or a name with the words that differ marked. */
  text?: string;
  words?: Word[];
  mono?: boolean;
  /** Grey: nothing was provided, or nothing came back. */
  muted?: boolean;
}

export interface ComparisonRow {
  key: "number" | "name" | "status";
  field: string;
  submitted: Cell;
  register: Cell;
  result: { tone: Tone; label: string };
}

export interface ComparisonView {
  /** `FETCHED 09:14`, or null where nothing was read. */
  fetched: string | null;
  /** The three fields. Empty where the register gave no record to compare against. */
  rows: ComparisonRow[];
  /** The join, drawn apart from the three and never counted with them. */
  entity: { submitted: Cell; register: Cell; result: { tone: Tone; label: string } } | null;
  /** "3 of the three match", said once under the table. */
  tally: string | null;
  /** The state above the table where there is no record: unreachable, not found, never read, stale. */
  notice: { tone: "info" | "warn" | "bad"; body: string; fix?: string } | null;
  /** The read is missing, failed or stale, and a refetch is the only thing to do. */
  needsRefetch: boolean;
}

const RESULT: Record<string, { tone: Tone; key: string }> = {
  match: { tone: "ok", key: "admin.credential_review.result.match" },
  near: { tone: "warn", key: "admin.credential_review.result.near" },
  mismatch: { tone: "bad", key: "admin.credential_review.result.mismatch" },
  lapsed: { tone: "bad", key: "admin.credential_review.result.lapsed" },
  contradicts: { tone: "warn", key: "admin.credential_review.result.contradicts" },
  same: { tone: "ok", key: "admin.credential_review.result.same" },
  different: { tone: "bad", key: "admin.credential_review.result.different" },
  unconfirmed: { tone: "warn", key: "admin.credential_review.result.unconfirmed" },
};

function result(verdict: string) {
  const entry = RESULT[verdict]!;
  return { tone: entry.tone, label: t(entry.key as never) };
}

/** A register day, `yyyy-mm-dd`, as a date a person reads. */
function day(value: string): string {
  return formatDate(new Date(`${value}T08:00:00.000Z`));
}

/** When a read was taken: the clock today, the date and clock before that. */
export function fetchedAt(iso: string, now: Date): string {
  const at = new Date(iso);
  return dubaiDay(at) === dubaiDay(now) ? formatClock(at) : formatDateTime(at);
}

export function comparisonView(comparison: Comparison, submitted: Submitted, now: Date): ComparisonView {
  const certificate: Cell = submitted.expiresOn
    ? { text: formatDate(submitted.expiresOn) }
    : { text: t("admin.credential_review.submitted.no_expiry"), muted: true };
  const typed: Cell = submitted.identifier
    ? { text: submitted.identifier, mono: true }
    : { text: t("table.not_provided"), muted: true };

  switch (comparison.state) {
    case "no_number":
      return {
        fetched: null,
        rows: [],
        entity: null,
        tally: null,
        needsRefetch: false,
        notice: {
          tone: "warn",
          body: t("admin.credential_review.notice.no_number"),
          fix: t("admin.credential_review.notice.no_number_fix"),
        },
      };
    case "no_read":
      return {
        fetched: null,
        rows: [],
        entity: null,
        tally: null,
        needsRefetch: true,
        notice: { tone: "info", body: t("admin.credential_review.notice.not_read") },
      };
    case "unavailable":
      return {
        fetched: t("admin.credential_review.fetched", { when: fetchedAt(comparison.fetch.fetchedAt, now) }),
        rows: [],
        entity: null,
        tally: null,
        needsRefetch: true,
        notice: {
          tone: "bad",
          body: t("admin.credential_review.notice.unavailable", {
            when: fetchedAt(comparison.fetch.fetchedAt, now),
            cause: t(`admin.credential_review.cause.${comparison.fetch.cause}` as never),
          }),
          fix: t("admin.credential_review.notice.unavailable_fix"),
        },
      };
    case "not_found":
      return {
        fetched: t("admin.credential_review.fetched", { when: fetchedAt(comparison.fetch.fetchedAt, now) }),
        rows: [
          {
            key: "number",
            field: t("admin.credential_review.field.number"),
            submitted: typed,
            register: { text: t("admin.credential_review.register.not_held"), muted: true },
            result: result("mismatch"),
          },
        ],
        entity: null,
        tally: null,
        needsRefetch: !comparison.fresh,
        notice: comparison.fresh
          ? {
              tone: "bad",
              body: t("admin.credential_review.notice.not_found", { number: comparison.fetch.asked }),
              fix: t("admin.credential_review.notice.not_found_fix"),
            }
          : staleNotice(comparison.fetch.fetchedAt, now),
      };
    case "found": {
      const record = comparison.fetch.record;
      const registerStatus =
        record.status === "active"
          ? record.validUntil
            ? t("admin.credential_review.register.active_until", { date: day(record.validUntil) })
            : t("admin.credential_review.register.active")
          : record.validUntil
            ? t("admin.credential_review.register.status", {
                status: t(`admin.credential_review.status.${record.status}` as never),
                date: day(record.validUntil),
              })
            : t(`admin.credential_review.status.${record.status}` as never);
      const rows: ComparisonRow[] = [
        {
          key: "number",
          field: t("admin.credential_review.field.number"),
          submitted: typed,
          register: { text: record.taan, mono: true },
          result: result(comparison.number),
        },
        {
          key: "name",
          field: t("admin.credential_review.field.name"),
          submitted: comparison.name.verdict === "match" ? { text: submitted.name } : { words: comparison.name.submitted },
          register: comparison.name.verdict === "match" ? { text: record.name } : { words: comparison.name.register },
          result: result(comparison.name.verdict),
        },
        {
          key: "status",
          field: t("admin.credential_review.field.status"),
          submitted: certificate,
          register: { text: registerStatus },
          result: result(comparison.status.verdict),
        },
      ];
      return {
        fetched: t("admin.credential_review.fetched", { when: fetchedAt(comparison.fetch.fetchedAt, now) }),
        rows,
        entity: {
          submitted: { text: submitted.licenceNumber, mono: true },
          register: record.tradeLicence
            ? { text: record.tradeLicence.number, mono: true }
            : { text: t("admin.credential_review.register.no_licence"), muted: true },
          result: result(comparison.entity),
        },
        tally: t("admin.credential_review.tally", {
          count: comparison.matched,
          n: formatCount(comparison.matched),
        }),
        needsRefetch: !comparison.fresh,
        notice: comparison.fresh ? null : staleNotice(comparison.fetch.fetchedAt, now),
      };
    }
  }
}

function staleNotice(iso: string, now: Date): ComparisonView["notice"] {
  return {
    tone: "warn",
    body: t("admin.credential_review.notice.stale", { when: fetchedAt(iso, now) }),
    fix: t("admin.credential_review.notice.stale_fix"),
  };
}

export interface ReasonOption {
  value: CredentialRejectReason;
  label: string;
  supported: boolean;
}

export interface DecisionView {
  /** B3: a fresh read, all three, same entity. */
  canVerify: boolean;
  /** Anything at all: a fresh read the register answered. */
  canDecide: boolean;
  /** Said where the Verify button would be, when it is not. */
  verifyBlocked: string | null;
  reasons: ReasonOption[];
  suggested: CredentialRejectReason | null;
}

export function decisionView(comparison: Comparison, hasDocument: boolean): DecisionView {
  const supported = supportedReasons(comparison, hasDocument);
  let verifyBlocked: string | null = null;
  if (!mayDecide(comparison)) {
    verifyBlocked = t("admin.credential_review.decision.blocked_read");
  } else if (comparison.state === "not_found") {
    verifyBlocked = t("admin.credential_review.decision.blocked_not_found");
  } else if (comparison.state === "found" && !comparison.allMatch) {
    verifyBlocked =
      comparison.matched < 3
        ? t("admin.credential_review.decision.blocked_fields", { count: comparison.matched, n: formatCount(comparison.matched) })
        : comparison.entity === "different"
          ? t("admin.credential_review.decision.blocked_entity")
          : t("admin.credential_review.decision.blocked_unconfirmed");
  }
  return {
    canVerify: mayVerify(comparison),
    canDecide: mayDecide(comparison),
    verifyBlocked,
    reasons: REJECT_REASONS.map((value) => ({
      value,
      label: t(`admin.credential_review.reject.${value}` as never),
      supported: supported.has(value),
    })),
    suggested: suggestedReason(comparison),
  };
}

export interface CertificateView {
  label: string;
  href: string;
}

export function certificateView(
  document: { filename: string; bytes: number | null } | null,
  href: string,
): CertificateView | null {
  if (!document) return null;
  return {
    label: document.bytes
      ? t("admin.credential_review.document.file_size", { filename: document.filename, size: formatBytes(document.bytes) })
      : document.filename,
    href,
  };
}
