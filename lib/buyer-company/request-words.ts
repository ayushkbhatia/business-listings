import { formatAED, formatDate, formatList } from "@/lib/format";
import { feeOnBasis } from "@/lib/quote/proposal-words";
import { t } from "@/lib/i18n";
import type { ApprovalReason } from "./authority";
import type { LapseReason, RequestCard, RequestState } from "./queue";
import { reasonLine } from "./words";

/**
 * Board `7b` — a request for approval, in the sentences every screen shows it
 * with: the company card, the approvals page, the request itself and the
 * notice on the compare page. Worded once, from the same card.
 *
 * Pure apart from `t()`; it imports only a type from the read module.
 */

export interface RequestView {
  id: string;
  href: string;
  /** *Al Waha — 3 lines, AED 15,624*. */
  summary: string;
  /** *RAISED BY P. MENON · PO-2026-0418*, in mono. */
  raised: string;
  reasons: string[];
  /** Where it stands, in a sentence. */
  stateLine: string;
  stateTone: "ok" | "warn" | "bad" | "info" | "neutral";
  stateLabel: string;
  note: string | null;
  decisionNote: string | null;
  answer: string | null;
  canApprove: boolean;
  canQuery: boolean;
  canAnswer: boolean;
  canWithdraw: boolean;
  /** For the confirm dialog: what approving does, in full. */
  approveBody: string;
  supplierName: string;
  quoteRef: string;
}

/** `P. MENON`, as the board's mono line prints a colleague. */
function initialled(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]![0]}. ${parts.slice(1).join(" ")}`;
}

export function amountWords(card: Pick<RequestCard, "valueAed" | "proposal">): string {
  if (card.proposal) return card.valueAed === null ? feeOnBasis(card.proposal) : formatAED(card.valueAed);
  return card.valueAed === null ? t("company.approval.no_total") : formatAED(card.valueAed);
}

export function summaryOf(card: RequestCard): string {
  if (card.proposal) {
    return t("company.request.summary_proposal", { supplier: card.supplierName, amount: amountWords(card) });
  }
  return t("company.request.summary", {
    supplier: card.supplierName,
    count: card.lineCount,
    formatted: String(card.lineCount),
    amount: amountWords(card),
  });
}

const LAPSE_KEY: Record<LapseReason, string> = {
  accepted: "company.request.lapsed.accepted",
  enquiry_closed: "company.request.lapsed.enquiry_closed",
  quote_expired: "company.request.lapsed.quote_expired",
  not_open: "company.request.lapsed.not_open",
  revised: "company.request.lapsed.revised",
  supplier_closed: "company.request.lapsed.supplier_closed",
};

function stateOf(card: RequestCard): Pick<RequestView, "stateLine" | "stateTone" | "stateLabel"> {
  const state: RequestState = card.state;
  switch (state.kind) {
    case "pending":
      return {
        stateLabel: t("company.request.state.pending"),
        stateTone: "warn",
        stateLine:
          card.approverNames.length > 0
            ? t("company.request.waiting_on", { names: formatList(card.approverNames) })
            : t("company.request.waiting_on_nobody"),
      };
    case "queried":
      return {
        stateLabel: t("company.request.state.queried"),
        stateTone: "info",
        stateLine: t("company.request.queried_by", {
          name: card.decidedByName ?? t("company.approval.a_colleague"),
          date: card.decidedAt ? formatDate(card.decidedAt) : "",
        }),
      };
    case "lapsed":
      return {
        stateLabel: t("company.request.state.lapsed"),
        stateTone: "neutral",
        stateLine: t(LAPSE_KEY[state.reason] as "company.request.lapsed.accepted"),
      };
    case "approved":
      return {
        stateLabel: t("company.request.state.approved"),
        stateTone: "ok",
        stateLine: t("company.request.approved_by", {
          name: card.decidedByName ?? t("company.approval.a_colleague"),
          date: card.decidedAt ? formatDate(card.decidedAt) : "",
        }),
      };
    case "withdrawn":
      return { stateLabel: t("company.request.state.withdrawn"), stateTone: "neutral", stateLine: t("company.request.withdrawn") };
    case "superseded":
      return { stateLabel: t("company.request.state.superseded"), stateTone: "neutral", stateLine: t("company.request.superseded") };
  }
}

export function requestView(
  card: RequestCard,
  context: { thresholdAed: number | null; raiserLimit: { usedAed: string; limitAed: number } | null; viewerIsAdmin: boolean },
): RequestView {
  const raisedParts = [t("company.request.raised_by", { name: initialled(card.raiserName) })];
  if (card.poNumber) raisedParts.push(card.poNumber);
  if (card.costCode) raisedParts.push(card.costCode);
  const open = card.state.kind === "pending" || card.state.kind === "queried";
  return {
    id: card.id,
    href: `/account/company/approvals/${card.id}`,
    summary: summaryOf(card),
    raised: raisedParts.join(" · "),
    reasons: card.reasons.map((reason: ApprovalReason) =>
      reasonLine(reason, {
        thresholdAed: context.thresholdAed,
        raiserName: card.raiserName,
        usedAed: context.raiserLimit?.usedAed ?? null,
        limitAed: context.raiserLimit?.limitAed ?? null,
      }),
    ),
    ...stateOf(card),
    note: card.note,
    decisionNote: card.decisionNote,
    answer: card.answer,
    canApprove: card.viewerMayApprove && card.state.kind === "pending",
    canQuery: card.state.kind === "pending" && !card.viewerIsRaiser && (card.viewerMayApprove || context.viewerIsAdmin),
    canAnswer: card.viewerIsRaiser && card.state.kind === "queried",
    canWithdraw: card.viewerIsRaiser && open,
    approveBody: t("company.request.approve_body", {
      raiser: card.raiserName,
      quote: card.quoteRef,
      supplier: card.supplierName,
      amount: amountWords(card),
    }),
    supplierName: card.supplierName,
    quoteRef: card.quoteRef,
  };
}
