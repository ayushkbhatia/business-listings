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
  /**
   * The row's own review screen, carrying the filter it came from. Every seat
   * that can see a row can open it.
   *
   * Board 4c `B1` settled the conflict case: a moderator who opens one sees the
   * evidence and *Assign to ops lead*, with no resolution controls. Until then
   * this was null for a moderator while the row's `href` beside it was not, and
   * the conflict screen 404'd for anybody without `claim.resolve` — so the row
   * carried queue depth a moderator could see, and a link that went nowhere.
   * The depth was right; the dead end was not.
   */
  actionHref: string;
  /**
   * Board 4c `B1`: this seat may open the row and not decide it — a moderator
   * on a conflict. The row's action reads *Open* rather than *Review*, so the
   * label does not promise a decision the screen will not offer.
   */
  readOnly: boolean;
  waiting: string;
  late: boolean;
  /** Board 4c Q5: escalated to a named holder, shown in place of the age. */
  escalated: string | null;
  docsWaiting: string | null;
  owner: string | null;
  href: string;
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
    // The filter travels, so the review screen counts the same list (§Flagged 2).
    const href = `${entry.href}${options.query ?? ""}`;
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
      actionHref: href,
      readOnly: entry.kind === "conflict" && !options.canResolveConflicts,
      waiting: formatDuration(coarse(entry.waitingMs)),
      late: entry.late,
      escalated: entry.escalated
        ? entry.escalated.to
          ? t("admin.queue.escalated_to", { name: entry.escalated.to })
          : t("admin.queue.escalated")
        : null,
      docsWaiting: entry.docsRequested
        ? t("admin.queue.docs_waiting", { when: formatRelative(entry.docsRequested.at, { now: options.now }) })
        : null,
      owner: entry.assignee?.name ?? null,
      href,
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
