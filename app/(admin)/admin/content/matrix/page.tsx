import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Eyebrow } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Tabs } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { demandVintage } from "@/lib/content/demand";
import { draftableScopes } from "@/lib/content/drafts";
import {
  AREA_ROWS_PER_PAGE,
  areaMatrix,
  matrixGates,
  pageMatrix,
} from "@/lib/content/matrix";
import { contentMetrics } from "@/lib/content/metrics";
import { lastRuleChange, pendingRuleChange } from "@/lib/content/publish-rule";
import { contentQueues } from "@/lib/content/queues";
import { prisma } from "@/lib/db/client";
import { formatCount, formatDate } from "@/lib/format";
import { EMIRATES } from "@/lib/seo/landing";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../../_shell";
import {
  approveRules,
  closeRules,
  generateDraftsAction,
  holdPage,
  previewRules,
  proposeRules,
  publishArea,
  publishEmirate,
  releasePage,
  saveAreaContent,
  saveDemand,
  saveEmirateContent,
  saveIntro,
  unpublishArea,
  unpublishEmirate,
} from "./actions";
import { AreaTable, type AreaRowView } from "./AreaTable";
import { DraftsButton } from "./DraftsButton";
import { emiratePageRows } from "@/lib/seo/emirate";
import { EmirateTable, type EmirateRowView } from "./EmirateTable";
import { MatrixTable, type MatrixRowView } from "./MatrixTable";
import { MetricRow } from "./MetricRow";
import { Queues } from "./Queues";
import { RulesPanel, type PendingChange, type RuleValues } from "./RulesPanel";

