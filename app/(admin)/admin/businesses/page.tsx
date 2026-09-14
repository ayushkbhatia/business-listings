import Link from "next/link";
import { Button, Input, Select, buttonClassName } from "@/components/primitives";
import { TableToolbar } from "@/components/structure";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatCount, formatPercent } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  EMIRATES,
  KINDS,
  PAGE_SIZE,
  hasAnyFilter,
  normaliseAccountFilter,
  pageFrom,
  toQueryString,
  type AccountFilter,
} from "@/lib/accounts/filter";
import { ACCOUNT_STATES, CHURN_RISK_BELOW, UPGRADE_WINDOW_DAYS } from "@/lib/accounts/health";
import { accountSummary, readAccountPage } from "@/lib/accounts/list";
import { listSegments } from "@/lib/accounts/segments";
import { cn } from "@/lib/cn";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { AccountsTable } from "./AccountsTable";
import { SegmentsMenu } from "./SegmentsMenu";
import { deleteSegmentAction, saveSegmentAction } from "./actions";
import { stateLabel, toTableRow } from "./present";

/**
 * Board 4f — `/admin/businesses`. A CRM that leads with reply rate.
 *
 * The job is to find the few hundred accounts that need a phone call this week
 * among 41,000 listings, so the page is a filter, a count and a reason:
 *
 *   - **Every number is its own query.** The header's total, claimed and paying;
 *     the chip; both panels; the range line. None is a page length.
 *   - **One threshold, one query** (`B4`). The chip, the at-risk panel and the
 *     list under `health=churn_risk` all read `stateWhere("churn_risk")`.
 *   - **Health is derived as the page renders** (`B1`) from the measured reply
 *     rate the daily job writes, the plan, the subscription and the lifecycle.
 *   - **Read-only** (`B10`). A row opens the account; decisions live there.
 *
 * Everything in the filter is in the URL, so a view can be saved, exported,
 * bookmarked and sent to a colleague, and all four run the same query.
 */

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;

