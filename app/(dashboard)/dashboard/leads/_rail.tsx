import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { cn } from "@/lib/cn";
import { formatAED, formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { InboxPage, LeadRailRow, LeadScope, LeadTab, WaitBand } from "@/lib/leads/inbox";
import { LEAD_TABS } from "@/lib/leads/inbox";

/**
 * Board 3j — the list rail.
 *
 * A server component, and every row is a real link. The board draws a
 * master-detail pane and the temptation is a client list with an `onSelect`;
 * that would cost the seller a URL they can send to the colleague they are
 * asking about a lead, a back button that works, and a middle-click.
 *
 * ## Every number here is a query
 *
 * The tab counts, the footer's "6 of 12", the competing-suppliers tag and the
 * waiting time are all computed in `lib/leads/inbox.ts` from rows. The board
 * renders them as constants; a directory whose counts are constants is a
 * directory nobody believes twice.
 *
 * ## The bands carry a word
 *
 * `docs/design-system.md` §Accessibility: never colour alone. An overdue row is
 * red *and* says "Overdue", because the seller reading it on a bad monitor at
 * the end of a long day is the person the rule is for.
 */

const BAND_TONE: Record<WaitBand, StatusTone> = {
  breached: "bad",
  approaching: "warn",
  waiting: "neutral",
  answered: "ok",
};

const BAND_LABEL = {
  breached: "leads.band.breached",
  approaching: "leads.band.approaching",
  waiting: "leads.band.waiting",
  answered: "leads.band.answered",
} as const;

const TAB_LABEL = {
  open: "leads.tab.open",
  quoted: "leads.tab.quoted",
  won: "leads.tab.won",
  lost: "leads.tab.lost",
} as const;

const EMPTY_TITLE = {
  open: "leads.empty.open",
  quoted: "leads.empty.quoted",
  won: "leads.empty.won",
  lost: "leads.empty.lost",
} as const;

const EMPTY_BODY = {
  open: "leads.empty.open_body",
  quoted: "leads.empty.quoted_body",
  won: "leads.empty.won_body",
  lost: "leads.empty.lost_body",
} as const;

export interface LeadRailProps {
  page: InboxPage;
  tab: LeadTab;
  scope: LeadScope;
  /** The lead the detail pane is showing, so the rail can mark it. */
  selectedId: string | null;
}

/** The querystring a tab or a row link carries, so a choice survives a click. */
export function railHref(input: {
  enquiryId?: string | null;
  tab: LeadTab;
  scope: LeadScope;
}): string {
  const params = new URLSearchParams();
  // `open` and `all` are the defaults; leaving them out keeps the ordinary URL
  // short enough to read, which is what makes it worth sending to somebody.
  if (input.tab !== "open") params.set("tab", input.tab);
  if (input.scope.kind !== "all") params.set("scope", scopeParam(input.scope));
  const query = params.toString();
  const path = input.enquiryId ? `/dashboard/leads/${input.enquiryId}` : "/dashboard/leads";
  return query ? `${path}?${query}` : path;
}

export function scopeParam(scope: LeadScope): string {
  switch (scope.kind) {
    case "all":
      return "all";
    case "mine":
      return "mine";
    case "unassigned":
      return "unassigned";
    case "seat":
      return `seat:${scope.userId}`;
  }
}

export function LeadRail({ page, tab, scope, selectedId }: LeadRailProps) {
  const { rows, counts, total } = page;

  return (
    <div className="flex min-h-0 flex-col">
      <nav aria-label={t("leads.tabs_label")} className="border-b border-line px-1">
        <ul className="flex items-stretch gap-1 overflow-x-auto">
          {LEAD_TABS.map((key) => {
            const active = key === tab;
            return (
              <li key={key}>
                <Link
                  href={railHref({ tab: key, scope })}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 whitespace-nowrap rounded-t-ctl px-3 py-2.5 text-body-sm",
                    "focus-visible:shadow-focus focus-visible:outline-none",
                    active
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
            );
          })}
        </ul>
      </nav>

      {rows.length === 0 ? (
        <EmptyRail tab={tab} scope={scope} />
      ) : (
        <>
          <ol aria-label={t("leads.rail_label")} className="min-h-0 flex-1 overflow-y-auto">
            {rows.map((row) => (
              <RailRow
                key={row.enquiryId}
                row={row}
                tab={tab}
                scope={scope}
                selected={row.enquiryId === selectedId}
              />
            ))}
          </ol>

          <p className="border-t border-line px-3 py-2.5 text-caption text-muted">
            {rows.length < total
              ? t("leads.rail_footer", {
                  shown: formatCount(rows.length),
                  total: formatCount(total),
                })
              : t("leads.rail_all_shown", { count: total, formatted: formatCount(total) })}
          </p>
        </>
      )}
    </div>
  );
}

function EmptyRail({ tab, scope }: { tab: LeadTab; scope: LeadScope }) {
  /*
     Filtered-to-zero, not first-run — two of the four empty states the design
     system separates. A seller who has narrowed to their own assignments and
     found nothing is told how to widen it; one whose whole Open tab is empty is
     told what would put a row in it.
  */
  const scoped = scope.kind !== "all";
  return (
    <div className="flex-1 px-3 py-6">
      <h2 className="text-body-sm text-ink">
        {scoped ? t("leads.empty.scope") : t(EMPTY_TITLE[tab])}
      </h2>
      <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-muted">
        {scoped ? t("leads.empty.scope_body") : t(EMPTY_BODY[tab])}
      </p>
      {scoped ? (
        <Link
          href={railHref({ tab, scope: { kind: "all" } })}
          className="mt-3 inline-block rounded-tag text-caption text-moss underline-offset-4 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("leads.scope.all")}
        </Link>
      ) : null}
    </div>
  );
}

function RailRow({
  row,
  tab,
  scope,
  selected,
}: {
  row: LeadRailRow;
  tab: LeadTab;
  scope: LeadScope;
  selected: boolean;
}) {
  const band = row.band;

  return (
    <li>
      <Link
        href={railHref({ enquiryId: row.enquiryId, tab, scope })}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "block border-b border-line px-3 py-3 transition-colors duration-120 ease-out",
          "focus-visible:shadow-focus focus-visible:outline-none",
          // Selection is a moss border and a moss-tinted fill, never a shadow.
          selected
            ? "border-l-[1.5px] border-l-moss bg-moss-wash"
            : "border-l-[1.5px] border-l-transparent hover:bg-paper-sunk",
        )}
      >
        <span className="flex items-baseline justify-between gap-3">
          {/*
            A first name, and nothing more, until the buyer accepts. The board
            renders the buyer's company here; lib/db/queries/seller-visibility.ts
            never selects it, because one enquiry must not become five cold calls.
          */}
          <span className="truncate text-body-sm font-medium text-ink">
            {row.buyer.released && row.buyer.companyName
              ? row.buyer.companyName
              : row.buyer.firstName}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <StatusBadge tone={BAND_TONE[band]} size="sm" shape="chip">
              {t(BAND_LABEL[band])}
            </StatusBadge>
            {row.waitingMs !== null ? (
              <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">
                {formatDuration(row.waitingMs)}
              </span>
            ) : null}
          </span>
        </span>

        <span className="mt-1 block truncate text-body-sm text-body">{row.summary}</span>

        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-eyebrow uppercase tabular-nums text-muted">{row.ref}</span>
          {row.buyerBudgetAed ? (
            <span className="text-caption text-muted">
              {t("leads.budget", { amount: formatAED(row.buyerBudgetAed) })}
            </span>
          ) : null}
          {row.competing > 1 ? (
            <StatusBadge tone="info" size="sm" shape="chip">
              {t("leads.competing", {
                count: row.competing - 1,
                formatted: formatCount(row.competing - 1),
              })}
            </StatusBadge>
          ) : null}
          {row.unread > 0 ? (
            <StatusBadge tone="warn" size="sm" shape="chip">
              {t("leads.unread", { count: row.unread, formatted: formatCount(row.unread) })}
            </StatusBadge>
          ) : null}
        </span>

        {row.assignedTo ? (
          <span className="mt-1 block truncate text-caption text-faint">
            {t("leads.assigned_to", { name: row.assignedTo.name || t("lead.assign_unnamed") })}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
