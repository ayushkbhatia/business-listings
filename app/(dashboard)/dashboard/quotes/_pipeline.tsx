import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { Card } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { PageEvent } from "@/components/telemetry";
import { can } from "@/lib/auth/can";
import { cn } from "@/lib/cn";
import { prisma } from "@/lib/db/client";
import { formatAED, formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { LeadScope } from "@/lib/leads/inbox";
import {
  getPipeline,
  expiringSoon,
  PIPELINE_TABS,
  type PipelineRow,
  type PipelineTab,
} from "@/lib/quotes/pipeline";
import { ceilingFor, EXTEND_PRESET_DAYS, presetDate } from "@/lib/quotes/extend";
import { replySpeed, FAST_HOURS, SLOW_HOURS, type SpeedCard } from "@/lib/quotes/speed";
import { getNavBadges, requireSellerSeat, SellerPage, type SellerSeat } from "../_shell";
import { RowActions } from "./RowActions";

/**
 * Board 3k — the quotes pipeline.
 *
 * A single full-width pane: there is no rail, because there is nothing to select
 * into. A quote's detail is its thread, which board 11b already owns.
 *
 * Rendered by three routes — the list, `/dashboard/quotes/:ref` which highlights
 * a row, and `/dashboard/quotes/:ref/extend` which lands with the dialog open.
 * One component, so the three cannot disagree about a count.
 */

const STATE_TONE: Record<PipelineRow["state"], StatusTone> = {
  awaiting: "info",
  won: "ok",
  lost: "bad",
  expired: "neutral",
};

const STATE_LABEL = {
  awaiting: "quotes.state.awaiting",
  won: "quotes.state.won",
  lost: "quotes.state.lost",
  expired: "quotes.state.expired",
} as const;

const TAB_LABEL = {
  all: "quotes.tab.all",
  awaiting: "quotes.tab.awaiting",
  expiring: "quotes.tab.expiring",
  won: "quotes.tab.won",
  lost: "quotes.tab.lost",
  expired: "quotes.tab.expired",
} as const;

const EMPTY = {
  awaiting: ["quotes.empty.awaiting", "quotes.empty.awaiting_body"],
  expiring: ["quotes.empty.expiring", "quotes.empty.expiring_body"],
  won: ["quotes.empty.won", "quotes.empty.won_body"],
  lost: ["quotes.empty.lost", "quotes.empty.lost_body"],
  expired: ["quotes.empty.expired", "quotes.empty.expired_body"],
  all: ["quotes.empty_title", "quotes.empty_body"],
} as const;

export interface PipelineScreenProps {
  search: Record<string, string | string[] | undefined>;
  /** From the deep link. Highlights the row and, with `openExtend`, its dialog. */
  highlightRef?: string | null;
  openExtend?: boolean;
}

function one(search: PipelineScreenProps["search"], key: string): string | undefined {
  const value = search[key];
  return typeof value === "string" ? value : undefined;
}

function parseTab(raw: string | undefined): PipelineTab {
  return (PIPELINE_TABS as readonly string[]).includes(raw ?? "")
    ? (raw as PipelineTab)
    : "all";
}

/**
 * Whose quotes.
 *
 * §1: "a seat that cannot see a lead in the inbox must not see its quote here",
 * so this resolves exactly as board 3j's scope does — owner and manager on
 * everything, a sales seat on their own assignments.
 */
function scopeFor(seat: SellerSeat): LeadScope {
  return can(seat.actor, "routing.manage")
    ? { kind: "all" }
    : { kind: "mine", userId: seat.actor.id };
}

export async function PipelineScreen({
  search,
  highlightRef = null,
  openExtend = false,
}: PipelineScreenProps) {
  const seat = await requireSellerSeat();
  const tab = parseTab(one(search, "tab"));
  const page = Math.max(1, Number(one(search, "page") ?? 1) || 1);
  const scope = scopeFor(seat);
  const now = new Date();

  const [pipeline, soon, speed, badges, business] = await Promise.all([
    getPipeline({ businessId: seat.businessId, tab, scope, page, now }),
    expiringSoon({ businessId: seat.businessId, scope, now }),
    replySpeed({ businessId: seat.businessId, scope, now }),
    getNavBadges(seat.businessId),
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: { suspendedAt: true },
    }),
  ]);

  const suspended = business.suspendedAt !== null;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/quotes"
      title={t("quotes.title")}
      meta={
        <span className="text-caption text-muted">
          {t("quotes.pipeline_subtitle", {
            count: pipeline.counts.awaiting,
            formatted: formatCount(pipeline.counts.awaiting),
          })}
        </span>
      }
      actions={
        <Link
          href={`/dashboard/quotes/export?tab=${tab}`}
          prefetch={false}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("quotes.export.action")}
        </Link>
      }
    >
      <PageEvent
        name="pipeline_viewed"
        props={{
          tab,
          all: pipeline.counts.all,
          awaiting: pipeline.counts.awaiting,
          expiring: pipeline.counts.expiring,
        }}
      />

      {suspended ? <SuspendedNotice /> : null}

      <div className="space-y-[var(--gutter)]">
        <Tabs counts={pipeline.counts} active={tab} />
        <Strip counts={pipeline.counts} quotedTotalAed={pipeline.quotedTotalAed} total={pipeline.total} />

        {pipeline.rows.length === 0 ? (
          <EmptyPipeline tab={tab} />
        ) : (
          <PipelineTable
            rows={pipeline.rows}
            total={pipeline.total}
            page={pipeline.page}
            tab={tab}
            now={now}
            suspended={suspended}
            highlightRef={highlightRef}
            openExtend={openExtend}
          />
        )}

        <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
          <SpeedPanel card={speed} />
          <ExpiringPanel rows={soon} now={now} />
        </div>
      </div>
    </SellerPage>
  );
}

