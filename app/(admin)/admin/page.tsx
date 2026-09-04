import Link from "next/link";
import { Card } from "@/components/structure";
import { ADMIN_NAV } from "@/components/structure/nav-config";
import { requireStaff } from "@/lib/auth/staff";
import { consoleOverview, SLA_DAYS, visibleTo, type ConsoleMetric } from "@/lib/console/overview";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../_shell";

/**
 * Board 4a — the console in one screen.
 *
 * Six panels, one per job, answering "which of these is behind" without
 * scrolling. Age before volume throughout: the number that decides whether a
 * queue is healthy is how long its oldest row has been sitting, not how many
 * rows there are.
 *
 * **Every number is a link into the queue that fixes it — once that queue
 * exists.** A metric whose screen is still `later` in `ADMIN_NAV` renders as
 * plain text with the same "soon" mark the sidebar uses, so this page cannot
 * grow the dozen dead links the seller sidebar grew in handoff 1. Nothing here
 * needs editing when a step lands: dropping `later` from the nav row turns the
 * number into a link on its own.
 *
 * A metric with a `null` count says "not measurable yet" rather than zero. Zero
 * on a queue means the work is done; on a queue that does not exist it is a
 * lie, and it is the specific lie a console must never tell.
 */

export const dynamic = "force-dynamic";

const LATER_HREFS = new Set(
  ADMIN_NAV.flatMap((group) => group.items.filter((item) => item.later).map((item) => item.key)),
);

function Metric({ metric }: { metric: ConsoleMetric }) {
  const unbuilt = LATER_HREFS.has(metric.navKey);
  const label = t(metric.labelKey as never);

  if (metric.count === null) {
    return (
      <li className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
        <span className="text-body-sm text-muted">{label}</span>
        <span className="text-caption text-faint" title={t("admin.overview.not_yet_hint")}>
          {t("admin.overview.not_yet")}
        </span>
      </li>
    );
  }

  const late = metric.late ?? 0;
  const number = (
    <span
      className={cn(
        "font-mono text-h3 tabular-nums",
        late > 0 ? "text-bad-ink" : "text-ink",
      )}
    >
      {formatCount(metric.count)}
    </span>
  );

  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 first:border-t-0">
      <span className="min-w-0 text-body-sm text-body">
        {unbuilt ? (
          <>
            {label}{" "}
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.overview.soon")}
            </span>
          </>
        ) : (
          <Link
            href={metric.href}
            className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {label}
          </Link>
        )}
      </span>

      <span className="flex shrink-0 items-baseline gap-2">
        {/* Age first, because age is what decides whether the count matters. */}
        {metric.oldestDays !== null && (
          <span className="font-mono text-eyebrow tabular-nums text-muted">
            {t("admin.overview.oldest", { days: String(metric.oldestDays) })}
          </span>
        )}
        {late > 0 && (
          <span className="rounded-chip bg-bad-surface px-1.5 py-px font-mono text-eyebrow uppercase text-bad-ink">
            {t("admin.overview.late", { count: formatCount(late) })}
          </span>
        )}
        {number}
      </span>
    </li>
  );
}

export default async function AdminOverviewPage() {
  const seat = await requireStaff();
  const [all, badges] = await Promise.all([consoleOverview(), getAdminNavBadges(seat)]);
  /*
   * Filtered to what this seat may open. §07 puts `revenue.read` with finance
   * and gives ops lead a dash, so the past-due count linked an ops lead
   * straight into a 404 until the overview started reading the same capability
   * the sidebar does.
   */
  const jobs = visibleTo(all, seat.actor);

  /*
   * The headline counts queues only. "94 waiting" that includes 24 unclaimed
   * listings and 28 products without specs is a number that means nothing —
   * those are the size of the opportunity, not a backlog anybody is behind on.
   */
  const queues = jobs.flatMap((job) => job.metrics).filter((m) => m.isQueue);
  const waiting = queues.reduce((sum, m) => sum + (m.count ?? 0), 0);
  const late = queues.reduce((sum, m) => sum + (m.late ?? 0), 0);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin"
      title={t("admin.overview.title")}
      eyebrow={t("admin.overview.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {late > 0
            ? t("admin.overview.meta", {
                late: formatCount(late),
                waiting: formatCount(waiting),
              })
            : t("admin.overview.all_clear")}
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] md:grid-cols-2 xl:grid-cols-3">
        {jobs.map((job) => (
          <Card key={job.key}>
            <h2 className="text-body-sm font-medium text-ink">{t(job.labelKey as never)}</h2>
            {job.metrics.length === 0 ? (
              /*
                The panel stays. The six jobs are what the platform has to do,
                not what this reader has to do, and dropping one would tell an
                ops lead the money looks after itself.
              */
              <p className="mt-2 text-caption text-muted">{t("admin.overview.not_yours")}</p>
            ) : (
              <ul className="mt-2">
                {job.metrics.map((metric) => (
                  <Metric key={metric.key} metric={metric} />
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>

      <div className="mt-[var(--gutter)]">
        <p className="max-w-prose text-caption text-muted">
          {t("admin.overview.sla", {
            moderation: String(SLA_DAYS.moderation),
            claim: String(SLA_DAYS.claim),
            report: String(SLA_DAYS.report),
            dunning: String(SLA_DAYS.dunning),
          })}
        </p>
      </div>
    </AdminPage>
  );
}
