import "server-only";
import { areaMatrix } from "@/lib/content/matrix";
import { driftQueue, reauditQueue } from "@/lib/seo/curated/compliance";
import { overdueGuides } from "@/lib/guides/service";

/**
 * Board 6f §7 — the five obligations, in one place.
 *
 * Three specs were written against "the editorial queue on 6f" before 6f had
 * one. `6b` needs a re-audit queue and a ranking-drift queue; `6d` needs an
 * overdue regulatory re-check queue. Two of them existed as queries with no
 * caller, which is the same as not existing.
 *
 * Every row is `count · condition · owner · action`, and every queue links
 * somewhere a person can work. A queue with no owner is not a queue, and a
 * count with no link is a number that makes somebody go and look.
 */

export type QueueKey =
  | "awaiting_copy"
  | "thin_copy"
  | "list_reaudit"
  | "list_drift"
  | "guide_overdue";

/**
 * Who works each queue.
 *
 * A role, not a name. A person's name in a constant is a claim about who is
 * employed here that nothing verifies and that costs a deploy to correct — and
 * it would be wrong on the screen the whole time in between.
 */
export const QUEUE_OWNER: Record<QueueKey, "content_ops" | "editorial"> = {
  awaiting_copy: "content_ops",
  thin_copy: "content_ops",
  list_reaudit: "editorial",
  list_drift: "editorial",
  guide_overdue: "editorial",
};

export interface QueueRow {
  /** What the row is about, as a person would say it. */
  label: string;
  /** The condition, in the numbers behind it. */
  detail: string;
  /** Where the work is done. Every row opens something. */
  href: string;
}

export interface Queue {
  key: QueueKey;
  count: number;
  /** The first few, so the card is a queue and not a number. */
  rows: QueueRow[];
}

const PREVIEW = 5;

export async function contentQueues(now = new Date()): Promise<Queue[]> {
  const [matrix, reaudit, drift, guides] = await Promise.all([
    // The whole filtered set, because these are counts of the world rather
    // than of one page of it.
    areaMatrix({ perPage: Number.MAX_SAFE_INTEGER }, now),
    reauditQueue(now),
    driftQueue(),
    overdueGuides(now),
  ]);

  const awaitingCopy = matrix.rows.filter((row) => row.status === "queued_copy");
  const thinCopy = matrix.rows.filter((row) => row.status === "live_thin_copy");

  return [
    {
      key: "awaiting_copy",
      count: awaitingCopy.length,
      rows: awaitingCopy.slice(0, PREVIEW).map((row) => ({
        label: row.path,
        detail: `${row.listings} listings, ${row.introWords} words`,
        href: `/admin/content/matrix?category=${row.categoryId}&emirate=${row.emirate}`,
      })),
    },
    {
      key: "thin_copy",
      count: thinCopy.length,
      rows: thinCopy.slice(0, PREVIEW).map((row) => ({
        label: row.path,
        detail: `${row.introWords} of ${row.minIntroWords} words`,
        href: `/admin/content/matrix?category=${row.categoryId}&emirate=${row.emirate}`,
      })),
    },
    {
      key: "list_reaudit",
      count: reaudit.length,
      rows: reaudit.slice(0, PREVIEW).map((row) => ({
        label: row.title,
        detail:
          row.state === "unpublished"
            ? `Taken down, ${row.openDrift} outstanding`
            : `Due ${row.dueAt.toISOString().slice(0, 10)}`,
        href: `/best/${row.slug}`,
      })),
    },
    {
      key: "list_drift",
      count: drift.length,
      rows: drift.slice(0, PREVIEW).map((row) => ({
        // `displayName`, always. A curated list linking to a storefront under a
        // different name is the buyer reading one name and landing on another.
        label: `${row.listTitle} — ${row.displayName}`,
        detail: `${row.criterion}: ${row.snapshotValue} when written, ${row.liveValue} now`,
        href: `/best/${row.listSlug}`,
      })),
    },
    {
      key: "guide_overdue",
      count: guides.length,
      rows: guides.slice(0, PREVIEW).map((row) => ({
        label: row.title,
        detail: row.checkedAt
          ? `Last checked ${row.checkedAt.toISOString().slice(0, 10)}`
          : "Never checked",
        href: `/admin/content/guides`,
      })),
    },
  ];
}
