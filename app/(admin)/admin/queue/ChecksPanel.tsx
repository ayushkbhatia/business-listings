import { Alert, StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { formatDuration, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { orderedChecks } from "@/lib/moderation/checks";
import type { QueueEntry } from "@/lib/moderation/queue";
import { sentenceText } from "./board";

/**
 * A submission's automated checks, on its own review screen.
 *
 * The same checks the queue row showed, computed the same way, all of them —
 * the row has room for three sentences and this has room for the rest. Each
 * says what a person should look at, in the colour of its outcome (B3). Below
 * them, the two facts the queue holds about the submission: who it is assigned
 * to, and a document already asked for.
 */

const TONE = { pass: "ok", warn: "warn", fail: "bad" } as const;

export function ChecksPanel({ entry, now }: { entry: QueueEntry | null; now: Date }) {
  if (!entry) return null;
  return (
    <Panel
      title={t("admin.review.checks_title")}
      description={
        entry.allPassed
          ? t("admin.review.checks_passed")
          : t("admin.review.checks_attention", { waiting: formatDuration(entry.waitingMs) })
      }
    >
      <div className="flex flex-col gap-3">
        <ul className="flex flex-col gap-2">
          {orderedChecks(entry.checks).map((check) => (
            <li key={`${check.rule}-${check.sentence.key}`} className="flex items-start gap-2 text-body-sm text-body">
              <StatusBadge tone={TONE[check.outcome]} size="sm" shape="chip">
                {t(`admin.review.outcome.${check.outcome}`)}
              </StatusBadge>
              <span>{sentenceText(check.sentence)}</span>
            </li>
          ))}
        </ul>
        <p className="text-caption text-muted">
          {entry.assignee?.name
            ? t("admin.review.assigned_to", { name: entry.assignee.name })
            : t("admin.queue.unassigned")}
        </p>
        {entry.docsRequested && (
          <Alert tone="warn" fix={t("admin.review.docs_requested_fix")}>
            {t("admin.review.docs_requested", {
              when: formatRelative(entry.docsRequested.at, { now }),
              reason: entry.docsRequested.reason,
            })}
          </Alert>
        )}
      </div>
    </Panel>
  );
}
