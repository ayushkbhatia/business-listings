import { LogoTile, StatusBadge } from "@/components/display";
import { formatDuration, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  canNudge,
  effectiveState,
  latencyMs,
  type TrackedRecipient,
} from "@/lib/enquiry/tracking";
import { NudgeButton } from "./NudgeButton";

/**
 * One recipient row, in each of the five states.
 *
 * The substance of board 1i. Each state renders differently because each means
 * something different to a buyer deciding whether to keep waiting, and the mono
 * line is where that difference lives.
 */

export function RecipientRow({
  row,
  closesAt,
  now,
  accepted,
  acceptedBusinessId,
  isFirstQuoted,
  quoteHref,
  enquiryRef,
  token,
}: {
  row: TrackedRecipient;
  closesAt: Date;
  now: Date;
  accepted: boolean;
  acceptedBusinessId: string | null;
  /** Only the first quoted row gets a primary action. One primary per view. */
  isFirstQuoted: boolean;
  quoteHref: string;
  enquiryRef: string;
  token: string | null;
}) {
  const state = effectiveState(row, closesAt, now);
  const chosen = accepted && acceptedBusinessId === row.businessId;
  /*
     Once a quote is accepted the other rows say why they ended, rather than
     leaving a buyer to wonder whether four suppliers went quiet on them.
  */
  const passedOver = accepted && !chosen;

  return (
    <li
      className={cn(
        "flex items-start gap-3 border-b border-line px-4 py-3 last:border-0",
        chosen && "border-l-2 border-l-moss bg-paper",
        (state === "declined" || state === "no_response" || passedOver) && "opacity-70",
      )}
    >
      {/* Dropped below 768: on a phone the name and the state are the row. */}
      <div className="hidden shrink-0 sm:block">
        <LogoTile name={row.displayName} categoryCode={row.slug.slice(0, 2).toUpperCase()} size="sm" />
      </div>

      <div className="min-w-0 flex-1">
        <a
          href={`/b/${row.slug}`}
          className="rounded-tag text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {row.displayName}
        </a>
        <p className="mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
          <StateLine row={row} state={state} passedOver={passedOver} />
        </p>
      </div>

      <div className="shrink-0">
        {state === "quoted" && !passedOver ? (
          <a
            href={quoteHref}
            className={cn(
              "inline-flex min-h-9 items-center rounded-ctl px-3 text-body-sm font-medium",
              "focus-visible:outline-none focus-visible:shadow-focus",
              isFirstQuoted
                ? "bg-moss text-white hover:bg-moss-deep"
                : "border border-line bg-card text-ink hover:bg-paper",
            )}
          >
            {t("track.view_quote")}
          </a>
        ) : state === "delivered" && !accepted ? (
          /*
             Nudge is one per recipient, ever, and only after 24 hours in
             `delivered`. Once spent the button becomes the mono line saying so
             — the buyer needs to remember they already did this.
          */
          row.buyerNudgedAt ? (
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("track.nudged", { when: formatRelative(row.buyerNudgedAt) })}
            </span>
          ) : (
            <NudgeButton
              businessId={row.businessId}
              enquiryRef={enquiryRef}
              token={token}
              disabled={!canNudge(row, now)}
              label={t("track.nudge")}
              waitLabel={t("track.nudge_wait")}
            />
          )
        ) : null}
      </div>
    </li>
  );
}

/**
 * The mono line, which is the whole difference between the five states.
 *
 * A partial quote states its line count because a buyer needs to know a line
 * went unpriced *before* they compare — finding out during the comparison is
 * finding out too late.
 */
function StateLine({
  row,
  state,
  passedOver,
}: {
  row: TrackedRecipient;
  state: ReturnType<typeof effectiveState>;
  passedOver: boolean;
}) {
  if (passedOver) return <>{t("track.state.chose_another")}</>;

  switch (state) {
    case "quoted": {
      /* Priced against an older requirement, and the buyer should know. */
      if (row.superseded) {
        return <>{t("track.state.superseded", { revision: row.quotedAgainstRevision })}</>;
      }
      const ms = latencyMs(row);
      return (
        <>
          {t("track.state.quoted", {
            quoted: row.quotedLines,
            total: row.totalLines,
            latency: Number.isFinite(ms) ? formatDuration(ms) : "—",
          })}
        </>
      );
    }
    case "opened":
      return (
        <>
          {t("track.state.opened")}
          {row.openedAt && (
            <> · {t("track.state.opened_seen", { when: formatRelative(row.openedAt) })}</>
          )}
        </>
      );
    case "declined":
      /* The seller's own words. "Outside their range" is more useful than
         silence, and it is not ours to paraphrase. */
      return row.declineReason ? (
        <>{t("track.state.declined", { reason: row.declineReason.toUpperCase() })}</>
      ) : (
        <>{t("track.state.declined_bare")}</>
      );
    case "no_response":
      return <>{t("track.state.no_response")}</>;
    default:
      return <>{t("track.state.delivered")}</>;
  }
}

/** The badge above the rows, in the mode the header is in. */
export function HeaderBadge({ mode, quoted, sent }: { mode: string; quoted: number; sent: number }) {
  if (mode === "accepted") {
    return (
      <StatusBadge tone="ok" size="sm" dot>
        {t("track.badge_accepted")}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone={mode === "quoted" ? "ok" : "info"} size="sm" dot>
      {mode === "quoted"
        ? t("track.badge_quoted", { count: quoted })
        : t("track.badge_sent", { count: sent })}
    </StatusBadge>
  );
}
