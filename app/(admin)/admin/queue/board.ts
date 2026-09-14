import { formatDuration, formatRelative } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import type { CheckOutcome, CheckSentence, RowAction } from "@/lib/moderation/checks";
import { orderedChecks, worstOutcome } from "@/lib/moderation/checks";
import type { QueueEntry } from "@/lib/moderation/queue";
import type { QueueKind } from "@/lib/moderation/rules";

/**
 * Board 4b — a queue row, as words.
 *
 * Every string is resolved here, on the server. A client component cannot be
 * handed `t` or a formatter — the repo's most repeated defect — and the row is
 * a sentence-heavy thing: the summary, each check's own sentence, how long it
 * has waited. Words cross the boundary; functions do not.
 */

export interface BoardCheck {
  outcome: CheckOutcome;
  text: string;
}

export interface BoardRow {
  ref: string;
  kind: QueueKind;
  businessName: string;
  summary: string;
  typeLabel: string;
  checks: BoardCheck[];
  worst: CheckOutcome;
  allPassed: boolean;
  action: RowAction;
  /** Null where the seat cannot act on this row from here (a moderator on a conflict). */
  actionHref: string | null;
  waiting: string;
  late: boolean;
  docsWaiting: string | null;
  owner: string | null;
  href: string;
  /** Whether the row's own review screen is one this seat may open. */
  canOpen: boolean;
  /**
   * Board 4c-s. Decided only on its own screen, against a register read from
   * the last hour and — for a rejection — one of four reasons, so the row's
   * action opens that screen rather than a dialog that could offer neither.
   */
  decidesOnScreen: boolean;
}

export function sentenceText(sentence: CheckSentence): string {
  const labels = Object.fromEntries(
    Object.entries(sentence.labels ?? {}).map(([name, key]) => [name, t(key as MessageKey)]),
  );
  return t(sentence.key as MessageKey, { ...sentence.params, ...labels });
}

export function boardRows(
  entries: readonly QueueEntry[],
  options: { canResolveConflicts: boolean; now: Date; query?: string },
): BoardRow[] {
  return entries.map((entry) => {
    const canOpen = entry.kind !== "conflict" || options.canResolveConflicts;
    return {
      ref: entry.ref,
      kind: entry.kind,
      businessName: entry.businessName,
      summary: sentenceText(entry.summary),
      typeLabel: t(`admin.queue.type.${entry.kind}`),
      checks: orderedChecks(entry.checks).map((check) => ({ outcome: check.outcome, text: sentenceText(check.sentence) })),
      worst: worstOutcome(entry.checks),
      allPassed: entry.allPassed,
      action: entry.action,
      // The filter travels, so the review screen counts the same list (§Flagged 2).
      actionHref: canOpen ? `${entry.href}${options.query ?? ""}` : null,
      waiting: formatDuration(coarse(entry.waitingMs)),
      late: entry.late,
      docsWaiting: entry.docsRequested
        ? t("admin.queue.docs_waiting", { when: formatRelative(entry.docsRequested.at, { now: options.now }) })
        : null,
      owner: entry.assignee?.name ?? null,
      href: `${entry.href}${options.query ?? ""}`,
      canOpen,
      decidesOnScreen: entry.subject === "register_credential",
    };
  });
}

/**
 * Waiting, to the unit a queue is worked in: minutes under an hour, hours
 * under a day, days and hours after that. "17 h 53 min" is a precision nobody
 * triages by, and it makes two rows nine minutes apart look different.
 */
function coarse(ms: number): number {
  const HOUR = 3_600_000;
  return ms < HOUR ? ms : Math.floor(ms / HOUR) * HOUR;
}
