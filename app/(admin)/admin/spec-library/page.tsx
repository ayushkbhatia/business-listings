import { notFound } from "next/navigation";
import Link from "next/link";
import { Tabs } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { coverage, libraryHeader, proposedFields, specLibrary } from "@/lib/spec/library";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { scopeLibrary } from "@/lib/services/family-library";
import { TemplateTable } from "./TemplateTable";
import { ScopeTab } from "./ScopeTab";
import { CoverageCard, DraftCard, ProposedCard } from "./_rail";
import { CoverageTable } from "./CoverageTable";
import { ProposedTable } from "./ProposedTable";
import { NewTemplatePanel } from "./NewTemplatePanel";

/**
 * Board 4e — the global spec library.
 *
 * The templates sellers clone. A library template is the platform's opinion
 * about how a kind of product is described: which attributes it has, in what
 * order, which of them buyers can filter on, and which vary between variants of
 * the same product. A seller clones one and it becomes theirs (`3h`); the
 * product editor enforces it (`3g`); the buyer reads the result as a spec table
 * (`1g`).
 *
 * The screen has three jobs and the board did one of them:
 *
 *   1. **Author and version templates.** The board's part, and mostly right —
 *      except that its one publish button had two blast radii inside it. See
 *      `lib/spec/versions.ts`.
 *   2. **Keep the field set comparable per subcategory.** Facets are
 *      platform-owned per category (`3h`), so this is where they are set.
 *   3. **Cover demand.** The board rendered the coverage gap — every
 *      subcategory whose products carry no comparable fields at all — as a
 *      single table row, with a `Create` link sitting in the `VERSION` column.
 *      One row type doing two jobs, and a value column holding an action.
 *
 * Coverage is what this screen is for, so it leads: a counted header figure, a
 * tab, and a rail card ranked by products already listed without a template.
 * Templates and subcategories are separate views of separate entities.
 *
 * Every count is a query — criterion 12. The board hardcoded all of them.
 */

export const dynamic = "force-dynamic";

type View = "templates" | "scope" | "coverage" | "drafts" | "proposed";

/*
   Board `4e-s` B1: a tab at the same route rather than a screen of its own.
   Spec sheets and scope sheets are the same kind of artefact for the two halves
   of the directory, and an admin editing one should not have to learn a second
   screen to edit the other.
*/
const VIEWS: View[] = ["templates", "scope", "coverage", "drafts", "proposed"];

function viewFrom(raw: string | undefined): View {
  return VIEWS.includes(raw as View) ? (raw as View) : "templates";
}

export default async function SpecLibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const seat = await requireStaff();
  if (!can(seat.actor, "taxonomy.write")) notFound();

  const [header, rows, gaps, proposals, scope, badges] = await Promise.all([
    libraryHeader(),
    specLibrary(),
    coverage(),
    proposedFields(),
    scopeLibrary(),
    getAdminNavBadges(seat),
  ]);

  const view = viewFrom((await searchParams).view);
  const drafts = rows.filter((row) => row.draftVersion !== null);

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/spec-library"
      title={t("admin.spec.title")}
      eyebrow={t("admin.spec.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.spec.meta", {
            templates: formatCount(header.templates),
            covered: formatCount(header.covered),
            total: formatCount(header.total),
            products: formatCount(header.products),
          })}
        </span>
      }
      actions={
        /*
           `+ New template` on the board. It goes to the coverage view rather
           than opening a form here, because a template needs a subcategory and
           coverage is where the ones that need a template are already named and
           ranked. The board put its `Create` in a template table's `VERSION`
           column instead.
        */
        <Link
          href="/admin/spec-library?view=coverage"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("admin.spec.new.title")}
        </Link>
      }
    >
      {/*
        Tabs as links rather than buttons. Four different entities, and the
        board rendered two of them in one table; each view is a real URL that
        can be opened in a new tab and appears in history.
      */}
      <Tabs
        as="a"
        variant="enclosed"
        label={t("admin.spec.tabs_label")}
        active={view}
        items={[
          {
            key: "templates",
            label: t("admin.spec.tab.templates"),
            href: "/admin/spec-library",
            badge: rows.length,
          },
          {
            key: "coverage",
            label: t("admin.spec.tab.coverage"),
            href: "/admin/spec-library?view=coverage",
            badge: gaps.gaps.length,
          },
          {
            key: "drafts",
            label: t("admin.spec.tab.drafts"),
            href: "/admin/spec-library?view=drafts",
            // Reads `0` rather than disappearing — board 4e's `No drafts`
            // state. A tab that vanishes takes its count with it.
            badge: drafts.length,
          },
          {
            key: "proposed",
            label: t("admin.spec.tab.proposed"),
            href: "/admin/spec-library?view=proposed",
            badge: proposals.length,
          },
          /*
             Board `4e-s`. The badge counts the five rather than every row: the
             fallback is what a subcategory with no family resolves to, not a
             family somebody authored, and counting it would make the screen
             claim six where the design says five.
          */
          {
            key: "scope",
            label: t("admin.scope.tab"),
            href: "/admin/spec-library?view=scope",
            badge: scope.families.filter((family) => !family.isDefault).length,
          },
        ]}
      />

      <div className="mt-[var(--gutter)] flex flex-col gap-[var(--gutter)] xl:flex-row">
        <div className="min-w-0 flex-1">
          {view === "templates" && <TemplateTable rows={rows} />}
          {view === "scope" && <ScopeTab library={scope} specs={header.templates} />}
          {view === "drafts" && <TemplateTable rows={drafts} />}
          {view === "coverage" && <CoverageTable gaps={gaps.gaps} />}
          {view === "proposed" && <ProposedTable rows={proposals} />}
        </div>

        <div className="flex w-full shrink-0 flex-col gap-[var(--gutter)] xl:w-[352px]">
          {view === "coverage" ? (
            <NewTemplatePanel
              subcategories={gaps.gaps
                .filter((gap) => !gap.held)
                .map((gap) => ({ id: gap.id, name: gap.name }))}
            />
          ) : (
            <DraftCard drafts={drafts} />
          )}
          <CoverageCard coverage={gaps} />
          <ProposedCard proposals={proposals} />
        </div>
      </div>

    </AdminPage>
  );
}
