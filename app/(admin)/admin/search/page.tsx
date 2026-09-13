import Link from "next/link";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { Tabs } from "@/components/structure";
import { Panel } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { boostList } from "@/lib/search/boosts";
import { vectorReach } from "@/lib/search/impact";
import { zeroResultCount } from "@/lib/search/zero-results";
import {
  draftState,
  liveVectors,
  otherPlanTier,
  publishHistory,
} from "@/lib/search/settings";
import {
  defaultWeightsFor,
  gainsLabelKey,
  isRankingKind,
  MAX_BOOST_POINTS,
  WEIGHT_KEYS,
  weightLabelKey,
  type RankingKind,
} from "@/lib/search/ranking";
import type { RankingWeights } from "@/lib/search/ranking";
import { EMIRATES } from "@/lib/uae";
import { formatCount, formatDate, formatDateTime, formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { addBoost, discardDraftWeights, publishWeights, runPreview, saveDraftWeights } from "./actions";
import { BoostsTab, type BoostRowView } from "./BoostsTab";
import { HistoryTable, type HistoryRowView } from "./HistoryTable";
import { ImpactTable, type ImpactRowView } from "./ImpactTable";
import { PublishStrip } from "./PublishStrip";
import { RankingEditor } from "./RankingEditor";

/**
 * Board 12c — ranking, boosts, and the history of both.
 *
 * ## Who may open it
 *
 * `search.ranking.write` is ops-lead-only and stays that way: it is the
 * narrowest grant in the permissions table, and publishing reorders every
 * result on the platform. But reading is not adjusting, and the board's states
 * table asks for every other staff seat to see the numbers read-only — they are
 * how anyone here answers a seller asking why they moved. So the page requires
 * a staff seat and the capability gates the controls, not the door.
 *
 * ## Two vectors, one board — `12c-s` B1
 *
 * `?vector=services` selects the services vector. It is a query parameter on
 * this route rather than a second route, because the board is one screen: the
 * editor, the preview, the publish strip and the history are the same
 * components, and a second URL would be the first step towards a second screen.
 * Boosts are not keyed — a boost is points added after either vector — so the
 * boosts tab carries no toggle.
 */

export const dynamic = "force-dynamic";

type Tab = "weights" | "boosts" | "history";

function tabOf(value: string | undefined): Tab {
  return value === "boosts" || value === "history" ? value : "weights";
}

/** The board's own URL, carrying the vector and the tab. Goods is the bare route. */
function hrefFor(vector: RankingKind, tab: Tab): string {
  const params = new URLSearchParams();
  if (tab !== "weights") params.set("tab", tab);
  if (vector !== "goods") params.set("vector", vector);
  const query = params.toString();
  return query ? `/admin/search?${query}` : "/admin/search";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; vector?: string }>;
}) {
  const seat = await requireStaff();
  const mayWrite = can(seat.actor, "search.ranking.write");
  const params = await searchParams;
  const tab = tabOf(params.tab);
  const vector: RankingKind = params.vector && isRankingKind(params.vector) ? params.vector : "goods";
  const services = vector === "services";

  const [live, draft, boosts, zeroResults, history, badges, other, reach] = await Promise.all([
    liveVectors(),
    draftState(vector),
    boostList(),
    zeroResultCount(),
    publishHistory(vector),
    getAdminNavBadges(seat),
    otherPlanTier(vector),
    vectorReach(),
  ]);

  const published = services ? live.services : live.goods;
  const liveBoostCount = boosts.filter((boost) => !boost.expired).length;

  const boostRows: BoostRowView[] = boosts.map((boost) => ({
    id: boost.id,
    target: boost.target,
    points: t("ranking.points_value", { points: boost.points }),
    reason: boost.reason,
    author: boost.author,
    expires: formatDate(boost.expiresAt),
    expired: boost.expired,
    stacking: boost.stacking
      ? t("ranking.boost.stacking", {
          held: boost.stacking.held,
          max: boost.stacking.max,
          with: boost.stacking.with.join(", "),
        })
      : boost.spendsPerMember !== null
        ? t("ranking.boost.spends", { points: boost.spendsPerMember, max: MAX_BOOST_POINTS })
        : null,
  }));

  const preview = draft?.preview ?? null;

  const impactRows: ImpactRowView[] = (preview?.rows ?? []).map((row) => ({
    key: `${row.categoryId}:${row.emirate ?? ""}`,
    scopeLabel: row.scopeLabel,
    moving: row.moving,
    total: row.total,
    fallName: row.biggestFall?.name ?? null,
    fallPlaces: row.biggestFall?.places ?? null,
    gains: row.gains
      ? t(gainsLabelKey(row.vector ?? "goods", row.gains) as never)
      : t("ranking.impact.gains.none"),
  }));

  const historyRows: HistoryRowView[] = history.map((row) => ({
    id: row.id,
    when: formatDateTime(row.publishedAt),
    vector: t(services ? "ranking.history.vector.services" : "ranking.history.vector", {
      ...row.weights,
    }),
    moved: row.moved
      ? Object.entries(row.moved)
          .map(([key, change]) =>
            key === "browseRelevanceMode"
              ? `${t("ranking.history.mode")} ${change}`
              : `${t(weightLabelKey(vector, key as (typeof WEIGHT_KEYS)[number]) as never)} ${change}`,
          )
          .join(" · ") || t("ranking.history.mode")
      : t("ranking.history.first"),
    reason: row.reason,
    author: row.author,
    told: row.sellersTold === null ? "—" : formatCount(row.sellersTold),
  }));

  const sellerCount =
    preview !== null ? t("ranking.count.sellers", { count: preview.sellersTold }) : null;

  const tabs = [
    { key: "weights", label: t("ranking.tab.weights"), href: hrefFor(vector, "weights") },
    {
      key: "boosts",
      label: t("ranking.tab.boosts"),
      href: hrefFor(vector, "boosts"),
      badge: liveBoostCount,
    },
    { key: "history", label: t("ranking.tab.history"), href: hrefFor(vector, "history") },
  ];

  /*
     What the draft moves, against what listings of this kind rank on today.
     For a services vector nobody has published that is the goods vector — the
     honest baseline, because it is what a services listing is scored by until
     this publishes — and the two replaced slots are named even where their
     numbers match, since the measure behind them changes on the first publish.
  */
  const baseline = published ?? live.goods;
  const draftSummary = draft
    ? [
        movedSummary(vector, baseline, draft.weights),
        ...(services && !live.services ? [t("ranking.draft.replaces")] : []),
      ]
        .filter(Boolean)
        .join("; ")
    : null;

  const latestPublish = history[0]?.publishedAt ?? null;
  const status: { label: string; tone: "ok" | "warn" | "neutral" } = published
    ? {
        label: latestPublish
          ? t("ranking.vector.status.live", { date: formatDate(latestPublish) })
          : t("ranking.vector.status.live_undated"),
        tone: "ok",
      }
    : draft
      ? { label: t("ranking.vector.status.draft"), tone: "warn" }
      : { label: t("ranking.vector.status.none"), tone: "neutral" };

  const vectorToggle = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <Tabs
        variant="enclosed"
        as="a"
        label={t("ranking.vector.label")}
        active={vector}
        items={(["goods", "services"] as const).map((kind) => ({
          key: kind,
          label: t(`ranking.vector.${kind}`),
          href: hrefFor(kind, tab),
        }))}
      />
      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
    </div>
  );

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/search"
      title={t("ranking.title")}
      eyebrow={t("ranking.eyebrow")}
      /* `text-body`, not `text-muted`: the board's own markup sits darker than
         the ramp rather than forking a shared component. docs/contrast.md */
      meta={
        <span className="text-caption text-body">
          {t("ranking.meta", {
            live: formatCount(liveBoostCount),
            expired: formatCount(boosts.length - liveBoostCount),
          })}
        </span>
      }
    >
      <div className="flex flex-col gap-[var(--gutter)]">
        <Tabs items={tabs} active={tab} label={t("ranking.title")} as="a" />

        {tab !== "boosts" && vectorToggle}

        {tab === "weights" && services && (
          /*
             `12c-s` §The defect — the reason this vector exists, stated while it
             is still true and replaced by what is true once it is not. Every
             number in it is a query: the listings are counted by primary
             category, and the points are the goods vector's live weight.
          */
          published ? (
            <Alert tone="ok" title={t("ranking.defect.fixed.title")}>
              {reach.servicesMeasured === reach.services
                ? t("ranking.defect.fixed.body", {
                    listings: t("ranking.count.services_listings", { count: reach.services }),
                  })
                : t("ranking.defect.fixed.body_partial", {
                    listings: t("ranking.count.services_listings", { count: reach.services }),
                    measured: formatCount(reach.servicesMeasured),
                    unmeasured: formatCount(reach.services - reach.servicesMeasured),
                  })}
            </Alert>
          ) : (
            <Alert tone="bad" title={t("ranking.defect.title")} fix={t("ranking.defect.fix")}>
              {t("ranking.defect.body", {
                points: live.goods.specCompleteness,
                listings: t("ranking.count.services_listings", { count: reach.services }),
              })}
            </Alert>
          )
        )}

        {tab === "weights" && (
          <>
            <PublishStrip
              key={`strip-${vector}`}
              kind={vector}
              hasDraft={draft !== null}
              draftSummary={draftSummary}
              draftAuthor={draft?.savedBy ?? null}
              draftWhen={draft ? formatTime(draft.savedAt) : null}
              previewState={draft?.previewState ?? "none"}
              previewWhen={draft?.previewRanAt ? formatTime(draft.previewRanAt) : null}
              previewSummary={
                preview
                  ? t("ranking.step.preview_body", {
                      categories: t("ranking.count.categories_move", {
                        count: preview.categoriesMoved,
                      }),
                      listings: t("ranking.count.listings", { count: preview.listingsMoved }),
                    })
                  : null
              }
              sellerCount={sellerCount}
              mayWrite={mayWrite}
              runPreview={runPreview}
              publish={publishWeights}
              discard={discardDraftWeights}
            />

            <div className="grid gap-[var(--gutter)] xl:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
                {/*
                   Keyed by the vector so switching remounts it. The editor holds
                   the numbers in state, and a remount is what stops the goods
                   draft's sliders being carried onto the services vector.

                   And by the last publish, so the editor's own "Draft saved"
                   notice does not outlive the draft: clicking publish left it
                   standing over a board that had no draft any more. A save does
                   not remount it, so that confirmation still reaches the person
                   who pressed the button.
                */}
                <RankingEditor
                  key={`editor-${vector}-${latestPublish?.getTime() ?? "never"}`}
                  kind={vector}
                  weights={draft?.weights ?? published ?? defaultWeightsFor(vector)}
                  browseMode={
                    draft?.browseMode ?? live.modes[vector] ?? live.modes.goods ?? "redistribute"
                  }
                  isDraft={draft !== null}
                  isProposal={draft === null && published === null}
                  compareWith={services ? live.goods : null}
                  otherPlanTier={other}
                  mayWrite={mayWrite}
                  saveDraft={saveDraftWeights}
                />

                {preview && (
                  <Panel title={t("ranking.impact")} description={t("ranking.impact_hint")}>
                    <ImpactTable rows={impactRows} unread={preview.unread} />
                  </Panel>
                )}
              </div>

              <aside className="flex flex-col gap-[var(--gutter)]">
                {/*
                   `12c-s` B1 and B8, said where the controls are: everything on
                   this tab acts on the vector selected above, and nothing else.
                */}
                <Panel eyebrow={t("ranking.two_vectors")}>
                  <p className="max-w-prose text-caption text-body">
                    {t("ranking.two_vectors_body")}
                  </p>
                </Panel>

                {/*
                   `12c-s` B7 — what a publish of this vector can reach, counted.
                   Before a services vector is live, the goods vector ranks the
                   services listings too, and the panel says so rather than
                   claiming a scope the ranker does not have.
                */}
                <Panel title={t("ranking.reach")}>
                  <p className="max-w-prose text-caption text-body">
                    {services
                      ? t("ranking.reach.services", {
                          services: t("ranking.count.services_listings", { count: reach.services }),
                          goods: t("ranking.count.goods_listings", { count: reach.goods }),
                        })
                      : live.services
                        ? t("ranking.reach.goods_only", {
                            goods: t("ranking.count.goods_listings", { count: reach.goods }),
                          })
                        : t("ranking.reach.goods_shared", {
                            goods: t("ranking.count.goods_listings", { count: reach.goods }),
                            services: t("ranking.count.services_listings", {
                              count: reach.services,
                            }),
                          })}
                  </p>
                </Panel>

                {/*
                   The console routes "Searches that found nothing" to this board
                   and this board rendered no such number, so the link landed on
                   the ranking sliders. The card carries the console's own label
                   and the same window, and the route out names the work rather
                   than the destination: the queue itself is worked on Ops CRM,
                   and two surfaces onto one queue is how the two disagree.
                */}
                <Panel title={t("ranking.zero_results")}>
                  <p className="font-mono text-h2 tabular-nums text-ink">
                    {formatCount(zeroResults)}
                  </p>
                  <p className="mt-1.5 max-w-prose text-caption text-body">
                    {t("ranking.zero_results_body")}
                  </p>
                  <p className="mt-2">
                    <Link
                      href="/admin/crm"
                      className="text-caption text-moss underline underline-offset-2"
                    >
                      {t("ranking.zero_results_link")} →
                    </Link>
                  </p>
                </Panel>

                {preview && (
                  <Panel eyebrow={t("ranking.disclosure")}>
                    <p className="max-w-prose text-caption text-body">
                      {t("ranking.disclosure_body", {
                        scope: t("ranking.count.sellers", { count: preview.sellersInScope }),
                        count: t("ranking.count.sellers", { count: preview.sellersTold }),
                        when: formatDate(new Date(preview.ranAt)),
                      })}
                    </p>
                    <p className="mt-2 max-w-prose text-caption text-body">
                      {t("ranking.disclosure_note")}
                    </p>
                  </Panel>
                )}

                {/*
                   Read-only here and editable on its own tab, both from
                   `boostList()`. One query, so the rail and the tab cannot
                   disagree about how many are live or what they cost.
                */}
                <Panel
                  title={t("ranking.boosts")}
                  eyebrow={t("ranking.boosts_active", { count: liveBoostCount })}
                >
                  {liveBoostCount === 0 ? (
                    <p className="text-caption text-body">{t("ranking.boosts_empty")}</p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {boosts
                        .filter((boost) => !boost.expired)
                        .map((boost) => (
                          <li key={boost.id} className="flex flex-col gap-0.5">
                            <span className="flex items-baseline justify-between gap-2">
                              <span className="min-w-0 truncate text-caption text-ink">
                                {boost.target}
                              </span>
                              <span className="font-mono text-caption tabular-nums text-ink">
                                {t("ranking.points_value", { points: boost.points })}
                              </span>
                            </span>
                            <span className="text-caption text-body">{boost.reason}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                  <p className="mt-3">
                    <Link
                      href="/admin/search?tab=boosts"
                      className="text-caption text-moss underline underline-offset-2"
                    >
                      {t("ranking.tab.boosts")} →
                    </Link>
                  </p>
                </Panel>
              </aside>
            </div>
          </>
        )}

        {tab === "boosts" && (
          <BoostsTab
            rows={boostRows}
            liveCount={liveBoostCount}
            mayWrite={mayWrite}
            emirates={EMIRATES.map((emirate) => ({
              value: emirate.value,
              label: emirate.label,
            }))}
            addBoost={addBoost}
          />
        )}

        {tab === "history" && (
          <HistoryTable
            rows={historyRows}
            {...(services ? { empty: t("ranking.history.empty.services") } : {})}
          />
        )}

        {!mayWrite && (
          <p className="max-w-prose text-caption text-body">
            <StatusBadge tone="neutral">{t("nav.locked")}</StatusBadge>{" "}
            {t("ranking.read_only")}
          </p>
        )}
      </div>
    </AdminPage>
  );
}

/**
 * "Reply time 18 → 24, relevance 34 → 28" — what the draft moves, in words.
 *
 * Ordered by the size of the move so the largest is read first, and it names
 * the browse mode when that is what changed: a publish that flips the mode and
 * moves no weight still reorders several hundred landing pages, and a summary
 * that read "nothing moved" would be describing the wrong thing.
 *
 * Named for the vector being drafted, so a services draft reads *scope
 * completeness* where the goods one reads *spec completeness*.
 */
function movedSummary(
  vector: RankingKind,
  live: RankingWeights,
  draft: RankingWeights,
): string {
  const moved = WEIGHT_KEYS.filter((key) => live[key] !== draft[key]).sort(
    (a, b) => Math.abs(draft[b] - live[b]) - Math.abs(draft[a] - live[a]),
  );
  if (moved.length === 0) return t("ranking.history.mode");

  return moved
    .map((key) => `${t(weightLabelKey(vector, key) as never)} ${live[key]} → ${draft[key]}`)
    .join(", ");
}
