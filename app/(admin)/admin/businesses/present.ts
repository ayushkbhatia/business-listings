import { formatAED, formatCount, formatDate, formatDuration, formatMonth, formatPercent } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { AccountRow } from "@/lib/accounts/list";
import { CHURN_RISK_BELOW, SLOW_REPLIES_BELOW, STATE_TONE, type AccountState } from "@/lib/accounts/health";
import type { RowTone } from "@/components/structure";
import type { AccountTableRow } from "./AccountsTable";

/**
 * Board 4f — an account row, in words.
 *
 * Shared by the list, the gallery and the account page, so "62% · 3 h 20" and
 * "Slow replies" read the same everywhere a business appears in the console.
 */

export function stateLabel(state: AccountState): string {
  return t(`admin.businesses.health.${state}` as MessageKey);
}

/** `96% · 54 min`. Measured; `n/a` for a listing nobody has claimed. */
export function replyText(row: Pick<AccountRow, "state" | "replyRate" | "medianMs">): string {
  if (row.state === "unclaimed" || row.state === "merged") return t("admin.businesses.reply.na");
  if (row.replyRate === null) return t("admin.businesses.reply.unmeasured");
  const rate = formatPercent(row.replyRate);
  return row.medianMs === null ? rate : t("admin.businesses.reply.rate_median", { rate, median: formatDuration(row.medianMs) });
}

export function replyTone(rate: number | null): AccountTableRow["replyTone"] {
  if (rate === null) return "muted";
  if (rate < CHURN_RISK_BELOW) return "bad";
  if (rate < SLOW_REPLIES_BELOW) return "warn";
  return "ok";
}

/** `1,204 products`, `6 services`, both for a seller of both. Q1: services read as services. */
export function catalogueText(row: Pick<AccountRow, "state" | "sellsKind" | "liveProducts" | "liveServices">): string | null {
  if (row.state === "unclaimed") return null;
  const products = t("admin.businesses.catalogue.products", { count: row.liveProducts, n: formatCount(row.liveProducts) });
  const services = t("admin.businesses.catalogue.services", { count: row.liveServices, n: formatCount(row.liveServices) });
  switch (row.sellsKind) {
    case "services":
      return services;
    case "both":
      return `${products} · ${services}`;
    case "goods":
      return products;
    default:
      // A seller who has not said which: show whichever they have, products first.
      return row.liveServices > 0 && row.liveProducts === 0 ? services : products;
  }
}

export function quotedText(quoted: AccountRow["quoted"]): string | null {
  const parts: string[] = [];
  if (quoted.quotes > 0) {
    // A sent quote whose lines total nothing is still a quote; "AED 0" would
    // read as nothing sent.
    parts.push(
      Number(quoted.goodsAed) > 0
        ? formatAED(quoted.goodsAed)
        : t("admin.businesses.quoted.quotes", { count: quoted.quotes, n: formatCount(quoted.quotes) }),
    );
  }
  if (quoted.proposals > 0) {
    parts.push(t("admin.businesses.quoted.proposals", { count: quoted.proposals, n: formatCount(quoted.proposals) }));
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function signalText(signal: AccountRow["upgradeSignal"]): string | null {
  if (!signal) return null;
  return t(`admin.businesses.signal.${signal.kind}` as MessageKey, { date: formatDate(signal.at) });
}

const ROW_TONE: Partial<Record<AccountState, RowTone>> = {
  churn_risk: "blocked",
  suspended: "blocked",
  slow_replies: "attention",
  closing: "attention",
};

export function toTableRow(row: AccountRow): AccountTableRow {
  const place = row.areaName ?? (row.emirate ? t(`emirate.${row.emirate}` as MessageKey) : null);
  const tail =
    row.state === "unclaimed"
      ? t("admin.businesses.subtitle.unclaimed")
      : row.claimedSince
        ? t("admin.businesses.subtitle.since", { month: formatMonth(row.claimedSince) })
        : null;
  return {
    id: row.id,
    displayName: row.displayName,
    subtitle: [row.licenceNumber, place, tail].filter(Boolean).join(" · "),
    plan: row.planId ? row.planId.toUpperCase() : null,
    tier: row.tier === null ? null : t("admin.businesses.tier_option", { tier: String(row.tier) }),
    catalogue: catalogueText(row),
    quoted: quotedText(row.quoted),
    reply: replyText(row),
    replyTone: row.state === "unclaimed" ? "muted" : replyTone(row.replyRate),
    healthLabel: stateLabel(row.state),
    healthTone: STATE_TONE[row.state],
    healthNote: row.state === "upgrade_candidate" ? signalText(row.upgradeSignal) : null,
    rowTone: ROW_TONE[row.state] ?? "default",
  };
}
