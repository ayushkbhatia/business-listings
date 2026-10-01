import Link from "next/link";
import { StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { Actor } from "@/lib/auth/roles";
import { loadQueue } from "@/lib/moderation/queue";
import { isQueueKind, type QueueKind } from "@/lib/moderation/rules";
import { QueueKeys } from "./QueueKeys";

/**
 * Where a submission sits in the queue, said on its own screen.
 *
 * Board 4b §Flagged 2: `4c` read *4 of 318* for the submission the queue sorts
 * first, because it counted a subset it did not name. This counts the same
 * list, in the same order, under the filter the reviewer arrived with — and
 * names the filter. In a triage session it also offers the next submission, so
 * working the queue is one screen after another rather than back and forth.
 */

export interface QueueParams {
  kind?: string;
  mine?: string;
  /** Board 4a: only the rows past their service level. */
  overdue?: string;
  triage?: string;
}

export interface QueueQueryOptions {
  kind?: QueueKind | null;
  mine?: boolean;
  overdue?: boolean;
  triage?: boolean;
}

export function queueQuery({ kind, mine, overdue, triage }: QueueQueryOptions): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (mine) params.set("mine", "1");
  if (overdue) params.set("overdue", "1");
  if (triage) params.set("triage", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function queueHref(options: QueueQueryOptions): string {
  return `/admin/queue${queueQuery(options)}`;
}

export async function QueuePosition({
  actor,
  subject,
  params,
  skip = false,
}: {
  actor: Actor;
  subject: string;
  params: QueueParams;
  /**
   * Board 4c-s. `Skip` on every screen rather than only in a triage session:
   * the next submission in the same list, with nothing written and nothing
   * assigned. A lookup that takes seconds should not need a session to move on.
   */
  skip?: boolean;
}) {
  const kind = params.kind && isQueueKind(params.kind) ? params.kind : null;
  const mine = params.mine === "1";
  const overdue = params.overdue === "1";
  const triage = params.triage === "1";
  const view = await loadQueue({ kind, assigneeId: mine ? actor.id : null, overdue });
  /*
     The same list the queue shows, in the same order, so the position is
     checkable against it (board 4c criterion 11: `1 of 318` under All,
     Conflicts and Assigned to me alike). Every seat that can see a row can open
     it — a moderator opens a conflict to hand it to an ops lead (B1) — so
     nothing is filtered out of the count.
  */
  const workable = view.rows;
  const index = workable.findIndex((row) => row.ref === subject);
  const next = workable.find((row, position) => row.ref !== subject && (index === -1 || position > index)) ?? null;
  const previous = index > 0 ? workable[index - 1]! : null;
  const query = queueQuery({ kind, mine, overdue, triage });
  /*
     Board 4c B15, the shell every review screen shares: the kind and how long
     it has waited, red once it is past the kind's service level — or the word
     escalated, whose clock is paused (Q5).
  */
  const entry = view.all.find((row) => row.ref === subject) ?? null;
  const kindChip = entry
    ? entry.escalated
      ? t("admin.review.kind_escalated", { kind: t(`admin.queue.type.${entry.kind}`) })
      : t("admin.review.kind_age", { kind: t(`admin.queue.type.${entry.kind}`), age: formatDuration(entry.waitingMs) })
    : null;

  const scope = [
    kind ? t(`admin.queue.type.${kind}`) : t("admin.queue.position.everything"),
    ...(overdue ? [t("admin.queue.position.overdue")] : []),
    ...(mine ? [t("admin.queue.assigned_to_me")] : []),
  ].join(" · ");

  return (
    <nav aria-label={t("admin.queue.position.label")} className="flex flex-wrap items-center gap-3 text-caption text-muted">
      <QueueKeys previous={previous ? `${previous.href}${query}` : null} next={next ? `${next.href}${query}` : null} />
      {kindChip && (
        <StatusBadge tone={entry!.late ? "bad" : entry!.escalated ? "warn" : "neutral"} shape="chip">
          {kindChip}
        </StatusBadge>
      )}
      <Link href={queueHref({ kind, mine, overdue })} className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
        {t("admin.review.back")}
      </Link>
      <span>
        {index === -1
          ? t("admin.queue.position.left", { scope })
          : t("admin.queue.position.of", { position: formatCount(index + 1), total: formatCount(workable.length), scope })}
      </span>
      {(triage || skip) && next && (
        <Link href={`${next.href}${query}`} className={buttonClassName({ size: "sm", variant: "secondary" })}>
          {t(skip && index !== -1 ? "admin.queue.position.skip" : "admin.queue.position.next")}
        </Link>
      )}
      {(triage || skip) && !next && <span>{t("admin.queue.position.done")}</span>}
      {(previous || next) && <span className="text-body">{t("admin.queue.position.keys")}</span>}
    </nav>
  );
}
