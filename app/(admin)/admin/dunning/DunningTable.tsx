"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import type { StepLine, StepTone } from "@/lib/billing/rail-copy";
import { DataTable, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Criterion 10, read from the far end.
 *
 * The stage column says where an account is; the next column says what happens
 * to it and when. Neither of them says "suspended", "unpublished" or "badge
 * removed", because the sequence cannot do any of those — the whole of what it
 * may do to an account is enumerated in `PERMITTED_ACCOUNT_EFFECTS` and it has
 * one entry.
 *
 * ## `DROPS TO FREE`, never `SUSPENDS`
 *
 * Board 12e correction 4. The board's column head was `SUSPENDS` — *in 4 days*,
 * *in 11 days*, *tomorrow* — and it is wrong twice. The policy is drop to Free
 * at D14, never delete a listing and never remove the verified badge, which is
 * what `12i`'s equivalent column says: *Plan changes to Free on 19 Sep*. And
 * suspension is a real and different action — `business.suspend`, ops-lead
 * only, audited, taken on `/admin/businesses`, honoured across storefronts,
 * search, product counts and metrics, with its own reason codes and appeal
 * path. A column head that names it points staff at a control this screen does
 * not have and must not have.
 */

export interface DunningRowView {
  subscriptionId: string;
  businessName: string;
  planName: string;
  stage: string;
  daysPastDue: number;
  next: string;
  attempts: number;
  /** `AED 313.95`, VAT included, already formatted. Null where nothing was charged. */
  amount: string | null;
  /** What the provider said. Null where nothing was tried. */
  reason: string | null;
  /** `in 4 days`, or the date beyond a week. Null once it has dropped. */
  drops: string | null;
  /** The full date, as the title on a relative figure. Null once it has dropped. */
  dropsTitle: string | null;
  /** P-07's column. Null until a notice step has run. */
  lastNotice: { label: string; tone: StepTone; meta: string; templateHref: string | null } | null;
  /** The five steps, in the words board 3m shows the seller. */
  steps: StepLine[];
  /** Set where the seller cancelled while past due. */
  cancelled: string | null;
  /** Changes plan within 72 hours with nothing delivered: first, with a bad rule. */
  urgent: boolean;
}

const STEP_TEXT: Record<StepTone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-body",
};

/**
 * Stage tones.
 *
 * A dropped account is `neutral`, not `bad`. It is on Free, its listing is
 * live, and painting it red would say something happened to the listing.
 */
const TONE: Record<string, "neutral" | "warn" | "bad" | "ok"> = {
  none: "warn",
  retry: "warn",
  emailed: "warn",
  messaged: "bad",
  final: "bad",
  dropped: "neutral",
};

export function DunningTable({ rows }: { rows: readonly DunningRowView[] }) {
  const columns: Column<DunningRowView>[] = [
    {
      key: "business",
      header: t("admin.dunning.col.business"),
      render: (row) => row.businessName,
    },
    {
      key: "plan",
      header: t("admin.dunning.col.plan"),
      width: "7rem",
      hideBelow: "lg",
      render: (row) => row.planName,
    },
    {
      /*
         The one inclusive figure on either of these two screens, and the head
         says so. Plan prices are quoted ex-VAT everywhere else (`B3`); a failed
         payment is what the card was asked for and refused, which is a total.
      */
      key: "amount",
      header: t("admin.dunning.col.amount"),
      numeric: true,
      width: "9rem",
      render: (row) =>
        row.amount === null ? (
          <span className="text-faint">{t("admin.dunning.no_attempts")}</span>
        ) : (
          <span className="font-mono tabular-nums">{row.amount}</span>
        ),
    },
    {
      key: "reason",
      header: t("admin.dunning.col.reason"),
      hideBelow: "md",
      render: (row) =>
        row.reason === null ? (
          <span className="text-faint">{t("admin.dunning.no_reason")}</span>
        ) : (
          <span className="text-body">{row.reason}</span>
        ),
    },
    {
      key: "stage",
      header: t("admin.dunning.col.stage"),
      width: "10rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.stage] ?? "neutral"}>
          {t(`admin.dunning.stage.${row.stage}` as never)}
        </StatusBadge>
      ),
    },
    {
      key: "days",
      header: t("admin.dunning.col.days"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) => formatCount(row.daysPastDue),
    },
    {
      key: "next",
      header: t("admin.dunning.col.next"),
      hideBelow: "md",
      // Muted only on a plain row: on the urgent row's bad surface `text-muted` is 4.17:1.
      render: (row) => <span className={row.urgent ? undefined : "text-muted"}>{row.cancelled ?? row.next}</span>,
    },
    {
      /*
         T9.4 — "did we tell them?". The badge is the delivery log's answer for
         the newest notice step; the disclosure under it is every step, in the
         words the seller reads on board 3m. A `<details>` rather than an
         expanding row: one native control, keyboard-reachable, nothing for a
         screen reader to guess.
      */
      key: "notice",
      header: t("admin.dunning.col.notice"),
      width: "16rem",
      render: (row) => (
        <div className="flex flex-col gap-1">
          {row.lastNotice ? (
            <>
              <StatusBadge tone={row.lastNotice.tone}>{row.lastNotice.label}</StatusBadge>
              <span className={cn("text-caption", !row.urgent && "text-muted")}>{row.lastNotice.meta}</span>
              {row.lastNotice.templateHref ? (
                <Link href={row.lastNotice.templateHref} className="text-caption text-moss underline underline-offset-2">
                  {t("admin.dunning.notice.template_link")}
                </Link>
              ) : null}
            </>
          ) : (
            <span className="text-faint">{t("admin.dunning.notice.none")}</span>
          )}
          <details className="mt-1 text-caption">
            <summary className="cursor-pointer text-moss underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus">
              {t("admin.dunning.sequence_toggle", { business: row.businessName })}
            </summary>
            <ol className="mt-2 flex flex-col gap-1.5">
              {row.steps.map((step) => (
                <li key={step.key}>
                  <span className="block font-mono text-muted">{step.label}</span>
                  <span className={cn("block", STEP_TEXT[step.tone])}>{step.text}</span>
                </li>
              ))}
            </ol>
          </details>
        </div>
      ),
    },
    {
      key: "drops",
      header: t("admin.dunning.col.drops"),
      width: "9rem",
      render: (row) =>
        row.drops === null ? (
          <span className="text-faint">{t("admin.dunning.already_dropped")}</span>
        ) : (
          <span className="text-warn-ink" title={row.dropsTitle ?? undefined}>
            {row.drops}
          </span>
        ),
    },
    {
      key: "attempts",
      header: t("admin.dunning.col.attempts"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) =>
        row.attempts === 0 ? (
          <span className="text-faint">{t("admin.dunning.no_attempts")}</span>
        ) : (
          t("admin.dunning.attempts", { count: formatCount(row.attempts) })
        ),
    },
  ];

  return (
    <DataTable
      caption={t("admin.dunning.caption")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.subscriptionId}
      rowTone={(row) => (row.urgent ? "blocked" : "default")}
      stickyHeader
      empty={
        <div className="text-center">
          <p className="text-body-sm text-body">{t("admin.dunning.empty.title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
            {t("admin.dunning.empty.body")}
          </p>
        </div>
      }
    />
  );
}
