import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { categoryHealth } from "@/lib/taxonomy/service";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { CategoryTable } from "./CategoryTable";
import { previewRename, previewTradeKind, remove, rename, setKind } from "./actions";
import { RenamePanel, type TradeOption } from "./RenamePanel";
import { DefaultTemplatePanel, type SubcategoryOption } from "./DefaultTemplatePanel";
import { TradeKindPanel } from "./TradeKindPanel";
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

export default async function TaxonomyPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [rows, badges, templateLinks] = await Promise.all([
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
  const soldByJob = rows.filter((row) => row.trade.kind === "services").length;
  const decided = rows.filter((row) => row.trade.from === "own").length;


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
            total: formatCount(rows.length),
          })}
        </span>
      }
    >
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
        <TradeKindPanel trades={trades} setKind={setKind} preview={previewTradeKind} />
      </div>

      <div className="mt-[var(--gutter)]">
        <DefaultTemplatePanel subcategories={subcategories} />
      </div>

      <div className="mt-[var(--gutter)] flex flex-col gap-1">
        <p className="max-w-prose text-caption text-muted">{t("admin.taxonomy.note")}</p>
        <p className="max-w-prose text-caption text-muted">
          {t("taxonomy.kind_tally", {
            services: formatCount(soldByJob),
            total: formatCount(rows.length),
            set: formatCount(decided),
          })}
        </p>
        <p className="max-w-prose text-caption text-faint">{t("admin.taxonomy.intro_note")}</p>
      </div>
    </AdminPage>
  );
}
