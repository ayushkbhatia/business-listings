import Link from "next/link";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { Tabs } from "@/components/structure";
import { Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { boostList } from "@/lib/search/boosts";
import { zeroResultCount } from "@/lib/search/zero-results";
import {
  draftState,
  liveBrowseRelevanceMode,
  liveWeights,
  publishHistory,
} from "@/lib/search/settings";
import { MAX_BOOST_POINTS, WEIGHT_KEYS } from "@/lib/search/ranking";
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
 */

export const dynamic = "force-dynamic";

type Tab = "weights" | "boosts" | "history";

function tabOf(value: string | undefined): Tab {
  return value === "boosts" || value === "history" ? value : "weights";
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const seat = await requireStaff();
  const mayWrite = can(seat.actor, "search.ranking.write");
  const tab = tabOf((await searchParams).tab);

  const [live, liveMode, draft, boosts, zeroResults, history, badges] = await Promise.all([
    liveWeights(),
    liveBrowseRelevanceMode(),
    draftState(),
    boostList(),
    zeroResultCount(),
    publishHistory(),
    getAdminNavBadges(seat),
  ]);

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
      ? t(`ranking.impact.gains.${row.gains}` as never)
      : t("ranking.impact.gains.none"),
  }));

  const historyRows: HistoryRowView[] = history.map((row) => ({
    id: row.id,
    when: formatDateTime(row.publishedAt),
    vector: t("ranking.history.vector", { ...row.weights }),
    moved: row.moved
      ? Object.entries(row.moved)
          .map(([key, change]) =>
            key === "browseRelevanceMode"
              ? `${t("ranking.history.mode")} ${change}`
              : `${t(`ranking.weight.${key}` as never)} ${change}`,
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
    { key: "weights", label: t("ranking.tab.weights"), href: "/admin/search" },
    {
      key: "boosts",
      label: t("ranking.tab.boosts"),
      href: "/admin/search?tab=boosts",
      badge: liveBoostCount,
    },
    { key: "history", label: t("ranking.tab.history"), href: "/admin/search?tab=history" },
  ];

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

        {tab === "weights" && (
          <>
            <PublishStrip
              hasDraft={draft !== null}
              draftSummary={draft ? movedSummary(live, draft.weights) : null}
              draftAuthor={draft?.savedBy ?? null}
              draftWhen={draft ? formatTime(draft.savedAt) : null}
              previewState={draft?.previewState ?? "none"}
              previewWhen={draft?.previewRanAt ? formatTime(draft.previewRanAt) : null}
              previewSummary={
                preview
                  ? t("ranking.step.preview_body", {
                      categories: t("ranking.count.categories", {
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
                <RankingEditor
                  weights={draft?.weights ?? live}
                  browseMode={draft?.browseMode ?? liveMode}
                  isDraft={draft !== null}
                  mayWrite={mayWrite}
                  saveDraft={saveDraftWeights}
                />

                {preview && <ImpactTable rows={impactRows} unread={preview.unread} />}
              </div>

              <aside className="flex flex-col gap-[var(--gutter)]">
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

        {tab === "history" && <HistoryTable rows={historyRows} />}

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
 */
function movedSummary(live: RankingWeights, draft: RankingWeights): string {
  const moved = WEIGHT_KEYS.filter((key) => live[key] !== draft[key]).sort(
    (a, b) => Math.abs(draft[b] - live[b]) - Math.abs(draft[a] - live[a]),
  );
  if (moved.length === 0) return t("ranking.history.mode");

  return moved
    .map((key) => `${t(`ranking.weight.${key}` as never)} ${live[key]} → ${draft[key]}`)
    .join(", ");
}
