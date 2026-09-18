import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ReportEntry } from "@/lib/reports/queue";
import { slaTone } from "@/lib/reports/sla";

/**
 * Board 4h — a queue row, as words.
 *
 * Every string is resolved here, on the server, exactly as board 4b's
 * `board.ts` does it. A client component cannot be handed `t` or a formatter —
 * this repo's most repeated defect — and a row on this board is a sentence
 * followed by a measurement, both of which a component would otherwise want to
 * compute.
 */

export interface ReportBoardRow {
  ref: string;
  typeLabel: string;
  /** What was reported. The claim, in the reporter's words or the detector's. */
  claim: string;
  /**
   * What the platform already knows, in mono under the claim.
   *
   * The board calls this the best thing on the screen, and the reason is that a
   * moderator opens the row knowing why it is there. It is the stored
   * measurement where a detector or a producer wrote one, and otherwise the
   * prior count — *third report of this field* is a measurement too.
   */
  evidence: string | null;
  businessName: string;
  businessHref: string;
  reporter: string;
  /** How many records this row stands for, as words. Null when it is one. */
  duplicates: string | null;
  owner: string | null;
  waiting: string;
  /** `bad` past the service level, `warn` inside its last quarter. */
  tone: "bad" | "warn" | "neutral";
  slaLabel: string;
  late: boolean;
  escalated: boolean;
  /** Board 13c — three separate sources or more, across the value group. */
  flagged: string | null;
  suspended: boolean;
  actionLabel: string;
  href: string;
}

/**
 * The verb on the row's one visible action.
 *
 * Three, and each of them names what happens at the destination rather than
 * what the button does. The board drew `Suspend` and `Archive` here; neither is
 * on this screen, because both are decisions this queue's own moderators cannot
 * take and both already exist on `/admin/businesses` with their reason codes,
 * their audit entries and their appeal paths. An escalated row says so and the
 * detail screen carries the link.
 */
function actionKey(entry: ReportEntry): "review" | "check" | "investigate" {
  if (entry.type === "review_dispute" || entry.type === "review_integrity") return "review";
  if (entry.type === "off_platform_payment") return "check";
  return "investigate";
}

export function reportBoardRows(
  entries: readonly ReportEntry[],
  options: { query?: string } = {},
): ReportBoardRow[] {
  return entries.map((entry) => {
    /*
       The evidence line, in the order the board draws it: how many people said
       it, then what we measured. Empty parts are dropped rather than rendered
       as a separator with nothing on either side of it.
    */
    const parts = [
      /*
         Board 13c. Distinct sources across the value group, counted live —
         the same number the flag reads, so the line and the badge beside it
         cannot disagree. A detector's finding is a source of its own, which is
         why this says *reports* and not *people*.
      */
      entry.corroboration.sources > 1
        ? t("admin.reports.evidence.separate", { count: formatCount(entry.corroboration.sources) })
        : null,
      entry.evidence ??
        (entry.priorsOnField > 1
          ? t("admin.reports.evidence.priors", { count: formatCount(entry.priorsOnField) })
          : null),
    ].filter((part): part is string => part !== null);
    return {
      ref: entry.ref,
      typeLabel: t(`admin.reports.type.${entry.type}` as "admin.reports.type.closed"),
      claim: entry.claim ?? t("admin.reports.no_claim"),
      evidence: parts.length > 0 ? parts.join(" · ") : null,
      businessName: entry.businessName,
      businessHref: `/admin/businesses/${entry.businessId}`,
      reporter:
        entry.reporter.kind === "auto" && entry.detector
          ? t(`admin.reports.detector.${entry.detector}` as "admin.reports.detector.shared_phone")
          : entry.reporter.kind === "public"
            ? t("admin.reports.reporter.public")
            : entry.reporter.kind === "seller"
              ? t("admin.reports.reporter.seller")
              : entry.reporter.kind === "staff"
                ? t("admin.reports.reporter.staff")
                : (entry.reporter.name ?? t("admin.reports.reporter.buyer")),
      /*
         *and 3 more*, not *3 people*. One of the records in a group can be the
         nightly sweep's, and a line that counted them as people would be
         wrong on exactly the row the board is proudest of.
      */
      duplicates:
        entry.reports > 1
          ? t("admin.reports.duplicates", { n: formatCount(entry.reports - 1) })
          : null,
      owner: entry.assignee?.name ?? null,
      waiting: formatDuration(coarse(entry.waitingMs)),
      tone: slaTone(entry.sla),
      /*
         A word beside the colour, always. The design system's rule is that
         status is never a bare colour, and `B4` says the same thing from the
         other end: the age tone must never be the only carrier of state.
      */
      slaLabel:
        entry.sla === "late"
          ? t("admin.reports.sla.late", { sla: formatDuration(entry.slaMs) })
          : entry.sla === "due"
            ? t("admin.reports.sla.due", { sla: formatDuration(entry.slaMs) })
            : t("admin.reports.sla.ok", { sla: formatDuration(entry.slaMs) }),
      late: entry.sla === "late",
      escalated: entry.escalatedAt !== null,
      /*
         The count and the spread, in words, because a badge reading *Flagged*
         alone would say a threshold was crossed without saying by what — and
         `3 sources · 4 listings` is the triage `4h`'s evidence line does.
      */
      flagged: entry.flagged
        ? entry.corroboration.listings > 1
          ? t("admin.reports.flagged_spread", {
              sources: formatCount(entry.corroboration.sources),
              listings: formatCount(entry.corroboration.listings),
            })
          : t("admin.reports.flagged", { sources: formatCount(entry.corroboration.sources) })
        : null,
      suspended: entry.businessSuspended,
      actionLabel: t(`admin.reports.action.${actionKey(entry)}` as "admin.reports.action.review"),
      href: `${entry.href}${options.query ?? ""}`,
    };
  });
}

/**
 * Minutes below an hour, hours below a day, days above it.
 *
 * `formatDuration` is exact to the minute, and a queue row does not want
 * `2 d 4 h 17 min` — the board reads `2 d 4 h`. Board 4b's `board.ts` makes the
 * same trim for the same reason.
 */
function coarse(ms: number): number {
  const HOUR = 3_600_000;
  return ms >= HOUR ? Math.floor(ms / HOUR) * HOUR : ms;
}
