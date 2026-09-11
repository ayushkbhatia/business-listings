import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { categoryHealth, loadTradeKindBoard } from "@/lib/taxonomy/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { Panel, Tabs } from "@/components/structure";
import { CategoryTable } from "./CategoryTable";
import { previewRename, previewTradeKindBulk, remove, rename, setKindBulk } from "./actions";
import { RenamePanel, type TradeOption } from "./RenamePanel";
import { DefaultTemplatePanel, type SubcategoryOption } from "./DefaultTemplatePanel";
import { TradeKindBoard } from "./TradeKindBoard";
import { prisma } from "@/lib/db/client";

/**
 * Board 4d — the taxonomy, and the floor under every landing page.
 *
 * `Category.publishThreshold` and `verifiedShareMin` have existed since handoff
 * 0 with no reader. This screen is the reader: each category judged against its
 * own numbers rather than one constant for six very different trades.
 *
 * The column that matters is **Landing pages** — publishable or held back, and
 * held back on which half. That is criterion 6, and it is what separates a
 * directory from a doorway-page farm: a hundred thin "Valves in Umm Al Quwain"
 * pages teach a search engine that the site is mostly filler.
 *
 * The table is read-only; `editCategory` is still built and unwired behind it.
 * What handoff 5 added is the panel below it, because criterion 7 asks a rename
 * to produce a working 301 and a rename with no caller produces nothing at all.
 */

export const dynamic = "force-dynamic";

type Tab = "taxonomy" | "kind";

/** The tab, from the address. Anything else is the default rather than a 404. */
function tabOf(value: string | undefined): Tab {
  return value === "kind" ? "kind" : "taxonomy";
}

export default async function TaxonomyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const tab = tabOf((await searchParams).tab);

  const [rows, badges, templateLinks, board] = await Promise.all([
    /*
     * Intro words passed as satisfied. The copy lives with the landing page,
     * which handoff 5 owns, so counting it here would fail every category on a
     * threshold this screen cannot see. The note under the table says so
     * rather than leaving a silent third of the rule unmentioned.
     */
    categoryHealth(),
    getAdminNavBadges(seat),
    /*
       Board 4e criterion 6. `Category.defaultTemplateId` decides which template
       every product-side reader resolves to and nothing on any screen could
       write it — the seeded pump catalogue shipped with it null, so a pump
       seller's required fields were silently never enforced.
    */
    prisma.category.findMany({
      where: { templates: { some: {} } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        parentId: true,
        defaultTemplateId: true,
        templates: { select: { template: { select: { id: true, name: true } } } },
      },
    }),
    /*
       Board 4d-s. Loaded for both tabs rather than only its own, because the
       taxonomy tab's tally is read off the same array — AC7 asks that the
       progress figure and the sort cannot disagree, and the cheapest way to
       guarantee that is for there to be one source of both.
    */
    loadTradeKindBoard(),
  ]);

  const subcategories: SubcategoryOption[] = templateLinks.map((row) => ({
    id: row.id,
    label: row.parentId ? `— ${row.name}` : row.name,
    templates: row.templates.map((link) => link.template),
    defaultTemplateId: row.defaultTemplateId,
  }));

  const blocked = rows.filter((row) => !row.decision.publishable).length;
  /*
     Counted off the rows already loaded, not a constant and not a second query.
     `set` counts rows that answer for themselves, which is the number that says
     how far through the taxonomy ops actually is — it is the one this screen
     exists to move.
  */
  const soldByJob = board.rows.filter((row) => row.trade.kind === "services").length;


  const trades: TradeOption[] = rows.map((row) => ({
    id: row.id,
    label: row.parentId ? `— ${row.name}` : row.name,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/categories"
      title={t("admin.taxonomy.title")}
      eyebrow={t("admin.taxonomy.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.taxonomy.meta", {
            blocked: formatCount(blocked),
            total: formatCount(board.total),
          })}
        </span>
      }
    >
      {/*
         Two tabs, not the four the handoff draws.

         The render shows Sectors / Subcategories / Trade kind / Scope sheets.
         Sectors and subcategories are one table here and always have been —
         splitting them would be a change with no stated purpose — and scope
         sheets is `4e-s`, a board that may never exist: it turns on a question
         about whether services are templated at all. A tab for a board that
         might be cancelled is a dead end somebody has to click to discover.
      */}
      <Tabs
        items={[
          { key: "taxonomy", label: t("taxonomy.tab.taxonomy"), href: "/admin/categories" },
          { key: "kind", label: t("taxonomy.tab.kind"), href: "/admin/categories?tab=kind" },
        ]}
        active={tab}
        label={t("admin.taxonomy.title")}
        as="a"
      />

      {tab === "kind" ? (
        <div className="mt-[var(--gutter)] flex flex-col gap-[var(--gutter)]">
          <TradeKindBoard
            board={board}
            canWrite={can(seat.actor, "taxonomy.write")}
            setKindBulk={setKindBulk}
            preview={previewTradeKindBulk}
          />

          {/*
             The two cards the handoff asks for. They are not decoration: this
             board is the only place either rule is written down where the
             person acting on it will read it, and the second one answers a
             question that was open for a week — why the flag is not on the
             business.
          */}
          <Panel title={t("taxonomy.kind_inherit_card")}>
            <p className="max-w-prose text-body-sm text-prose">{t("taxonomy.kind_inherit_body")}</p>
          </Panel>

          <Panel title={t("taxonomy.kind_provenance_card")}>
            <p className="max-w-prose text-body-sm text-prose">
              {t("taxonomy.kind_provenance_body")}
            </p>
          </Panel>
        </div>
      ) : (
        <div className="mt-[var(--gutter)]">
          <CategoryTable rows={rows} />

          <div className="mt-[var(--gutter)]">
            <RenamePanel
              trades={trades}
              rename={rename}
              remove={remove}
              preview={previewRename}
            />
          </div>

          <div className="mt-[var(--gutter)]">
            <DefaultTemplatePanel subcategories={subcategories} />
          </div>
        </div>
      )}

      <div className="mt-[var(--gutter)] flex flex-col gap-1">
        <p className="max-w-prose text-caption text-muted">{t("admin.taxonomy.note")}</p>
        <p className="max-w-prose text-caption text-muted">
          {t("taxonomy.kind_tally", {
            services: formatCount(soldByJob),
            total: formatCount(board.total),
            set: formatCount(board.decided),
          })}
        </p>
        <p className="max-w-prose text-caption text-faint">{t("admin.taxonomy.intro_note")}</p>
      </div>
    </AdminPage>
  );
}