/**
 * Board 6f — the page matrix and content operations.
 *
 * Where somebody decides which of roughly eight thousand category × area pages
 * exist. Two halves that are easy to mistake for one: the **matrix** is a
 * demand-and-supply report, and the **rules panel** is the policy that turns
 * that report into published URLs. Everything else is a queue somebody works.
 *
 * `taxonomy.write`, which is `OPS_LEAD_ONLY`. The board asks for the rules to
 * be gated "above ordinary content ops" and there is no rung above ops lead to
 * gate them at — so the escalation is the second approver in `RulesPanel`, and
 * the panel says so out loud rather than implying a hierarchy that does not
 * exist.
 */

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function one(params: Record<string, string | string[] | undefined>, key: string): string {
  const raw = params[key];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

export default async function MatrixPage({ searchParams }: Props) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const params = await searchParams;
  const categoryId = one(params, "category");
  const emirate = one(params, "emirate");
  const page = Math.max(1, Number(one(params, "page")) || 1);

  const filter = {
    ...(categoryId ? { categoryId } : {}),
    ...(emirate ? { emirate } : {}),
    page,
  };

  const [sectors, matrix, areas, emirates, metrics, queues, vintage, drafts, badges] =
    await Promise.all([
      prisma.category.findMany({
        where: { parentId: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          publishThreshold: true,
          demandPerThousand: true,
          verifiedShareMin: true,
          minIntroWords: true,
          holdShare: true,
          minLiveDays: true,
          humanReviewRequired: true,
        },
      }),
      pageMatrix(),
      areaMatrix(filter),
      emiratePageRows(),
      contentMetrics(),
      contentQueues(),
      demandVintage(),
      draftableScopes(categoryId || undefined),
      getAdminNavBadges(seat),
    ]);

  /*
     The rules panel edits one trade at a time. With no filter it opens on the
     first sector rather than on nothing — a panel that showed empty until
     somebody filtered would hide the most consequential control on the console
     behind a step nobody would guess at.
  */
  const selected = sectors.find((sector) => sector.id === categoryId) ?? sectors[0] ?? null;
  const [pendingChange, lastChange] = selected
    ? await Promise.all([pendingRuleChange(selected.id), lastRuleChange(selected.id)])
    : [null, null];

  const rows: MatrixRowView[] = matrix.rows.map((row) => ({
    id: row.id,
    path: row.path,
    name: row.name,
    parentName: row.parentName,
    listings: formatCount(row.listings),
    verifiedShare: row.listings === 0 ? "—" : `${Math.round(row.verifiedShare * 100)}%`,
    introWords: row.introWords,
    intro: row.intro,
    publishable: row.publishable,
    minWords: row.minWords,
    failing: row.failing,
  }));

  const areaRows: AreaRowView[] = areas.rows.map((row) => ({
    areaId: row.areaId,
    categoryId: row.categoryId,
    emirate: row.emirate,
    path: row.path,
    areaName: row.areaName,
    categoryName: row.categoryName,
    listings: row.listings,
    need: row.need,
    needBasis: row.needBasis,
    absoluteFloor: sectors.find((s) => s.id === row.categoryId)?.publishThreshold ?? row.need,
    shortfall: row.shortfall,
    verifiedShare:
      row.listings === 0 ? "—" : `${Math.round((row.verified / row.listings) * 100)}%`,
    monthlySearches: row.monthlySearches,
    demandSource: row.demandSource ?? "",
    demandCapturedAt: row.demandCapturedAt
      ? row.demandCapturedAt.toISOString().slice(0, 10)
      : "",
    introWords: row.introWords,
    intro: row.intro ?? "",
    published: row.published,
    live: row.live,
    clearsFloors: row.failing.length === 0,
    heldAt: row.heldAt ? formatDate(row.heldAt) : null,
    heldReason: row.heldReason,
    status: row.status,
    failing: row.failing,
    content: {
      metaDescription: row.metaDescription ?? "",
      faq: row.faq,
      relatedSearches: row.relatedSearches,
    },
  }));

  const emirateRows: EmirateRowView[] = emirates.map((row) => ({
    emirate: row.emirate,
    emirateName: t(`emirate.${row.emirate}` as never),
    categoryId: row.categoryId,
    path: row.path,
    categoryName: row.categoryName,
    listings: formatCount(row.listings),
    verifiedShare:
      row.listings === 0 ? "—" : `${Math.round((row.verified / row.listings) * 100)}%`,
    introWords: row.introWords,
    intro: row.intro ?? "",
    published: row.publishedAt !== null,
    live: row.live,
    clearsFloors: row.clearsFloors,
    failing: matrixGates(row.failing),
    content: {
      metaDescription: row.metaDescription ?? "",
      faq: row.faq.map((item) => ({
        question: item.question,
        answer: item.answer,
        scopeSpecific: item.scopeSpecific,
        liveToken: item.liveToken,
      })),
      relatedSearches: row.relatedSearches.map((item) => ({
        label: item.label,
        href: item.href,
      })),
    },
  }));

  const pages = Math.max(1, Math.ceil(areas.total / AREA_ROWS_PER_PAGE));
  const query = (next: number) => {
    const search = new URLSearchParams();
    if (categoryId) search.set("category", categoryId);
    if (emirate) search.set("emirate", emirate);
    if (next > 1) search.set("page", String(next));
    const suffix = search.toString();
    return suffix ? `/admin/content/matrix?${suffix}` : "/admin/content/matrix";
  };

  const rules: RuleValues | null = selected
    ? {
        publishThreshold: selected.publishThreshold,
        demandPerThousand: selected.demandPerThousand,
        verifiedShareMin: selected.verifiedShareMin,
        minIntroWords: selected.minIntroWords,
        holdShare: selected.holdShare,
        minLiveDays: selected.minLiveDays,
        humanReviewRequired: selected.humanReviewRequired,
      }
    : null;

  const pending: PendingChange | null =
    pendingChange && rules
      ? {
          id: pendingChange.id,
          after: pendingChange.after as unknown as RuleValues,
          impact: pendingChange.impact as unknown as PendingChange["impact"],
          countedAt: formatDate(pendingChange.impactAt),
          proposedBy: pendingChange.proposedBy.fullName ?? pendingChange.proposedBy.email ?? "—",
          proposedOn: formatDate(pendingChange.createdAt),
          reason: pendingChange.proposedReason,
          mine: pendingChange.proposedById === seat.actor.id,
        }
      : null;

  const listQueue = queues.find((queue) => queue.key === "list_reaudit");
  const driftCount = queues.find((queue) => queue.key === "list_drift")?.count ?? 0;
  const guideQueue = queues.find((queue) => queue.key === "guide_overdue");

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/content/matrix"
      title={t("matrix.title")}
      eyebrow={t("matrix.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {vintage
            ? t("matrix.vintage", {
                sources: vintage.sources.join(", "),
                date: formatDate(vintage.oldest),
              })
            : t("matrix.vintage_none")}
        </span>
      }
    >
      {/*
         Board 6f §2. The middle tabs carry counts of items needing attention,
         because three shipped specs depend on queues that were invisible here.
      */}
      <Tabs
        as="a"
        label={t("matrix.tabs_label")}
        active="matrix"
        items={[
          { key: "matrix", label: t("matrix.tab.matrix"), href: "/admin/content/matrix" },
          {
            key: "lists",
            label: t("matrix.tab.lists"),
            href: "/admin/content/lists",
            badge: (listQueue?.count ?? 0) + driftCount,
          },
          {
            key: "guides",
            label: t("matrix.tab.guides"),
            href: "/admin/content/guides",
            badge: guideQueue?.count ?? 0,
          },
          { key: "redirects", label: t("matrix.tab.redirects"), href: "/admin/content/redirects" },
          { key: "home", label: t("matrix.tab.home"), href: "/admin/content/home" },
        ]}
      />

      <div className="mt-[var(--gutter)] flex flex-wrap items-center gap-3">
        <DraftsButton
          count={drafts.length}
          categoryId={categoryId}
          action={generateDraftsAction}
        />
        <Link
          href="/sitemap.xml"
          className={buttonClassName({ variant: "ghost", size: "sm" })}
        >
          {t("matrix.sitemap_status")}
        </Link>
        <span className="text-caption text-muted">{t("matrix.sitemap_note")}</span>
      </div>

      <div className="mt-[var(--gutter)]">
        <MetricRow metrics={metrics} />
      </div>

      {/*
         A GET form, so a filtered view is a URL somebody can send to the person
         who owns the queue. `page` is deliberately absent: changing the filter
         starts at the first page rather than page four of a different list.
      */}
      <form method="get" className="mt-[var(--gutter)] flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase text-muted">
            {t("matrix.filter.category")}
          </span>
          <select
            name="category"
            defaultValue={categoryId}
            className="h-9 rounded-ctl border border-line bg-card px-2.5 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus"
          >
            <option value="">{t("matrix.filter.all")}</option>
            {sectors.map((sector) => (
              <option key={sector.id} value={sector.id}>
                {sector.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-eyebrow uppercase text-muted">
            {t("matrix.filter.emirate")}
          </span>
          <select
            name="emirate"
            defaultValue={emirate}
            className="h-9 rounded-ctl border border-line bg-card px-2.5 text-body-sm text-ink focus-visible:outline-none focus-visible:shadow-focus"
          >
            <option value="">{t("matrix.filter.all")}</option>
            {EMIRATES.map((key) => (
              <option key={key} value={key}>
                {t(`emirate.${key}` as never)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={buttonClassName({ variant: "secondary", size: "sm" })}>
          {t("matrix.filter.apply")}
        </button>
      </form>

      <div className="mt-[var(--gutter)] grid gap-[var(--gutter)] xl:grid-cols-[1fr_23.5rem]">
        <div>
          <AreaTable
            rows={areaRows}
            save={saveAreaContent}
            publish={publishArea}
            unpublish={unpublishArea}
            hold={holdPage}
            release={releasePage}
            saveDemand={saveDemand}
          />

          {/*
             The footer sits under the last row rather than at the bottom of a
             tall card. Board 6f §4 calls a band of empty white above a pinned
             footer "the same defect class as 6d's stranded rail", and below
             about eight rows the footer should sit directly under the table —
             which it does here, because nothing forces the card's height.
          */}
          <div className="mt-[var(--gutter)] flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-muted">
              {t("matrix.page_of", {
                page: String(page),
                pages: String(pages),
                total: formatCount(areas.total),
              })}
            </p>
            <span className="flex gap-2">
              {page > 1 && (
                <Link
                  href={query(page - 1)}
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  {t("matrix.prev")}
                </Link>
              )}
              {page < pages && (
                <Link
                  href={query(page + 1)}
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  {t("matrix.next")}
                </Link>
              )}
            </span>
          </div>

          <div className="mt-[var(--gutter)] rounded-card border border-line bg-card p-3.5">
            <Eyebrow as="p">{t("matrix.col.status")}</Eyebrow>
            <p className="mt-1.5 max-w-prose text-body-sm text-ink">
              {areas.topOpportunity
                ? t("matrix.opportunity_lead", {
                    path: areas.topOpportunity.path,
                    searches: formatCount(areas.topOpportunity.monthlySearches ?? 0),
                    shortfall: formatCount(areas.topOpportunity.shortfall),
                  })
                : t("matrix.opportunity_none")}
            </p>
            <p className="mt-1.5 max-w-prose text-caption text-muted">
              {t("matrix.opportunity_metric")}
            </p>
            {/*
               The hand-off point, and it does not pretend to be wired. Board
               6f puts the supply-gap campaign in 12d's scope and 12d is not
               built, so the control names its owner instead of posting into
               nothing and reporting success.
            */}
            <p className="mt-2.5 text-caption text-muted">
              {t("matrix.send_crm", {
                count: formatCount(
                  areas.rows.filter((row) => row.status === "recruit").length,
                ),
              })}{" "}
              — {t("matrix.send_crm_note")}
            </p>
          </div>
        </div>

        {rules && selected && (
          <RulesPanel
            categoryId={selected.id}
            categoryName={selected.name}
            values={rules}
            pending={pending}
            lastEdited={
              lastChange?.decidedAt
                ? {
                    date: formatDate(lastChange.decidedAt),
                    who: lastChange.proposedBy.fullName ?? lastChange.proposedBy.email ?? "—",
                    approver:
                      lastChange.decidedBy?.fullName ?? lastChange.decidedBy?.email ?? "—",
                  }
                : null
            }
            preview={previewRules}
            propose={proposeRules}
            approve={approveRules}
            close={closeRules}
          />
        )}
      </div>

      <div className="mt-[calc(var(--gutter)*2)]">
        <Queues queues={queues} />
      </div>

      {/*
         Board 6c's emirate pages and the category index, on the same screen
         and for the same reason board 6a's criterion 12 gives: they are in the
         sitemap, so they belong in the matrix that answers for it.
      */}
      <h2 className="mt-[calc(var(--gutter)*2)] text-h2 text-ink">{t("matrix.emirate_tab")}</h2>
      <EmirateTable
        rows={emirateRows}
        save={saveEmirateContent}
        publish={publishEmirate}
        unpublish={unpublishEmirate}
      />
      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">
        {t("matrix.emirate_note")}
      </p>

      <h2 className="mt-[calc(var(--gutter)*2)] text-h2 text-ink">{t("matrix.title")}</h2>
      {matrix.copyOnly > 0 && (
        <Alert tone="info" live="off">
          {t("matrix.copy_only", { count: formatCount(matrix.copyOnly) })}
        </Alert>
      )}
      <MatrixTable rows={rows} save={saveIntro} />
      <p className="mt-[var(--gutter)] max-w-prose text-caption text-muted">{t("matrix.note")}</p>
    </AdminPage>
  );
}
