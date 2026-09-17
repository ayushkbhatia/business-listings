import Link from "next/link";
import { Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { formatCount, formatDuration, formatPercent } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DISPUTE_GROUNDS } from "@/lib/reviews/eligibility";
import { OUTCOME_BUCKETS, type OutcomesView } from "@/lib/reports/outcomes";
import type { incentiveFindings } from "@/lib/reports/service";

/**
 * Board 4h — the three panels beside the queue.
 *
 * Server components with no state. They are here rather than in `page.tsx`
 * because the page is already the longest file on this board and these are
 * self-contained; they take data and return markup.
 */

/**
 * The outcomes rail, which is the argument for the whole screen.
 *
 * *"Most reports end in a fix, not a punishment."* Four buckets rather than the
 * board's three: `duplicate` is where the second and third of three reports
 * about one telephone number land, and calling those *no action needed* would
 * be saying we looked and found nothing.
 *
 * Nothing renders when nothing has been decided. A rail of `0%` over a window
 * in which no decision was taken is four numbers that are all the same lie.
 */
export function OutcomesRail({ outcomes }: { outcomes: OutcomesView }) {
  if (outcomes.decided === 0 || !outcomes.shares) {
    return (
      <Panel title={t("admin.reports.outcomes.title", { days: String(outcomes.windowDays) })}>
        <p className="text-caption text-muted">
          {t("admin.reports.outcomes.none", { days: String(outcomes.windowDays) })}
        </p>
      </Panel>
    );
  }

  const shares = outcomes.shares;
  return (
    <Panel title={t("admin.reports.outcomes.title", { days: String(outcomes.windowDays) })}>
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          {t("admin.reports.outcomes.caption", {
            days: String(outcomes.windowDays),
            count: formatCount(outcomes.decided),
          })}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">{t("admin.reports.outcomes.col_outcome")}</th>
            <th scope="col">{t("admin.reports.outcomes.col_share")}</th>
          </tr>
        </thead>
        <tbody>
          {OUTCOME_BUCKETS.map((bucket) => (
            <tr key={bucket} className="border-b border-line last:border-b-0">
              <th scope="row" className="py-1.5 pr-3 text-left text-body-sm font-normal text-ink">
                {t(`admin.reports.outcome_long.${bucket}` as "admin.reports.outcome_long.upheld")}
              </th>
              <td className="py-1.5 text-right font-mono text-body-sm tabular-nums text-ink">
                {formatPercent(shares[bucket])}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-line pt-3">
        <span className="text-body-sm text-ink">{t("admin.reports.outcomes.median")}</span>
        <span className="font-mono text-body-sm tabular-nums text-ink">
          {outcomes.medianMs === null
            ? t("admin.reports.outcomes.median_none")
            : formatDuration(outcomes.medianMs)}
        </span>
      </div>

      <p className="mt-2 text-caption text-muted">
        {t("admin.reports.outcomes.note", { count: formatCount(outcomes.decided) })}
      </p>
      {outcomes.fromDisputes > 0 && (
        /*
           The mapping, stated rather than left to be inferred from a total that
           does not add up: a queue that decides two row shapes and reports on
           one of them is describing part of the morning.
        */
        <p className="mt-1 text-caption text-muted">
          {t("admin.reports.outcomes.disputes_note", {
            count: formatCount(outcomes.fromDisputes),
          })}
        </p>
      )}
    </Panel>
  );
}

/**
 * The review-integrity rules — `B1`.
 *
 * *"The rail lists exactly the grounds the dispute flow accepts."* Four, read
 * from `DISPUTE_GROUNDS` rather than typed here, which is the cheapest way to
 * keep `11c`'s acceptance criterion 6 true in both directions: a ground added
 * to the flow appears here, and one removed disappears.
 *
 * The board's rail said *abuse, privacy or proven falsehood* — three, and the
 * one it dropped, `no traceable enquiry`, is what its own second row turns on.
 * The exclusion is here too, because `11c` states it deliberately: *"it is
 * unfair" is not a ground.*
 */
export function IntegrityRail() {
  return (
    <Panel title={t("admin.reports.rules.title")}>
      <ul className="flex flex-col gap-2">
        {DISPUTE_GROUNDS.map((ground) => (
          <li key={ground} className="flex flex-col gap-0.5">
            <span className="text-body-sm text-ink">
              {t(`moderation.ground.${ground}` as "moderation.ground.abuse")}
            </span>
            <span className="text-caption text-muted">
              {t(`admin.reports.rules.ground.${ground}` as "admin.reports.rules.ground.abuse")}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-line pt-3 text-body-sm text-body">
        {t("admin.reports.rules.not_a_ground")}
      </p>
      <p className="mt-2 text-caption text-muted">{t("admin.reports.rules.audit")}</p>
      <Link
        href="/admin/audit?action=review_removed"
        className="mt-2 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
      >
        {t("admin.reports.rules.audit_link")}
      </Link>
    </Panel>
  );
}

/**
 * Board 11c `B6`, readable here as `B9` asks.
 *
 * *"The incentivised-review log — one record per finding, against the account,
 * readable in 4h. Without it the sentence is a bluff."* The sentence is the one
 * on every review request: *an incentivised review is removed and logged
 * against your account.*
 *
 * Read-only. The finding is written on `/admin/reviews`, where the review it is
 * about is, and a second place to write one would be a second record of the
 * same decision.
 */
export function IncentiveLogRail({
  log,
  mayWrite,
}: {
  log: Awaited<ReturnType<typeof incentiveFindings>>;
  /** `review.remove` — ops lead. Only they can open the screen that writes one. */
  mayWrite: boolean;
}) {
  return (
    <Panel
      title={t("admin.reports.incentives.title")}
      description={t("admin.reports.incentives.description")}
    >
      {log.rows.length === 0 ? (
        <p className="text-caption text-muted">{t("admin.reports.incentives.none")}</p>
      ) : (
        <ul className="flex flex-col">
          {log.rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex flex-col gap-0.5 border-t border-line py-2 first:border-t-0">
              <span className="flex flex-wrap items-baseline gap-2">
                <Link
                  href={`/b/${row.subjectBusiness.slug}/reviews`}
                  className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {row.subjectBusiness.displayName}
                </Link>
                <StatusBadge tone={row.review?.removedAt ? "bad" : "warn"} size="sm">
                  {row.review?.removedAt
                    ? t("admin.reports.incentives.removed")
                    : t("admin.reports.incentives.standing")}
                </StatusBadge>
              </span>
              <span className="text-caption text-muted">{row.detail}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The count only where there is something to count: "No findings on
          record" followed by "0 findings on record" is the same sentence twice. */}
      {log.total > 0 && (
        <p className="mt-2 text-caption text-muted">
          {t("admin.reports.incentives.count", { count: log.total, n: formatCount(log.total) })}
        </p>
      )}
      {mayWrite && (
        <Link
          href="/admin/reviews"
          className="mt-2 inline-block rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.reports.incentives.link")}
        </Link>
      )}
    </Panel>
  );
}
