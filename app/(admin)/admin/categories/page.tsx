import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { categoryOptions, findNode, loadCategoryEditor, loadTaxonomyTree } from "@/lib/taxonomy/board";
import { loadTradeKindBoard } from "@/lib/taxonomy/service";
import { servicesLandingEditor } from "@/lib/taxonomy/services-landing";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { Panel, Tabs } from "@/components/structure";
import { previewTradeKindBulk, setKindBulk } from "./actions";
import { CategoryEditor } from "./CategoryEditor";
import { DemandPanel } from "./DemandPanel";
import { HeaderActions } from "./HeaderActions";
import { TaxonomyTree } from "./TaxonomyTree";
import { TradeKindBoard } from "./TradeKindBoard";
import { VisibilityPanel } from "./VisibilityPanel";
import { ServicesLandingPanel, type ServicesLandingPanelView } from "./ServicesLandingPanel";

/**
 * Board 4d — the category taxonomy. `/admin/categories`.
 *
 * The tree every other screen reads, a category editor beside it, and the
 * demand figures that say whether a category earns its page. Board 4d-s's
 * trade-kind table is the second tab on the same route, as that board asks.
 *
 * **Upstream of nearly everything.** `Category.tradeKind` forks the service
 * track, the default spec template is what every product form inherits, the
 * synonyms route buyers, and the demand figures feed `12d`'s call list. So the
 * rules that matter here are the ones in `lib/taxonomy/`: every count a query,
 * one boolean per public surface, a redirect for every address that moves, and
 * an audit row with a reason for every change.
 *
 * Read by ops lead and moderator (`taxonomy.read`), written by ops lead
 * (`taxonomy.write`), merged by ops lead (`taxonomy.merge`, Q4). A moderator sees
 * every control drawn and disabled, with a line saying whose decision it is —
 * the tree is how they answer "why is this seller filed there".
 */

export const dynamic = "force-dynamic";

type Tab = "tree" | "kind";

/** The tab, from the address. Anything else is the default rather than a 404. */
function tabOf(value: string | undefined): Tab {
  return value === "kind" ? "kind" : "tree";
}

