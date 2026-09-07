import Link from "next/link";
import { notFound } from "next/navigation";
import { KeyValuePanel, Panel } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { submissionFor } from "@/lib/moderation/service";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import { DecisionForm } from "../DecisionForm";
import { approve, reject } from "../actions";

/**
 * Board 4c — one submission, and the decision.
 *
 * The screen puts three things in front of the buttons, in this order:
 *
 *   1. **The diff.** What it says now, what the seller wants it to say. A
 *      category change stores ids, so both sides are resolved to names — a
 *      moderator cannot review `cm3x9…` against `cm4a2…`.
 *   2. **How long it has waited**, and whether that is past the service level.
 *   3. **How many buyers are waiting on this listing.** Board 4c's own
 *      argument, and the reason this is a decision worth making today: a
 *      listing under review is still receiving enquiries, and the person
 *      answering them is looking at a trade name they have asked us to change.
 *
 * The reason field sits above the buttons rather than in a modal after them.
 * A confirm dialog that asks for a reason after the decision teaches people to
 * type something to get past it.
 */

export const dynamic = "force-dynamic";

export default async function ReviewSubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "queue.decide")) notFound();

  const { id } = await params;
  const [submission, badges] = await Promise.all([
    submissionFor(id),
    getAdminNavBadges(seat),
  ]);
  if (!submission) notFound();

  const ageDays = submission.ageDays;
  const decided = submission.status !== "pending";

  // A category change stores ids. Resolve both sides, or the diff is unreadable.
  let from = submission.beforeValue;
  let to: string = submission.afterValue;
  if (submission.field === "primary_category" || submission.field === "additional_category") {
    const ids = [submission.beforeValue, submission.afterValue].filter(
      (v): v is string => v !== null,
    );
    const categories = await prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const name = new Map(categories.map((c) => [c.id, c.name]));
    from = submission.beforeValue ? (name.get(submission.beforeValue) ?? submission.beforeValue) : null;
    to = name.get(submission.afterValue) ?? submission.afterValue;
  }

  const nextSlug =
    submission.field === "trade_name"
      ? submission.afterValue
          .toLowerCase()
          .normalize("NFKD")
          .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
          .replace(/^-+|-+$/g, "")
      : null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/queue"
      title={submission.business.displayName}
      eyebrow={t("admin.review.eyebrow")}
      breadcrumb={
        <Link
          href="/admin/queue"
          className="rounded-tag text-caption text-muted underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("admin.review.back")}
        </Link>
      }
      meta={
        <span className="flex flex-wrap items-center gap-3 text-caption text-muted">
          <span>
            {t("admin.review.submitted_by", {
              name: submission.actor.fullName ?? "—",
              days: String(ageDays),
            })}
          </span>
          {/*
            The real cost of the delay, next to the decision rather than in a
            report. A listing under review keeps receiving enquiries.
          */}
          <span className={submission.buyersWaiting > 0 ? "text-warn-ink" : undefined}>
            {submission.buyersWaiting > 0
              ? t("admin.review.buyers_waiting", {
                  count: formatCount(submission.buyersWaiting),
                })
              : t("admin.review.no_buyers_waiting")}
          </span>
        </span>
      }
    >
      <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
        <Panel title={t("admin.review.change_heading")}>
          <KeyValuePanel
            columns={1}
            notProvidedLabel={t("table.not_provided")}
            entries={[
              {
                key: "field",
                label: t("admin.queue.col.what"),
                value: t(`admin.queue.field.${submission.field}` as never),
              },
              {
                key: "from",
                label: t("admin.queue.col.from"),
                ...(from ? { value: from } : {}),
                mono: submission.field === "licence",
              },
              {
                key: "to",
                label: t("admin.queue.col.to"),
                value: to,
                mono: submission.field === "licence",
              },
            ]}
          />
        </Panel>

        <Panel title={t("admin.review.decision_heading")}>
          {decided ? (
            <div className="flex flex-col gap-2">
              <StatusBadge tone={submission.status === "approved" ? "ok" : "bad"}>
                {submission.status}
              </StatusBadge>
              <p className="max-w-prose text-body-sm text-body">{submission.decisionReason}</p>
              <p className="text-caption text-muted">
                {t("admin.review.decided", {
                  days: String(submission.decidedDaysAgo ?? 0),
                  name: submission.decidedBy?.fullName ?? "—",
                })}
              </p>
            </div>
          ) : (
            <DecisionForm
              requestId={submission.id}
              approve={approve}
              reject={reject}
              {...(nextSlug && nextSlug !== submission.business.slug
                ? { note: t("admin.review.slug_note", { slug: nextSlug }) }
                : {})}
            />
          )}
        </Panel>
      </div>

      {submission.field === "licence" && !decided && (
        <div className="mt-[var(--gutter)]">
          <Alert tone="warn" fix={t("admin.review.licence_fix")}>
            {t("admin.review.licence_warning")}
          </Alert>
        </div>
      )}
    </AdminPage>
  );
}
