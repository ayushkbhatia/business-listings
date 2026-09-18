import { formatAED } from "@/lib/format";
import { formatTRN } from "@/lib/format/trn";
import { t } from "@/lib/i18n";
import { isBuyerCompanyRole } from "./authority";
import { roleLabel } from "./words";

/**
 * Board `7b` `B8` — one line of the company's history, as a sentence and the
 * values it changed.
 *
 * The rows are written by the services with names and refs beside the ids, so
 * this reads the row and nothing else: a history that had to join back to a
 * live address or member to say what happened would stop saying it the day
 * that row changed.
 */

export interface HistoryEntry {
  kind: string;
  actorName: string;
  before: unknown;
  after: unknown;
  note: string | null;
}

export interface HistoryWords {
  sentence: string;
  /** *TRN — was …, now …*. Empty when the sentence says it all. */
  changes: string[];
  /** A quoted note — a query, an answer — shown under the line. */
  quote: string | null;
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

const DETAIL_LABEL: Record<string, string> = {
  name: "company.details.name",
  trn: "company.details.trn",
  licenceNumber: "company.details.licence",
  accountsEmail: "company.details.accounts_email",
};

function detailValue(field: string, value: unknown): string {
  const text = str(value);
  if (text === null) return t("company.history.empty_value");
  return field === "trn" ? formatTRN(text) : text;
}

function roleWords(value: unknown): string {
  const role = str(value);
  return role && isBuyerCompanyRole(role) ? roleLabel(role) : t("company.history.empty_value");
}

function thresholdWords(value: unknown): string {
  return typeof value === "number" ? formatAED(value) : t("company.history.no_threshold");
}

const FLAG_LABEL: Record<string, string> = {
  requirePoNumber: "company.flag.po",
  requireCostCode: "company.flag.cost_code",
  unverifiedNeedsApproval: "company.flag.unverified",
  tellAdminsOffPlatform: "company.flag.off_platform",
};

export function historyWords(entry: HistoryEntry): HistoryWords {
  const actor = entry.actorName;
  const before = obj(entry.before);
  const after = obj(entry.after);
  const plain = (sentence: string): HistoryWords => ({ sentence, changes: [], quote: null });

  switch (entry.kind) {
    case "company_created":
      return plain(t("company.history.company_created", { actor }));
    case "details_changed":
      return {
        sentence: t("company.history.details_changed", { actor }),
        changes: Object.keys(after).map((field) =>
          t("company.history.change", {
            field: t((DETAIL_LABEL[field] ?? "company.details.name") as "company.details.name"),
            was: detailValue(field, before[field]),
            now: detailValue(field, after[field]),
          }),
        ),
        quote: null,
      };
    case "address_added":
      return plain(t("company.history.address_added", { actor, label: entry.note ?? "" }));
    case "address_changed":
      return plain(t("company.history.address_changed", { actor, label: entry.note ?? "" }));
    case "address_archived":
      return plain(t("company.history.address_archived", { actor, label: entry.note ?? "" }));
    case "default_address_changed":
      return plain(t("company.history.default_address_changed", { actor, label: entry.note ?? "" }));
    case "member_invited":
      return plain(
        t("company.history.member_invited", {
          actor,
          name: str(after["fullName"]) ?? "",
          email: str(after["email"]) ?? "",
          role: roleWords(after["role"]),
        }),
      );
    case "invite_resent":
      return plain(t("company.history.invite_resent", { actor, email: str(after["email"]) ?? "" }));
    case "invite_revoked":
      return plain(t("company.history.invite_revoked", { actor, email: str(before["email"]) ?? "" }));
    case "member_joined":
      return plain(t("company.history.member_joined", { actor, role: roleWords(after["role"]) }));
    case "member_changed":
      return {
        sentence: t("company.history.member_changed", { actor, name: entry.note ?? "" }),
        changes: [
          t("company.history.change", {
            field: t("company.team.role"),
            was: roleWords(before["role"]),
            now: roleWords(after["role"]),
          }),
          ...(before["monthlyLimitAed"] !== after["monthlyLimitAed"]
            ? [
                t("company.history.change", {
                  field: t("company.team.limit"),
                  was: typeof before["monthlyLimitAed"] === "number" ? formatAED(before["monthlyLimitAed"]) : t("company.history.empty_value"),
                  now: typeof after["monthlyLimitAed"] === "number" ? formatAED(after["monthlyLimitAed"]) : t("company.history.empty_value"),
                }),
              ]
            : []),
        ],
        quote: null,
      };
    case "member_deactivated":
      return plain(
        entry.note === "left"
          ? t("company.history.member_left", { actor })
          : t("company.history.member_deactivated", { actor, name: entry.note ?? "" }),
      );
    case "rule_changed": {
      const flag = Object.keys(after).find((key) => key in FLAG_LABEL);
      if (flag) {
        return plain(
          t(after[flag] ? "company.history.flag_on" : "company.history.flag_off", {
            actor,
            flag: t(FLAG_LABEL[flag] as "company.flag.po"),
          }),
        );
      }
      const changes: string[] = [];
      if (before["approvalThresholdAed"] !== after["approvalThresholdAed"]) {
        changes.push(
          t("company.history.change", {
            field: t("company.rule.threshold_label"),
            was: thresholdWords(before["approvalThresholdAed"]),
            now: thresholdWords(after["approvalThresholdAed"]),
          }),
        );
      }
      if (before["approverId"] !== after["approverId"]) {
        changes.push(
          t("company.history.change", {
            field: t("company.rule.approver_label"),
            was: str(before["approverName"]) ?? t("company.rule.approver_any_admin"),
            now: str(after["approverName"]) ?? t("company.rule.approver_any_admin"),
          }),
        );
      }
      return { sentence: t("company.history.rule_changed", { actor }), changes, quote: null };
    }
    case "approval_requested":
      return {
        sentence: t("company.history.approval_requested", { actor, quote: str(after["quoteRef"]) ?? "" }),
        changes: [],
        quote: entry.note,
      };
    case "approval_approved":
      return plain(t("company.history.approval_approved", { actor, quote: str(after["quoteRef"]) ?? "" }));
    case "approval_queried":
      return {
        sentence: t("company.history.approval_queried", { actor, quote: str(after["quoteRef"]) ?? "" }),
        changes: [],
        quote: entry.note,
      };
    case "approval_answered":
      return {
        sentence: t("company.history.approval_answered", { actor, quote: str(after["quoteRef"]) ?? "" }),
        changes: [],
        quote: entry.note,
      };
    case "approval_withdrawn": {
      const why = str(after["why"]);
      const quote = str(after["quoteRef"]) ?? "";
      if (why === "member_left") return plain(t("company.history.approval_closed_left", { quote }));
      if (why === "accepted_another") return plain(t("company.history.approval_closed_accepted", { quote }));
      if (why === "replaced") return plain(t("company.history.approval_closed_replaced", { actor, quote }));
      if (why?.startsWith("lapsed:")) return plain(t("company.history.approval_lapsed", { quote }));
      return plain(t("company.history.approval_withdrawn", { actor, quote }));
    }
    case "quote_accepted":
      return plain(t("company.history.quote_accepted", { actor, quote: str(after["quoteRef"]) ?? "" }));
    default:
      return plain(t("company.history.unknown", { actor }));
  }
}