export default async function TaxonomyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; c?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.read")) notFound();
  const canWrite = can(seat.actor, "taxonomy.write");
  const canMerge = can(seat.actor, "taxonomy.merge");

  const params = await searchParams;
  const tab = tabOf(params.tab);

  const [tree, badges, board] = await Promise.all([
    loadTaxonomyTree(),
    getAdminNavBadges(seat),
    tab === "kind" ? loadTradeKindBoard() : Promise.resolve(null),
  ]);

  /*
     The open category: the one asked for, or the first sector — "as drawn, one
     sector expanded, one category selected" — so the editor column is never
     empty on arrival. An id the tree does not hold (a category merged away since
     the link was copied) opens the first sector rather than a 404.
  */
  const selected = (params.c ? findNode(tree, params.c) : null) ?? tree.sectors[0] ?? null;
  const editor = tab === "tree" && selected ? await loadCategoryEditor(tree, selected.id) : null;
  const sector = selected?.parentId ? findNode(tree, selected.parentId) : null;
  /*
     Board `6a-s` — a services trade's landing-page wording and its template
     switch. Read only for a trade that resolves to `services`; a goods trade's
     pages read none of it and the panel is not drawn.
  */
  const landing = editor?.trade.kind === "services" ? await servicesLandingEditor(editor.id) : null;
  const landingView: ServicesLandingPanelView | null = landing
    ? {
        categoryId: landing.categoryId,
        name: landing.name,
        pluralHuman: landing.pluralHuman,
        credentialKind: landing.credentialKind,
        inherited:
          landing.credential.from === "inherited" || landing.credential.from === "family"
            ? { kind: landing.credential.kind, source: landing.credentialSource }
            : null,
        asks: landing.asks.map((ask) => ({ question: ask.question, why: ask.why })),
        openedAt: landing.openedAt ? landing.openedAt.toISOString() : null,
        publishedPages: landing.publishedPages,
      }
    : null;

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/categories"
      title={t("taxonomy.page.title")}
      eyebrow={t("taxonomy.page.eyebrow")}
      meta={
        <span className="text-caption text-body">
          {/* B1: three figures, all off the tree the rows below render. */}
          {[
            t("taxonomy.page.sectors", { count: tree.totals.sectors, n: formatCount(tree.totals.sectors) }),
            t("taxonomy.page.subcategories", { count: tree.totals.subcategories, n: formatCount(tree.totals.subcategories) }),
            t("taxonomy.page.listings", { count: tree.totals.listings, n: formatCount(tree.totals.listings) }),
          ].join(" · ")}
        </span>
      }
      actions={
        tab === "tree" ? (
          <HeaderActions options={categoryOptions(tree)} selectedId={selected?.id ?? null} canWrite={canWrite} canMerge={canMerge} />
        ) : undefined
      }
    >
      <Tabs
        items={[
          { key: "tree", label: t("taxonomy.tab.tree"), href: "/admin/categories" },
          { key: "kind", label: t("taxonomy.tab.kind"), href: "/admin/categories?tab=kind" },
        ]}
        active={tab}
        label={t("taxonomy.page.title")}
        as="a"
      />

      {tab === "kind" && board ? (
        <div className="mt-[var(--gutter)] flex flex-col gap-[var(--gutter)]">
          <TradeKindBoard board={board} canWrite={canWrite} setKindBulk={setKindBulk} preview={previewTradeKindBulk} />

          {/*
             The two cards the 4d-s handoff asks for. They are not decoration:
             this board is the only place either rule is written down where the
             person acting on it will read it.
          */}
          <Panel title={t("taxonomy.kind_inherit_card")}>
            <p className="max-w-prose text-body-sm text-prose">{t("taxonomy.kind_inherit_body")}</p>
          </Panel>
          <Panel title={t("taxonomy.kind_provenance_card")}>
            <p className="max-w-prose text-body-sm text-prose">{t("taxonomy.kind_provenance_body")}</p>
          </Panel>
          <p className="max-w-prose text-caption text-body">
            {t("taxonomy.kind_tally", {
              services: formatCount(board.rows.filter((row) => row.trade.kind === "services").length),
              total: formatCount(board.total),
              set: formatCount(board.decided),
            })}
          </p>
        </div>
      ) : tree.sectors.length === 0 ? (
        /*
           First run: a taxonomy with no rows is a broken install, not a state
           anybody should design around quietly. It says so, and gives the one
           action that fills it.
        */
        <div className="mt-[var(--gutter)] rounded-panel border border-line bg-card px-6 py-10 text-center">
          <p className="text-body text-ink">{t("taxonomy.page.empty_title")}</p>
          <p className="mx-auto mt-1 max-w-prose text-body-sm text-body">{t("taxonomy.page.empty_body")}</p>
        </div>
      ) : (
        <div className="mt-[var(--gutter)] grid items-start gap-[var(--gutter)] lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] board:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <nav aria-label={t("taxonomy.tree.label")} className="min-w-0 lg:sticky lg:top-4">
            <TaxonomyTree key="tree" tree={tree} selectedId={selected?.id ?? null} />
          </nav>

          {editor ? (
            <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
              <CategoryEditor key={editor.id} editor={editor} canWrite={canWrite} />
              <div className="grid items-start gap-[var(--gutter)] wide:grid-cols-2">
                <VisibilityPanel
                  key={`visibility-${editor.id}`}
                  editor={editor}
                  canWrite={canWrite}
                  sectorAcceptsRfq={sector ? sector.acceptsRfq : null}
                />
                <DemandPanel editor={editor} />
              </div>
              {landingView ? (
                <ServicesLandingPanel key={`landing-${editor.id}`} view={landingView} canWrite={canWrite} />
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </AdminPage>
  );
}