function SuspendedNotice() {
  return (
    <div className="mb-[var(--gutter)]">
      <Card padded>
        <h2 className="text-body-sm text-ink">{t("quotes.suspended_title")}</h2>
        <p className="mt-1 max-w-[var(--measure-prose)] text-caption text-muted">
          {t("quotes.suspended_body")}
        </p>
      </Card>
    </div>
  );
}

function Tabs({
  counts,
  active,
}: {
  counts: Awaited<ReturnType<typeof getPipeline>>["counts"];
  active: PipelineTab;
}) {
  return (
    <nav aria-label={t("quotes.tabs_label")} className="border-b border-line">
      <ul className="flex items-stretch gap-1 overflow-x-auto">
        {PIPELINE_TABS.map((key) => (
          <li key={key}>
            <Link
              href={key === "all" ? "/dashboard/quotes" : `/dashboard/quotes?tab=${key}`}
              aria-current={key === active ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap rounded-t-ctl px-3 py-2.5 text-body-sm",
                "focus-visible:shadow-focus focus-visible:outline-none",
                key === active
                  ? "border-b-2 border-moss font-medium text-ink"
                  : "border-b-2 border-transparent text-muted hover:text-ink",
              )}
            >
              {t(TAB_LABEL[key])}
              <span className="font-mono text-caption tabular-nums text-muted">
                {formatCount(counts[key])}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The header strip, with its denominator named.
 *
 * §8.2: "A percentage needs a named denominator. Label the denominator in the
 * strip or drop the figure." The board's `34% won` had none, so this says
 * "14 of 41 marked won" — a reader can divide, and cannot be misled about what
 * was divided by what.
 *
 * The quoted total is what is on this page rather than a period figure: a
 * "this month" number computed over a tab the seller has filtered would be a
 * third population beside the two the tabs already carry.
 */
function Strip({
  counts,
  quotedTotalAed,
  total,
}: {
  counts: Awaited<ReturnType<typeof getPipeline>>["counts"];
  quotedTotalAed: string;
  total: number;
}) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
      <span className="font-mono tabular-nums text-ink">
        {t("quotes.strip", {
          total: formatAED(quotedTotalAed),
          count: formatCount(total),
        })}
      </span>
      <span>
        {t("quotes.strip_won", {
          won: formatCount(counts.won),
          count: formatCount(counts.all),
        })}
      </span>
      {/* §8.3: every outcome here is the seller's own record. */}
      <span className="text-faint">{t("quotes.strip_caveat")}</span>
    </p>
  );
}

function EmptyPipeline({ tab }: { tab: PipelineTab }) {
  const [title, body] = EMPTY[tab];
  return (
    <Card padded>
      <h2 className="text-h3 text-ink">{t(title)}</h2>
      <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">{t(body)}</p>
      {/* A seller with no quotes has an inbox problem, not a pipeline one. */}
      <Link
        href="/dashboard/leads"
        className="mt-3 inline-block rounded-tag text-body-sm text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
      >
        {t("quotes.empty.inbox_link")}
      </Link>
    </Card>
  );
}

function PipelineTable({
  rows,
  total,
  page,
  tab,
  now,
  suspended,
  highlightRef,
  openExtend,
}: {
  rows: readonly PipelineRow[];
  total: number;
  page: number;
  tab: PipelineTab;
  now: Date;
  suspended: boolean;
  highlightRef: string | null;
  openExtend: boolean;
}) {
  const shown = (page - 1) * rows.length + rows.length;

  return (
    <div className="overflow-hidden rounded-card border border-line bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[62rem] border-collapse text-left">
          <caption className="sr-only">{t("quotes.caption")}</caption>
          <thead>
            <tr className="bg-paper-sunk">
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.ref")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.requirement")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.quoted")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.sent")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.valid_until")}
              </th>
              <th scope="col" className="px-3 py-2 font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.status")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-mono text-eyebrow font-normal uppercase text-muted">
                {t("quotes.col.actions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.quoteId}
                row={row}
                now={now}
                suspended={suspended}
                highlighted={row.ref === highlightRef}
                openExtend={openExtend && row.ref === highlightRef}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <p className="text-caption text-muted">
          {rows.length < total
            ? t("quotes.footer", { shown: formatCount(shown), total: formatCount(total) })
            : t("quotes.footer_all", { count: total, formatted: formatCount(total) })}
        </p>
        {shown < total ? (
          <Link
            href={`/dashboard/quotes?tab=${tab}&page=${page + 1}`}
            className="rounded-tag text-caption text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("quotes.more")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function Row({
  row,
  now,
  suspended,
  highlighted,
  openExtend,
}: {
  row: PipelineRow;
  now: Date;
  suspended: boolean;
  highlighted: boolean;
  openExtend: boolean;
}) {
  const daysLeft =
    row.expiresAt && row.state === "awaiting"
      ? Math.max(0, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 86_400_000))
      : null;
  const daysSinceExpiry =
    row.expiresAt && row.state === "expired"
      ? Math.max(0, Math.floor((now.getTime() - row.expiresAt.getTime()) / 86_400_000))
      : null;

  const ceiling = ceilingFor(row.sentAt, now);

  return (
    <tr
      id={`quote-${row.ref}`}
      className={cn(
        "border-t border-line align-top",
        // §4: expired rows sit on the tinted ground and drop to secondary ink —
        // a muted *colour* at full opacity, not a composited row. The board's
        // opacity:.65 took its buyer, amount and only action to 1.8–3.2:1.
        row.state === "expired" && "bg-paper-sunk",
        highlighted && "bg-moss-wash",
      )}
    >
      <th scope="row" className="px-3 py-3 text-left font-normal">
        <Link
          href={`/dashboard/leads/${row.enquiryId}/thread`}
          className="rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          aria-label={t("quotes.open_named", { ref: row.ref })}
        >
          {row.ref}
        </Link>
        {row.extensionCount > 0 ? (
          /* §10: "a quiet `extended` marker on the row, not a chip." */
          <span className="mt-0.5 block text-caption text-muted">
            {t("quotes.extended_times", {
              count: row.extensionCount,
              formatted: formatCount(row.extensionCount),
            })}
          </span>
        ) : null}
      </th>

      <td className="max-w-[26rem] px-3 py-3">
        {/* A first name until the buyer accepts. Rule 1 does not relax here. */}
        <span className="block truncate text-body-sm text-ink">
          {row.buyer.released && row.buyer.companyName
            ? row.buyer.companyName
            : row.buyer.firstName}
        </span>
        <span className="mt-0.5 block truncate text-caption text-muted">
          {row.summary}
          {row.deliverToArea ? ` · ${row.deliverToArea}` : ""}
        </span>
        {row.outcomeReason ? (
          <span className="mt-0.5 block text-caption text-muted">
            {t("quotes.you_marked", { reason: row.outcomeReason })}
          </span>
        ) : null}
      </td>

      <td className="px-3 py-3 text-right font-mono tabular-nums text-body-sm text-ink">
        {formatAED(row.totalAed, { style: "quote" })}
      </td>

      <td className="px-3 py-3 text-body-sm text-muted">
        {row.sentAt ? formatDate(row.sentAt) : "—"}
      </td>

      <td className="px-3 py-3 text-body-sm">
        {row.state === "won" || row.state === "lost" ? (
          /* §4: the window stops mattering once an outcome is marked. */
          <span className="text-muted">{t("quotes.valid_none")}</span>
        ) : row.state === "expired" ? (
          <span className="text-muted">
            {t("quotes.expired_on", { when: formatDate(row.expiresAt ?? now) })}
          </span>
        ) : row.expiresAt === null ? (
          /*
             No window on the row, so none is claimed. These are quotes sent
             before validity was a field; `sendQuoteForBusiness` has set one on
             every quote since. Rendering `formatDate(now)` here — which this did
             — put "expires today" against a quote that expires on no date at
             all, which is the kind of invented number this directory cannot
             afford.
          */
          <span className="text-muted">{t("quotes.valid_unknown")}</span>
        ) : (
          <span className={cn(daysLeft !== null && daysLeft <= 7 ? "text-warn-ink" : "text-ink")}>
            {t("quotes.valid_days", {
              when: formatDate(row.expiresAt),
              count: daysLeft ?? 0,
              formatted: formatCount(daysLeft ?? 0),
            })}
          </span>
        )}
      </td>

      <td className="px-3 py-3">
        <StatusBadge tone={STATE_TONE[row.state]} size="sm" shape="chip">
          {t(STATE_LABEL[row.state])}
        </StatusBadge>
        {row.state === "won" || row.state === "lost" ? (
          <span className="mt-0.5 block text-caption text-muted">
            {row.observed
              ? row.state === "won"
                ? t("quotes.observed_won")
                : t("quotes.observed_lost")
              : row.state === "won"
                ? t("quotes.marked_won")
                : t("quotes.marked_lost")}
          </span>
        ) : null}
      </td>

      <td className="px-3 py-3 text-right">
        {suspended ? null : (
          <RowActions
            quoteId={row.quoteId}
            enquiryId={row.enquiryId}
            quoteRef={row.ref}
            state={row.state}
            followUpSpent={row.followUpSpent}
            enquiryOpen={row.enquiryOpen}
            expiresAt={row.expiresAt?.toISOString() ?? null}
            ceiling={ceiling.toISOString()}
            presets={EXTEND_PRESET_DAYS.map((days) => ({
              days,
              label: t("quotes.extend.preset", { count: days }),
              iso: presetDate(row.expiresAt ?? now, days).toISOString(),
            }))}
            daysRemaining={daysLeft}
            daysSinceExpiry={daysSinceExpiry}
            openExtend={openExtend}
            labels={{
              extend: t("quotes.action.extend"),
              nudge: t("quotes.action.nudge"),
              revise: t("quotes.action.revise"),
              view: t("quotes.action.view"),
              requote: t("quotes.action.requote"),
              ariaExtend: t("quotes.action_for", {
                action: t("quotes.action.extend"),
                ref: row.ref,
              }),
              ariaNudge: t("quotes.action_for", {
                action: t("quotes.action.nudge"),
                ref: row.ref,
              }),
              ariaRevise: t("quotes.action_for", {
                action: t("quotes.action.revise"),
                ref: row.ref,
              }),
              ariaView: t("quotes.action_for", {
                action: t("quotes.action.view"),
                ref: row.ref,
              }),
              ariaRequote: t("quotes.action_for", {
                action: t("quotes.action.requote"),
                ref: row.ref,
              }),
              extendTitle: t("quotes.extend.title", { ref: row.ref }),
              extendBody: t("quotes.extend.body"),
              extendCurrent: t("quotes.extend.current", {
                when: formatDate(row.expiresAt ?? now),
              }),
              extendPick: t("quotes.extend.pick"),
              extendPickLabel: t("quotes.extend.pick_label"),
              extendCeiling: t("quotes.extend.ceiling", { when: formatDate(ceiling) }),
              extendConfirm: t("quotes.extend.confirm"),
              extendCancel: t("quotes.extend.cancel"),
              extendClose: t("quotes.extend.close"),
              extendCount:
                row.extensionCount > 0
                  ? t("quotes.extend.count_note", {
                      count: row.extensionCount,
                      formatted: formatCount(row.extensionCount),
                    })
                  : null,
              nudgeTitle: t("quotes.nudge.title", { ref: row.ref }),
              nudgeBody: t("quotes.nudge.body"),
              nudgeLabel: t("quotes.nudge.label"),
              nudgePlaceholder: t("quotes.nudge.placeholder"),
              nudgeConfirm: t("quotes.nudge.confirm"),
              nudgeCap: t("quotes.nudge.cap"),
            }}
          />
        )}
      </td>
    </tr>
  );
}

/**
 * §7's left card — counts, never rates.
 *
 * 23 resolved quotes split into buckets of 13 and 10 cannot carry a percentage;
 * one deal landing moves it eight points. The card says `8 of 13` and lets the
 * reader divide if they want to.
 */
function SpeedPanel({ card }: { card: SpeedCard }) {
  const widest = Math.max(card.fast.resolved, card.slow.resolved, 1);

  return (
    <Card padded>
      <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
        {t("quotes.speed.heading")}
      </h2>

      {card.empty ? (
        <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-muted">
          {t("quotes.speed.empty")}
        </p>
      ) : (
        <>
          <dl className="mt-3 space-y-3">
            {[
              { key: "fast", label: t("quotes.speed.fast", { count: FAST_HOURS }), bucket: card.fast },
              { key: "slow", label: t("quotes.speed.slow", { count: SLOW_HOURS }), bucket: card.slow },
            ].map((band) => (
              <div key={band.key}>
                <dt className="flex items-baseline justify-between gap-3 text-body-sm text-ink">
                  <span>{band.label}</span>
                  <span className="font-mono tabular-nums text-muted">
                    {/*
                      A bucket with nothing in it makes no argument, so it does
                      not pretend to: "0 of 0 won" over an empty bar is a row
                      claiming a measurement that has not been taken.
                    */}
                    {band.bucket.resolved === 0
                      ? t("quotes.speed.unmeasured")
                      : t("quotes.speed.won_of", {
                          won: formatCount(band.bucket.won),
                          count: formatCount(band.bucket.resolved),
                        })}
                  </span>
                </dt>
                <dd className="mt-1">
                  {/* A bar, and the numbers beside it — never a bar alone. */}
                  <span
                    aria-hidden="true"
                    hidden={band.bucket.resolved === 0}
                    className="block h-1.5 rounded-pill bg-fill"
                    style={{ width: `${Math.round((band.bucket.resolved / widest) * 100)}%` }}
                  >
                    <span
                      className="block h-1.5 rounded-pill bg-moss"
                      style={{
                        width: `${
                          band.bucket.resolved === 0
                            ? 0
                            : Math.round((band.bucket.won / band.bucket.resolved) * 100)
                        }%`,
                      }}
                    />
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          {card.expiredAfterADay > 0 ? (
            <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-prose">
              {t("quotes.speed.expired_read", {
                count: card.expired,
                late: formatCount(card.expiredAfterADay),
                formatted: formatCount(card.expired),
              })}
            </p>
          ) : null}
        </>
      )}

      <p className="mt-3 max-w-[var(--measure-prose)] text-caption text-muted">
        {t("quotes.speed.counts_note")}
      </p>
    </Card>
  );
}

/**
 * §7's right card, and the replacement for the board's `Follow up on all 6`.
 *
 * A bulk button both bypasses board 11b's one-per-lead cap and spends a nudge on
 * leads that may already have used theirs in the thread. Three named quotes, in
 * window order, and the seller acts on each — which is also the only place on
 * this screen ordered by urgency.
 */
function ExpiringPanel({ rows, now }: { rows: readonly PipelineRow[]; now: Date }) {
  return (
    <Card padded>
      <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
        {rows.length === 0
          ? t("quotes.expiring.none")
          : t("quotes.expiring.heading", {
              count: rows.length,
              formatted: formatCount(rows.length),
            })}
      </h2>

      {rows.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const days = Math.max(
              0,
              Math.ceil(((row.expiresAt?.getTime() ?? 0) - now.getTime()) / 86_400_000),
            );
            return (
              <li key={row.quoteId} className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="min-w-0">
                  <Link
                    href={`/dashboard/quotes/${row.ref}`}
                    className="rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {row.ref}
                  </Link>
                  <span className="ml-2 text-caption text-muted">
                    {row.buyer.released && row.buyer.companyName
                      ? row.buyer.companyName
                      : row.buyer.firstName}
                    {" · "}
                    {formatAED(row.totalAed)}
                  </span>
                </span>
                <span className="font-mono text-caption tabular-nums text-warn-ink">
                  {t("quotes.expiring.days", { count: days, formatted: formatCount(days) })}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* The two facts a seller needs before touching Extend. */}
      <p className="mt-3 max-w-[var(--measure-prose)] text-caption text-muted">
        {t("quotes.expiring.note")}
      </p>
    </Card>
  );
}
