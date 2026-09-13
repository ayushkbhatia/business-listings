import Link from "next/link";
import { notFound } from "next/navigation";
import { renderSection } from "@/components/storefront";
import { buttonClassName } from "@/components/primitives";
import { BuilderChrome } from "@/components/structure";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { diffTemplate, type TemplateSnapshot } from "@/lib/storefront/diff";
import { resolveSections } from "@/lib/storefront/sections";
import { sectionType } from "@/lib/storefront/section-types";
import { addableTypes, refusedCount } from "@/lib/storefront/library";
import { SPECIMEN_DATA, SPECIMEN_WORK_DATA, specimenContentFor } from "@/lib/storefront/specimen-data";
import { storeCount, templateScopeFor, templateWithSections } from "@/lib/storefront/service";
import { prisma } from "@/lib/db/client";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Builder, TemplateStatus, type BuilderSection } from "./Builder";
import { addToTemplate, publish, reorder, setFields, toggleSection } from "./actions";

/**
 * Board 5a — the builder shell.
 *
 * The canvas is rendered here, on the server, and passed into the client
 * component as a node. The section renderers are server components; a client
 * preview would be a second set of fourteen renderings that drift from the
 * first fourteen, and the whole point of the model is that staff see a true
 * result rather than an approximation of one.
 *
 * It renders against the specimen supplier rather than a real seller. The board
 * asks for "a real seller's data", and the honest version of that is a
 * consistent one: a canvas backed by a live listing changes under a reviewer
 * when that seller edits their catalogue, and shows one seller's account to
 * every member of staff who opens the builder. The note on the canvas says
 * which it is.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
}

export default async function BuilderPage({ params }: Params) {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const { id } = await params;
  const template = await templateWithSections(id);
  if (!template) notFound();

  const [stores, scope, lastVersion] = await Promise.all([
    storeCount(template.sectorId),
    templateScopeFor(template.sectorId),
    prisma.templateVersion.findFirst({
      where: { templateId: template.id },
      orderBy: { version: "desc" },
      select: { snapshot: true, version: true },
    }),
  ]);

  const changes = diffTemplate(
    (lastVersion?.snapshot as unknown as TemplateSnapshot) ?? null,
    {
      name: template.name,
      sections: template.sections,
      defaultTheme: template.defaultTheme,
      offeredThemes: template.offeredThemes,
      allowCustomHex: template.allowCustomHex,
      typePairing: template.typePairing,
      cornerRadius: template.cornerRadius,
      density: template.density,
      darkHeader: template.darkHeader,
      badgeRemovable: template.badgeRemovable,
    },
  );

  const sections: BuilderSection[] = template.sections.map((section) => {
    const definition = sectionType(section.type);
    return {
      id: section.id,
      type: section.type,
      typeLabel: definition ? t(definition.labelKey as never) : section.type,
      sourceLabel: definition ? t(definition.sourceKey as never) : "",
      enabled: section.enabled,
      fixed: section.fixed,
      showOnMobile: section.showOnMobile,
      sellerEditableFields: section.sellerEditableFields,
      availableFields: (definition?.sellerFields ?? []).map((field) => ({
        key: field.key,
        label: t(field.labelKey as never),
      })),
    };
  });

  /*
   * What can still be added. A singleton already in the template is not
   * offered — the database would refuse it and the service would refuse it
   * first, and a button that always fails is a button nobody should be shown.
   *
   * Board `5c-s`: nor is a type this template's listings have nothing to fill
   * with, or one held for a decision. Those are not hidden — the library lists
   * them with their reasons, and the line under this list says how many and
   * links there.
   */
  const addable = addableTypes(scope, template.sections).map((type) => ({
    key: type.key,
    label: t(type.labelKey as never),
    group: type.group,
  }));

  const specimenOf = (availableFor: string) =>
    availableFor === "services" || scope === "services" ? SPECIMEN_WORK_DATA : SPECIMEN_DATA;

  const canvas = (
    <div data-theme={template.defaultTheme} className="flex flex-col gap-6">
      {resolveSections(template.sections).map((section) => (
        <div key={section.id}>
          {renderSection({
            section,
            /*
               Board `5c-s`: a services section, or any section on a template
               whose stores sell only work, renders against the specimen firm
               that sells work — against the stockist it could only show its
               empty state.
            */
            data: specimenOf(section.definition.availableFor),
            content: specimenContentFor(specimenOf(section.definition.availableFor))[section.type] ?? {},
            /*
               Never the fan-out. Board 1h criterion 3 — and the note on
               `SectionProps.enquireHref` — say a storefront section must not
               link to `/rfq/new`; the canvas and the specimens both did.
            */
            enquireHref: `/b/${SPECIMEN_DATA.business.slug}#enquire`,
            preview: true,
          })}
        </div>
      ))}
    </div>
  );

  return (
    <BuilderChrome
      title={template.name}
      subtitle={template.sector.name}
      exit={
        <Link
          className={buttonClassName({ variant: "ghost", size: "sm" })}
          href="/admin/storefront-templates"
        >
          {t("builder.back")}
        </Link>
      }
      status={t("builder.applies_to", { count: formatCount(stores) })}
      commit={<TemplateStatus status={template.status} />}
      toolbar={
        <>
          <span className="font-mono text-eyebrow uppercase text-muted">
            {t("builder.canvas")}
          </span>
          <Link
            className={buttonClassName({ variant: "ghost", size: "sm" })}
            href={`/admin/storefront-templates/${template.id}/sections`}
          >
            {t("section.library.title")}
          </Link>
          <Link
            className={buttonClassName({ variant: "ghost", size: "sm" })}
            href={`/admin/storefront-templates/${template.id}/theme`}
          >
            {t("theme.title")}
          </Link>
          <Link
            className={buttonClassName({ variant: "ghost", size: "sm" })}
            href={`/admin/storefront-templates/${template.id}/pages`}
          >
            {t("pages.title")}
          </Link>
          <Link
            className={buttonClassName({ variant: "ghost", size: "sm" })}
            href="/admin/storefront-templates/specimens"
          >
            {t("admin.templates.specimens")}
          </Link>
        </>
      }
    >
      <Builder
        templateId={template.id}
        sectorName={template.sector.name}
        storeCount={stores}
        status={template.status}
        sections={sections}
        changes={changes}
        canvas={canvas}
        addable={addable}
        libraryHref={`/admin/storefront-templates/${template.id}/sections`}
        refusedNote={t("section.library.refused_note", {
          count: refusedCount(scope),
          formatted: formatCount(refusedCount(scope)),
        })}
        actions={{ toggleSection, reorder, addToTemplate, setFields, publish }}
      />
    </BuilderChrome>
  );
}
