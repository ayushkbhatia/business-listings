import Link from "next/link";
import { ProgressBar, StatusBadge } from "@/components/display";
import { cn } from "@/lib/cn";
import { MIDDLE_DOT, formatCount, formatDate, formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RunOverview } from "@/lib/ingest/read";
import type { ActionResult } from "./actions";
import { DecisionBar } from "./DecisionBar";

/**
 * Board 12a — one run, as the board draws it.
 *
 * Four cards, a run panel, a rejection table and the decision bar. The cards
 * are the file's three outcome buckets and its size, and **they sum**: new
 * listings + possible duplicates + rejected = records in file, and the four
 * grounds in the table sum to the rejected card. "The stat cards are auditable
 * against the table beneath them, which is what makes this screen trustworthy
 * enough to approve a 6,104-row publish from."
 *
 * A server component. Everything it shows is counted in `runOverview`, and the
 * only client half is the decision bar, which holds dialogs.
 */

export const STATUS_TONE: Record<string, "ok" | "warn" | "bad" | "neutral" | "info"> = {
  parsing: "info",
  staged: "warn",
  approved: "ok",
  discarded: "neutral",
  rolled_back: "bad",
};

const n = (count: number) => ({ count, n: formatCount(count) });

export interface RunReviewProps {
  run: RunOverview;
  /** The page's own heading level decides this one: `h2` under a page `h1`. */
  headingId: string;
  publish: (formData: FormData) => Promise<ActionResult>;
  discard: (formData: FormData) => Promise<ActionResult>;
  rollback: (formData: FormData) => Promise<ActionResult>;
  reversibleDays: number;
  /** Links the run's number to its own page, where the index shows it. */
  linkToRun?: boolean;
}

