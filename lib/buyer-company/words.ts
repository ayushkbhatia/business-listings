import { formatAED } from "@/lib/format";
import { formatTime } from "@/lib/format/time";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import type { ApprovalReason, BuyerCompanyRole } from "./authority";
import type { DeliveryConstraints, LoadLimit } from "./address";

/**
 * Board `7b` — every sentence the company account says about its own rule,
 * worded once.
 *
 * `B2`: *the rule text renders from the configured values — threshold,
 * approver, PO and cost-code flags. Never a hand-written string that can drift
 * from the settings under it.* So the card, the accept screen and the approval
 * page all call this, with the figures the gate itself reads.
 *
 * `B3`: *state every routing rule that can hold an approval.* Each reason in
 * `authority.ts` that can apply to this company has a sentence here, and
 * *nobody approves their own request* is always one of them.
 */

export interface RuleFacts {
  thresholdAed: number | null;
  /** The named approver's name, or null for *an admin*. */
  approverName: string | null;
  unverifiedNeedsApproval: boolean;
  requirePoNumber: boolean;
  requireCostCode: boolean;
  /** Anyone on the team, active or invited, holds the role. */
  hasProcurement: boolean;
  hasRequesters: boolean;
  /** The named approver has nobody to approve their own held requests. */
  approverHasNoCover: boolean;
}

export interface RuleSentences {
  /** The threshold, or its absence. The sentence the card leads with. */
  lead: string;
  /** Every other routing rule that applies, in the order a reader needs them. */
  rest: string[];
  /** The gap the rule leaves, stated — or null when there is none. */
  gap: string | null;
}

function approverWords(name: string | null): string {
  return name ?? t("company.rule.an_admin");
}

export function ruleSentences(facts: RuleFacts): RuleSentences {
  const approver = approverWords(facts.approverName);
  const lead =
    facts.thresholdAed !== null
      ? t("company.rule.threshold", { amount: formatAED(facts.thresholdAed), approver })
      : t("company.rule.no_threshold");

  const rest: string[] = [];
  if (facts.hasProcurement) rest.push(t("company.rule.procurement"));
  if (facts.hasRequesters) rest.push(t("company.rule.requesters"));
  if (facts.unverifiedNeedsApproval) rest.push(t("company.rule.unverified", { approver }));
  if (facts.thresholdAed !== null || facts.hasProcurement || facts.hasRequesters) {
    rest.push(t("company.rule.no_total"));
  }
  if (facts.requirePoNumber && facts.requireCostCode) rest.push(t("company.rule.po_and_cost_code"));
  else if (facts.requirePoNumber) rest.push(t("company.rule.po"));
  else if (facts.requireCostCode) rest.push(t("company.rule.cost_code"));
  rest.push(t("company.rule.not_own"));

  const gap =
    facts.approverHasNoCover && facts.approverName
      ? t("company.rule.gap", { approver: facts.approverName })
      : null;

  return { lead, rest, gap };
}

export function roleLabel(role: BuyerCompanyRole): string {
  return t(`company.role.${role}` as "company.role.company_admin");
}

/** The *Can approve up to* column. */
export function authorityLabel(role: BuyerCompanyRole, monthlyLimitAed: number | null): string {
  if (role === "company_admin") return t("company.authority.unlimited");
  if (role === "requester" || monthlyLimitAed === null) return t("company.authority.none");
  return t("company.authority.monthly", { amount: formatAED(monthlyLimitAed) });
}

export interface ReasonContext {
  thresholdAed: number | null;
  raiserName: string;
  /** Procurement's month before this request, when the reason is the limit. */
  usedAed: string | null;
  limitAed: number | null;
}

/** One line per reason, for the approver and the raiser. */
export function reasonLine(reason: ApprovalReason, context: ReasonContext): string {
  switch (reason) {
    case "over_threshold":
      return context.thresholdAed !== null
        ? t("company.reason.over_threshold", { amount: formatAED(context.thresholdAed) })
        : t("company.reason.over_threshold_removed");
    case "over_limit":
      return context.usedAed !== null && context.limitAed !== null
        ? t("company.reason.over_limit", {
            name: context.raiserName,
            used: formatAED(context.usedAed),
            limit: formatAED(context.limitAed),
          })
        : t("company.reason.over_limit_plain", { name: context.raiserName });
    case "no_authority":
      return t("company.reason.no_authority", { name: context.raiserName });
    case "unverified_supplier":
      return t("company.reason.unverified_supplier");
    case "no_total":
      return t("company.reason.no_total");
  }
}

export function loadLimitLabel(limit: LoadLimit): string {
  return t(`company.address.load.${limit}` as "company.address.load.small_parcels");
}

/**
 * *Loading bay access 07:00–17:00*, *Deliveries before 11:00*. Null when the
 * address states no hours.
 */
export function accessLine(
  constraints: Pick<DeliveryConstraints, "accessPoint" | "accessFrom" | "accessUntil">,
): string | null {
  const { accessPoint, accessFrom, accessUntil } = constraints;
  if (accessFrom === null && accessUntil === null) return null;
  const from = accessFrom === null ? "" : formatTime(accessFrom);
  const until = accessUntil === null ? "" : formatTime(accessUntil);
  const shape = accessFrom !== null && accessUntil !== null ? "window" : accessUntil !== null ? "before" : "after";
  return accessPoint
    ? t(`company.address.point_${shape}` as "company.address.point_window", { point: accessPoint, from, until })
    : t(`company.address.deliveries_${shape}` as "company.address.deliveries_window", { from, until });
}

/** *Al Barsha, Dubai* — or the emirate alone. */
export function placeLine(constraints: Pick<DeliveryConstraints, "emirate" | "areaName">): string {
  const emirate = EMIRATES.find((e) => e.value === constraints.emirate)?.label ?? constraints.emirate;
  return constraints.areaName ? t("company.address.place", { area: constraints.areaName, emirate }) : emirate;
}

/** Everything a recipient is told about delivery before acceptance, as short phrases. */
export function constraintPhrases(constraints: DeliveryConstraints): string[] {
  const phrases = [placeLine(constraints)];
  const access = accessLine(constraints);
  if (access) phrases.push(access);
  if (constraints.loadLimit) phrases.push(loadLimitLabel(constraints.loadLimit));
  return phrases;
}
