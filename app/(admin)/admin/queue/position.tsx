import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { loadQueue } from "@/lib/moderation/queue";
import { isQueueKind, type QueueKind } from "@/lib/moderation/rules";

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
  triage?: string;
}

export function queueQuery({ kind, mine, triage }: { kind?: QueueKind | null; mine?: boolean; triage?: boolean }): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (mine) params.set("mine", "1");
  if (triage) params.set("triage", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function queueHref(options: { kind?: QueueKind | null; mine?: boolean; triage?: boolean }): string {
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
  const triage = params.triage === "1";
  const view = await loadQueue({ kind, assigneeId: mine ? actor.id : null });
  // A conflict is only a next step for a seat that may open one.
  const workable = view.rows.filter((row) => row.kind !== "conflict" || can(actor, "claim.resolve"));
  const index = workable.findIndex((row) => row.ref === subject);
  const next = workable.find((row, position) => row.ref !== subject && (index === -1 || position > index)) ?? null;
  const query = queueQuery({ kind, mine, triage });

  const scope = [
    kind ? t(`admin.queue.type.${kind}`) : t("admin.queue.position.everything"),
    ...(mine ? [t("admin.queue.assigned_to_me")] : []),
  ].join(" · ");

  return (
    <nav aria-label={t("admin.queue.position.label")} className="flex flex-wrap items-center gap-3 text-caption text-muted">
      <Link href={queueHref({ kind, mine })} className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
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
    </nav>
  );
}