function OutcomeCard({
  label,
  value,
  caption,
  tone = "default",
}: {
  label: string;
  value: number;
  caption: string;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  return (
    <div
      className={cn(
        "rounded-card border p-4",
        tone === "warn" && "border-warn-line bg-warn-surface",
        tone === "bad" && "border-bad-line bg-bad-surface",
        (tone === "default" || tone === "ok") && "border-line bg-card",
      )}
    >
      <dt
        className={cn(
          "text-caption",
          tone === "warn" ? "text-warn-ink" : tone === "bad" ? "text-bad-ink" : "text-body",
        )}
      >
        {label}
      </dt>
      {/* Sans: the handoff-4 README allows no serif anywhere in the console. */}
      <dd
        className={cn(
          "mt-1 text-h1 tabular-nums",
          tone === "ok" ? "text-ok-ink" : tone === "warn" ? "text-warn-ink" : tone === "bad" ? "text-bad-ink" : "text-ink",
        )}
      >
        {formatCount(value)}
      </dd>
      <dd className="mt-0.5 font-mono text-eyebrow text-body">{caption}</dd>
    </div>
  );
}

export function RunReview({
  run,
  headingId,
  publish,
  discard,
  rollback,
  reversibleDays,
  linkToRun = false,
}: RunReviewProps) {
  const rejectedTotal = run.byGround.reduce((sum, row) => sum + row.count, 0);
  const title = t("admin.run.title", { number: run.number, source: run.source });

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      <dl className="grid gap-[var(--gutter)] sm:grid-cols-2 xl:grid-cols-4">
        <OutcomeCard
          label={t("admin.run.card.file")}
          value={run.rowCount}
          caption={
            run.truncatedCount > 0
              ? t("admin.run.card.file_truncated", n(run.truncatedCount))
              : t("admin.run.card.file_whole")
          }
        />
        <OutcomeCard
          label={t("admin.run.card.new")}
          value={run.newListings}
          tone="ok"
          caption={t("admin.run.card.new_caption", {
            categorised: formatCount(run.categorised),
            queued: formatCount(run.queued),
          })}
        />
        <OutcomeCard
          label={t("admin.run.card.duplicates")}
          value={run.duplicates}
          tone="warn"
          caption={duplicatesCaption(run.pairs)}
        />
        <OutcomeCard
          label={t("admin.run.card.rejected")}
          value={run.rejected}
          tone="bad"
          caption={t("admin.run.card.rejected_caption")}
        />
      </dl>

      <section aria-labelledby={headingId} className="overflow-hidden rounded-card border border-line bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h2 id={headingId} className="text-h3 text-ink">
              {linkToRun ? (
                <Link
                  href={`/admin/ingest/${run.id}`}
                  className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </h2>
            <StatusBadge tone={STATUS_TONE[run.status] ?? "neutral"}>
              {t(`admin.ingest.status.${run.status as "staged"}`)}
            </StatusBadge>
          </div>
          <p className="font-mono text-eyebrow uppercase text-body">
            <span className="normal-case">{run.filename}</span>
            {" · "}
            {t("admin.run.uploaded", {
              date: formatDateTime(run.createdAt),
              name: run.uploadedBy ?? t("admin.run.someone"),
            })}
          </p>
        </header>

        <div className="flex flex-col gap-4 px-4 py-4">
          <ProgressBar
            label={t("admin.run.parsed")}
            value={run.rowCount}
            max={run.rowCount + run.truncatedCount}
            tone="ok"
            valueLabel={t("admin.run.fraction", {
              done: formatCount(run.rowCount),
              total: formatCount(run.rowCount + run.truncatedCount),
            })}
          />
          <div className="flex flex-col gap-1.5">
            <ProgressBar
              label={t("admin.run.matched")}
              value={run.categorised}
              max={run.newListings}
              tone={run.queued > 0 ? "warn" : "ok"}
              valueLabel={t("admin.run.fraction", {
                done: formatCount(run.categorised),
                total: formatCount(run.newListings),
              })}
            />
            {run.queued > 0 && (
              <p className="text-caption text-body">
                {t("admin.run.unmapped", n(run.queued))}{" "}
                {(run.status === "staged" || run.status === "approved") && (
                  <Link
                    href={`/admin/ingest/categorise?run=${run.id}`}
                    className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("admin.run.open_queue")}
                  </Link>
                )}
              </p>
            )}
          </div>
        </div>

        {/* B2: four fixed grounds, every one a row, and a total that is the card. */}
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full border-collapse text-body-sm">
            <caption className="sr-only">{t("admin.run.grounds")}</caption>
            <thead className="bg-paper-sunk">
              <tr>
                <th scope="col" className="px-4 py-2 text-start font-mono text-eyebrow uppercase text-body">
                  {t("admin.run.col.reason")}
                </th>
                <th scope="col" className="w-24 px-4 py-2 text-end font-mono text-eyebrow uppercase text-body">
                  {t("admin.run.col.count")}
                </th>
                <th scope="col" className="w-40 px-4 py-2 text-start font-mono text-eyebrow uppercase text-body">
                  {t("admin.run.col.action")}
                </th>
              </tr>
            </thead>
            <tbody>
              {run.byGround.map((row) => (
                <tr key={row.ground} className="border-t border-line">
                  <th scope="row" className="px-4 py-2 text-start font-normal text-ink">
                    {t(`admin.run.ground.${row.ground}`)}
                  </th>
                  <td className="px-4 py-2 text-end font-mono tabular-nums text-ink">
                    {formatCount(row.count)}
                  </td>
                  <td className="px-4 py-2 text-body">{t(`admin.run.action.${row.action}`)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line-strong">
                <th scope="row" className="px-4 py-2 text-start font-medium text-ink">
                  {t("admin.run.rejected_total")}
                </th>
                <td className="px-4 py-2 text-end font-mono font-medium tabular-nums text-ink">
                  {formatCount(rejectedTotal)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <DecisionBar
        runId={run.id}
        number={run.number}
        status={run.status}
        newListings={run.newListings}
        publishable={run.publishable}
        held={run.held}
        heldBecause={run.heldBecause}
        rejected={run.rejected}
        live={run.live}
        decidedLabel={run.decision ? formatDate(run.decision.at) : null}
        decidedBy={run.decision?.by ?? null}
        decisionReason={run.decision?.reason ?? null}
        reversible={run.reversible}
        reversibleUntilLabel={run.reversibleUntil ? formatDate(run.reversibleUntil) : null}
        rollback={
          run.rollback
            ? {
                atLabel: formatDate(run.rollback.at),
                by: run.rollback.by,
                reason: run.rollback.reason,
                withdrawn: run.rollback.withdrawn,
                kept: run.rollback.kept,
              }
            : null
        }
        preview={run.rollbackPreview}
        reversibleDays={reversibleDays}
        exportHref={`/admin/ingest/${run.id}/rejects`}
        queueHref={`/admin/ingest/categorise?run=${run.id}`}
        publish={publish}
        discard={discard}
        rollbackAction={rollback}
        openRunAfter={linkToRun}
      />
    </div>
  );
}

/**
 * Board 12b: where this run's possible duplicates stand in the dedupe queue,
 * and — Q1 — how many records came near a listing and scored under the floor,
 * so a floor set too high shows up on the run it hid duplicates from.
 */
function duplicatesCaption(pairs: RunOverview["pairs"]): string {
  const decided = pairs.merged + pairs.separated + pairs.discarded;
  const standing =
    pairs.pending > 0
      ? t("admin.run.card.duplicates_pending", {
          pending: formatCount(pairs.pending),
          decided: formatCount(decided),
        })
      : decided > 0
        ? t("admin.run.card.duplicates_decided")
        : t("admin.run.card.duplicates_caption");
  return pairs.belowFloor > 0
    ? [standing, t("admin.run.card.below_floor", n(pairs.belowFloor))].join(` ${MIDDLE_DOT} `)
    : standing;
}