export default async function BusinessesPage({ searchParams }: { searchParams: Params }) {
  const seat = await requireStaff();
  const params = await searchParams;
  const now = new Date();

  const filter = normaliseAccountFilter(params);
  const page = pageFrom(params);

  const [summary, result, badges, plans, sectors, segments] = await Promise.all([
    accountSummary(now),
    readAccountPage(filter, page, now),
    getAdminNavBadges(seat),
    prisma.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true } }),
    prisma.category.findMany({
      where: { parentId: null },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }),
    listSegments(seat.actor, now),
  ]);

  const filtered = hasAnyFilter(filter);
  const currentQuery = toQueryString(filter);
  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.total, result.page * result.pageSize);
  const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const atRiskActive = filter.health === "churn_risk";
  const atRiskHref = `/admin/businesses?${toQueryString(
    atRiskActive ? { ...filter, health: undefined } : { ...filter, health: "churn_risk", sort: "reply_rate" },
  )}`;
  const exportHref = `/admin/businesses/export${currentQuery ? `?${currentQuery}` : ""}`;
  const threshold = formatPercent(CHURN_RISK_BELOW);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/businesses"
      title={t("admin.businesses.title")}
      eyebrow={t("admin.businesses.eyebrow")}
      meta={
        <span className="text-caption text-body">
          {t("admin.businesses.meta_counts", {
            total: formatCount(summary.listings),
            claimed: formatCount(summary.claimed),
            paying: formatCount(summary.paying),
          })}
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          <SegmentsMenu
            segments={segments.map((segment) => ({ ...segment }))}
            currentQuery={currentQuery}
            canSave={filtered}
            save={saveSegmentAction}
            remove={deleteSegmentAction}
          />
          <a href={exportHref} download className={buttonClassName({ variant: "secondary" })}>
            {filtered ? t("admin.businesses.export_filtered") : t("admin.businesses.export")}
          </a>
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <div>
          <TableToolbar>
            <form
              method="get"
              action="/admin/businesses"
              role="search"
              aria-label={t("admin.businesses.filter_label")}
              className="flex w-full flex-wrap items-end gap-2 py-1"
            >
              <label className="flex min-w-60 flex-1 flex-col gap-1">
                <span className="text-caption font-medium text-body">{t("admin.businesses.filter.q")}</span>
                <Input
                  name="q"
                  type="search"
                  defaultValue={filter.q ?? ""}
                  placeholder={t("admin.businesses.filter.q_placeholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <FilterSelect
                name="plan"
                label={t("admin.businesses.filter.plan")}
                value={filter.plan}
                any={t("admin.businesses.filter.any_plan")}
                options={[
                  ...plans.map((plan) => ({ value: plan.id, label: plan.name })),
                  { value: "none", label: t("admin.businesses.filter.no_plan") },
                ]}
              />
              <FilterSelect
                name="emirate"
                label={t("admin.businesses.filter.emirate")}
                value={filter.emirate}
                any={t("admin.businesses.filter.any_emirate")}
                options={EMIRATES.map((emirate) => ({ value: emirate, label: t(`emirate.${emirate}` as MessageKey) }))}
              />
              <FilterSelect
                name="sector"
                label={t("admin.businesses.filter.sector")}
                value={filter.sector}
                any={t("admin.businesses.filter.any_sector")}
                options={sectors.map((sector) => ({ value: sector.id, label: sector.name }))}
              />
              <FilterSelect
                name="tier"
                label={t("admin.businesses.filter.tier")}
                value={filter.tier === undefined ? undefined : String(filter.tier)}
                any={t("admin.businesses.filter.any_tier")}
                options={[0, 1, 2].map((tier) => ({
                  value: String(tier),
                  label: t("admin.businesses.tier_option", { tier: String(tier) }),
                }))}
              />
              <FilterSelect
                name="health"
                label={t("admin.businesses.filter.health")}
                value={filter.health}
                any={t("admin.businesses.filter.any_health")}
                options={ACCOUNT_STATES.map((state) => ({ value: state, label: stateLabel(state) }))}
              />
              <FilterSelect
                name="kind"
                label={t("admin.businesses.filter.kind")}
                value={filter.kind}
                any={t("admin.businesses.filter.any_kind")}
                options={KINDS.map((kind) => ({ value: kind, label: t(`admin.businesses.kind.${kind}` as MessageKey) }))}
              />
              <FilterSelect
                name="sort"
                label={t("admin.businesses.filter.sort")}
                value={filter.sort ?? "name"}
                options={[
                  { value: "name", label: t("admin.businesses.sort.name") },
                  { value: "reply_rate", label: t("admin.businesses.sort.reply_rate") },
                ]}
              />
              <div className="flex items-center gap-2">
                <Button type="submit" variant="secondary">
                  {t("admin.businesses.filter.apply")}
                </Button>
                {filtered ? (
                  <Link href="/admin/businesses" className={buttonClassName({ variant: "ghost" })}>
                    {t("admin.businesses.filter.clear")}
                  </Link>
                ) : null}
              </div>
            </form>
          </TableToolbar>
          <div className="flex flex-wrap items-center justify-between gap-2 border-x border-line bg-card px-3 py-2">
            {/* B4: the same count as the panel below, from the same query. */}
            <Link
              href={atRiskHref}
              aria-current={atRiskActive ? "true" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-ctl border px-3 py-1.5 text-body-sm focus-visible:shadow-focus focus-visible:outline-none",
                atRiskActive ? "border-bad-line bg-bad-surface text-bad-ink" : "border-bad-line bg-bad-wash text-bad-ink",
              )}
            >
              {t("admin.businesses.chip_at_risk", { n: formatCount(summary.churnRisk) })}
            </Link>
            <p className="text-caption text-body" aria-live="polite">
              {result.total === 0
                ? t("admin.businesses.range_none")
                : t("admin.businesses.range", {
                    from: formatCount(from),
                    to: formatCount(to),
                    total: formatCount(result.total),
                  })}
            </p>
          </div>
          <AccountsTable
            rows={result.rows.map(toTableRow)}
            caption={filtered ? t("admin.businesses.caption_filtered") : t("admin.businesses.caption")}
            filtered={filtered}
          />
        </div>

        {lastPage > 1 ? (
          <nav aria-label={t("admin.businesses.pages_label")} className="flex flex-wrap items-center justify-end gap-2">
            {result.page > 1 ? (
              <Link
                href={`/admin/businesses?${toQueryString(filter, { page: result.page - 1 })}`}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("admin.businesses.previous")}
              </Link>
            ) : null}
            <span className="text-caption text-body">
              {t("admin.businesses.page_of", { page: formatCount(result.page), pages: formatCount(lastPage) })}
            </span>
            {result.page < lastPage ? (
              <Link
                href={`/admin/businesses?${toQueryString(filter, { page: result.page + 1 })}`}
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("admin.businesses.next")}
              </Link>
            ) : null}
          </nav>
        ) : null}

        <div className="grid gap-[var(--gutter)] lg:grid-cols-2">
          <section
            aria-labelledby="panel-at-risk"
            className={cn(
              "flex flex-col items-start gap-3 rounded-panel border p-5",
              summary.churnRisk > 0 ? "border-bad-line bg-bad-surface" : "border-line bg-card",
            )}
          >
            <h2
              id="panel-at-risk"
              className={cn(
                "font-mono text-eyebrow uppercase",
                summary.churnRisk > 0 ? "text-bad-ink" : "text-body",
              )}
            >
              {t("admin.businesses.panel.at_risk_title", { count: summary.churnRisk, n: formatCount(summary.churnRisk) })}
            </h2>
            <p className={cn("max-w-prose text-body", summary.churnRisk > 0 ? "text-bad-ink" : "text-prose")}>
              {summary.churnRisk > 0
                ? t("admin.businesses.panel.at_risk_body", { count: summary.churnRisk, threshold })
                : t("admin.businesses.panel.at_risk_clear", { threshold })}
            </p>
            {summary.churnRisk > 0 ? (
              <Link
                href={`/admin/businesses?${toQueryString({ health: "churn_risk", sort: "reply_rate" } satisfies AccountFilter)}`}
                className={buttonClassName({ variant: "danger" })}
              >
                {t("admin.businesses.panel.open_list")}
              </Link>
            ) : null}
          </section>

          <section
            aria-labelledby="panel-upgrade"
            className="flex flex-col items-start gap-3 rounded-panel border border-line bg-card p-5"
          >
            <h2 id="panel-upgrade" className="font-mono text-eyebrow uppercase text-body">
              {t("admin.businesses.panel.upgrade_title", {
                count: summary.upgradeCandidates,
                n: formatCount(summary.upgradeCandidates),
              })}
            </h2>
            <p className="max-w-prose text-body text-prose">
              {summary.upgradeCandidates > 0
                ? t("admin.businesses.panel.upgrade_body", { days: UPGRADE_WINDOW_DAYS })
                : t("admin.businesses.panel.upgrade_clear", { days: UPGRADE_WINDOW_DAYS })}
            </p>
            {summary.upgradeCandidates > 0 ? (
              <Link
                href={`/admin/businesses?${toQueryString({ health: "upgrade_candidate" } satisfies AccountFilter)}`}
                className={buttonClassName({ variant: "secondary" })}
              >
                {t("admin.businesses.panel.open_list")}
              </Link>
            ) : null}
          </section>
        </div>
      </div>
    </AdminPage>
  );
}

function FilterSelect({
  name,
  label,
  value,
  any,
  options,
}: {
  name: string;
  label: string;
  value: string | undefined;
  /** The "no filter" option. Omitted for a control that always has a value. */
  any?: string;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <label className="flex min-w-36 flex-col gap-1">
      <span className="text-caption font-medium text-body">{label}</span>
      <Select
        name={name}
        defaultValue={value ?? ""}
        options={any ? [{ value: "", label: any }, ...options] : options}
      />
    </label>
  );
}
