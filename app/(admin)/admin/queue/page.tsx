import Link from "next/link";
import { notFound } from "next/navigation";
import { ChipLink, StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { queueStaff } from "@/lib/moderation/decide";
import { loadQueue, queueHealth } from "@/lib/moderation/queue";
import { isQueueKind, QUEUE_KINDS, type QueueKind } from "@/lib/moderation/rules";
import { formatCount, formatDuration, formatPercent, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { bulkDecide, decideRef } from "./actions";
import { ApprovalQueue } from "./ApprovalQueue";
import { boardRows } from "./board";
import { queueHref, queueQuery } from "./position";

/**
 * Board 4b — the approval queue.
 *
 * Everything a seller asserts lands here before it reaches the directory:
 * claims, profile edits, category changes, branches outside a licence,
 * credentials and conflicts. The board's thesis is one sentence at its foot —
 * *62% of this queue passed every automated check* — and everything above it
 * follows: every row carries its checks, the bulk action is bounded by them,
 * and the per-row action differs by what they found.
 *
 * Every figure on the screen is counted off one array (B4): the chips, the
 * over-SLA badge, the pass rate and the rows. `?kind=` narrows to a chip,
 * `?mine=1` to rows assigned to the person reading, and the order — over SLA,
 * then oldest — survives both (B9).
 *
 * `queue.decide` is moderator or ops lead; any other staff seat gets a 404.
 */

export const dynamic = "force-dynamic";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; mine?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const query = await searchParams;
  const kind: QueueKind | null = query.kind && isQueueKind(query.kind) ? query.kind : null;
  const mine = query.mine === "1";
  const now = new Date();

  const [view, health, staff, badges] = await Promise.all([
    loadQueue({ kind, assigneeId: mine ? seat.actor.id : null }, now),
    queueHealth(now),
    queueStaff(),
    getAdminNavBadges(seat),
  ]);

  const rows = boardRows(view.rows, { canResolveConflicts: can(seat.actor, "claim.resolve"), now, query: queueQuery({ kind, mine }) });
  const wholeQueue = view.all.length;
  const passRate = wholeQueue === 0 ? 0 : view.passing / wholeQueue;
  const first = view.rows.find((row) => row.kind !== "conflict" || can(seat.actor, "claim.resolve"));

  const empty =
    wholeQueue === 0 ? (
      <div className="text-center">
        <p className="text-body-sm text-body">{t("admin.queue.empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
          {health.medianMs !== null && health.lastDecidedAt
            ? t("admin.queue.empty_board.body", {
                time: formatDuration(health.medianMs),
                when: formatRelative(health.lastDecidedAt, { now }),
              })
            : t("admin.queue.empty_board.body_none")}
        </p>
      </div>
    ) : mine && view.total === 0 ? (
      <div className="text-center">
        <p className="text-body-sm text-body">{t("admin.queue.mine_empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
          {t("admin.queue.mine_empty.body", { count: wholeQueue, n: formatCount(wholeQueue) })}
        </p>
        <Link href={queueHref({ kind })} className="mt-2 inline-block text-caption text-moss underline underline-offset-2">
          {t("admin.queue.mine_empty.back")}
        </Link>
      </div>
    ) : (
      <div className="text-center">
        <p className="text-body-sm text-body">{t("admin.queue.kind_empty.title")}</p>
        <Link href={queueHref({ mine })} className="mt-2 inline-block text-caption text-moss underline underline-offset-2">
          {t("admin.queue.kind_empty.back")}
        </Link>
      </div>
    );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={t("admin.queue.title")}
      eyebrow={t("admin.queue.eyebrow")}
      meta={
        <span className="flex flex-wrap items-center gap-3 text-body-sm text-body">
          {view.overSla > 0 && (
            <StatusBadge tone="bad">{t("admin.queue.over_sla", { count: view.overSla, n: formatCount(view.overSla) })}</StatusBadge>
          )}
          <span>
            {health.medianMs !== null
              ? t("admin.queue.median", { time: formatDuration(health.medianMs) })
              : t("admin.queue.median_none")}
          </span>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={queueHref({ kind, mine: !mine })}
            aria-current={mine ? "true" : undefined}
            className={buttonClassName({ variant: "secondary" })}
          >
            {mine ? t("admin.queue.all_submissions") : t("admin.queue.assigned_to_me")}
          </Link>
          {first && (
            <Link href={`${first.href}${queueQuery({ kind, mine, triage: true })}`} className={buttonClassName()}>
              {t("admin.queue.start_triage")}
            </Link>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
          <nav aria-label={t("admin.queue.chips_label")} className="flex flex-wrap items-center gap-2">
            <ChipLink href={queueHref({ mine })} selected={kind === null}>
              {t("admin.queue.chip.all", { n: formatCount(view.total) })}
            </ChipLink>
            {QUEUE_KINDS.map((key) => (
              <ChipLink
                key={key}
                href={queueHref({ kind: key, mine })}
                selected={kind === key}
                tone={key === "conflict" && view.counts.conflict > 0 ? "bad" : "default"}
              >
                {t(`admin.queue.chip.${key}`, { n: formatCount(view.counts[key]) })}
              </ChipLink>
            ))}
          </nav>
          <span className="text-body-sm text-muted">{t("admin.queue.sort")}</span>
        </div>

        <ApprovalQueue
          rows={rows}
          staff={staff.map((person) => ({ id: person.id, name: person.name ?? person.id }))}
          empty={empty}
          decide={decideRef}
          bulk={bulkDecide}
        />

        {wholeQueue > 0 && (
          <section
            aria-label={t("admin.queue.pass_rate", { percent: formatPercent(passRate) })}
            className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-card px-5 py-4"
          >
            <p className="max-w-prose text-body-sm text-body">
              <strong className="font-medium text-ink">{t("admin.queue.pass_rate", { percent: formatPercent(passRate) })}</strong>{" "}
              {t("admin.queue.pass_rate_body")}{" "}
              <span className="text-muted">
                {t("admin.queue.pass_rate_count", { count: wholeQueue, n: formatCount(wholeQueue), passing: formatCount(view.passing) })}
              </span>
            </p>
            {can(seat.actor, "queue.rules") && (
              <Link
                href="/admin/queue/rules"
                className="rounded-tag text-body-sm text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("admin.queue.tune")}
              </Link>
            )}
          </section>
        )}
      </div>
    </AdminPage>
  );
}
