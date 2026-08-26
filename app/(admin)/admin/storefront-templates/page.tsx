import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { templateLibrary } from "@/lib/storefront/service";
import { BUILDABLE_SECTION_TYPES, SECTION_TYPES } from "@/lib/storefront/section-types";
import { sectors } from "@/lib/taxonomy/sector";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { TemplateTable, type TemplateRowView } from "./TemplateTable";

/**
 * Board 5c — the section library, and the templates that use it.
 *
 * The builder itself is the next step. What is here is the part a reviewer
 * needs first: which sectors have a template, how many storefronts each one
 * governs, and the catalogue of what can go in one.
 *
 * Sectors with no template are named rather than omitted. Four trades out of
 * six still rendering the default storefront is the honest state of this, and a
 * list that showed only what exists would hide the work.
 */

export const dynamic = "force-dynamic";

export default async function StorefrontTemplatesPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const [templates, allSectors, badges] = await Promise.all([
    templateLibrary(),
    sectors(),
    getAdminNavBadges(seat),
  ]);

  const rows: TemplateRowView[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    sectorName: template.sectorName,
    status: template.status,
    version: `v${template.version}`,
    sections: t("admin.templates.section_count", {
      enabled: formatCount(template.enabledSections),
      total: formatCount(template.sections),
    }),
    storeCount: formatCount(template.storeCount),
  }));

  const covered = new Set(templates.filter((t2) => t2.status === "live").map((t2) => t2.sectorId));
  const uncovered = allSectors.filter((sector) => !covered.has(sector.id));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/storefront-templates"
      title={t("admin.templates.title")}
      eyebrow={t("admin.templates.eyebrow")}
      meta={
        <span className="text-caption text-muted">
          {t("admin.templates.meta", {
            live: formatCount(covered.size),
            sectors: formatCount(allSectors.length),
          })}
        </span>
      }
      actions={
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href="/admin/storefront-templates/specimens"
        >
          {t("admin.templates.specimens")}
        </Link>
      }
    >
      <TemplateTable rows={rows} />

      {uncovered.length > 0 && (
        <div className="mt-[var(--gutter)]">
          <Panel title={t("admin.templates.uncovered")}>
            <p className="max-w-prose text-caption text-muted">
              {t("admin.templates.uncovered_body")}
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {uncovered.map((sector) => (
                <li
                  key={sector.id}
                  className="rounded-tag border border-line px-2 py-1 font-mono text-eyebrow uppercase text-muted"
                >
                  {sector.name}
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      )}

      <div className="mt-[var(--gutter)]">
        <Panel title={t("admin.templates.library")}>
          <p className="max-w-prose text-caption text-muted">{t("admin.templates.library_body")}</p>

          <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECTION_TYPES.map((type) => (
              <li
                key={type.key}
                className={
                  type.comingSoon
                    ? "rounded-card border border-dashed border-line bg-paper-sunk p-3 opacity-70"
                    : "rounded-card border border-line bg-card p-3"
                }
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-body-sm text-ink">{t(type.labelKey as never)}</p>
                  <span className="font-mono text-eyebrow uppercase text-faint">
                    {t(`section.group.${type.group}` as never)}
                  </span>
                </div>
                <p className="mt-1 text-caption text-muted">{t(type.sourceKey as never)}</p>
                {type.comingSoon && (
                  <p className="mt-2 text-caption text-faint">{t("section.services.coming")}</p>
                )}
              </li>
            ))}
          </ul>

          <p className="mt-4 text-caption text-faint">
            {t("admin.templates.library_count", {
              buildable: formatCount(BUILDABLE_SECTION_TYPES.length),
              total: formatCount(SECTION_TYPES.length),
            })}
          </p>
        </Panel>
      </div>
    </AdminPage>
  );
}
