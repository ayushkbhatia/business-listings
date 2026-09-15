import Link from "next/link";
import { notFound } from "next/navigation";
import { renderSection } from "@/components/storefront";
import { buttonClassName, Select } from "@/components/primitives";
import { Alert, Tag } from "@/components/display";
import { SectionLibraryRail } from "@/components/domain/SectionLibraryRail";
import { ServiceEnquiryComposer } from "@/components/domain/ServiceEnquiryComposer";
import { can } from "@/lib/auth/can";
import { requireStaff } from "@/lib/auth/staff";
import { prisma } from "@/lib/db/client";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { sectionLibrary, type LibraryEntry } from "@/lib/storefront/library";
import { sectionDataFor } from "@/lib/storefront/loader";
import type { SectionData } from "@/lib/storefront/render-data";
import { pairedCopies } from "@/lib/strings/store";
import {
  isConfigurable,
  readSettings,
  SETTING_CONTROLS,
} from "@/lib/storefront/section-settings";
import type { ResolvedSection } from "@/lib/storefront/sections";
import { storeCount, storeKinds, templateScopeFor, templateWithSections } from "@/lib/storefront/service";
import { SPECIMEN_DATA, SPECIMEN_WORK_DATA, specimenContentFor } from "@/lib/storefront/specimen-data";
import { AdminPage, getAdminNavBadges } from "../../../../_shell";
import { AddToPage, SectionSettingsForm } from "./LibraryControls";
import { addFromLibrary, saveSectionSettings } from "./actions";

/**
 * Board `5c-s` — the section library for one template, filtered by trade kind.
 *
 * The handoff draws this at `/builder/sections` for a seller composing their
 * own page. In this tree the builder is staff composing a sector's template
 * (`5a`), so the library belongs to a template: it is the same screen with the
 * same filter, at the address its siblings `/theme` and `/pages` already use.
 *
 * Left, the library in its groups — *For service listings*, *Shared*,
 * *Unavailable here* — with the unavailable ones disabled and their reason
 * printed (B1). Right, the selected section rendered through the real renderer,
 * the note on where its content comes from, and the two things *edit* can mean
 * for it: add it to the template, or configure the one already there (B2).
 *
 * ## The preview's data
 *
 * The specimen by default, for the reason the builder shell gives: a canvas
 * backed by a live listing changes under a reviewer and shows one seller's
 * account to every member of staff. But the board asks for *a live preview of
 * the seller's own data*, and a scope grid's gaps are only honest against a
 * real one — so any published store on this template can be picked instead,
 * and its empty states render as the seller would see them.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

/** The specimen that fits: work for a services section, goods for a goods one, either for shared. */
function specimenFor(entry: LibraryEntry, as: "goods" | "services"): SectionData {
  if (entry.type.availableFor === "services") return SPECIMEN_WORK_DATA;
  if (entry.type.availableFor === "goods") return SPECIMEN_DATA;
  return as === "services" ? SPECIMEN_WORK_DATA : SPECIMEN_DATA;
}

export default async function SectionLibraryPage({ params, searchParams }: Params) {
  const seat = await requireStaff();
  if (!can(seat.actor, "storefront.template.write")) notFound();

  const { id } = await params;
  const query = await searchParams;
  const template = await templateWithSections(id);
  if (!template) notFound();

  const [scope, kinds, stores, badges, governed] = await Promise.all([
    templateScopeFor(template.sectorId),
    storeKinds(template.sectorId),
    storeCount(template.sectorId),
    getAdminNavBadges(seat),
    prisma.business.findMany({
      where: {
        sectorId: template.sectorId,
        publishedAt: { not: null },
        mergedIntoId: null,
        suspendedAt: null,
      },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      take: 60,
      select: { id: true, slug: true, displayName: true, sellsKind: true },
    }),
  ]);

  const groups = sectionLibrary(scope, template.sections);
  const entries = groups.flatMap((group) => group.entries);
  const selectable = entries.filter((entry) => entry.state === "available" || entry.state === "in_use");
  const selected =
    selectable.find((entry) => entry.type.key === one(query.section)) ?? selectable[0] ?? null;

  /*
     Which data the preview renders. A store only if it is one this template
     governs — a slug from another sector in the query string is ignored rather
     than trusted, because this page must not become a way to read any listing.
  */
  const storeSlug = one(query.preview);
  const store = storeSlug ? (governed.find((candidate) => candidate.slug === storeSlug) ?? null) : null;
  const as = one(query.as) === "services" || (one(query.as) === null && scope === "services") ? "services" : "goods";

  /*
     A specimen carries the code's words; the preview swaps in the live ones, so
     a half written on /admin/strings/paired shows here as it will on a store.
  */
  const specimen = selected && !store ? specimenFor(selected, as) : null;
  const data: SectionData | null = selected
    ? store
      ? await sectionDataFor(store)
      : { ...specimen!, copy: (await pairedCopies())[specimen!.kind] }
    : null;

  const row = selected
    ? template.sections.find((section) => section.type === selected.type.key)
    : undefined;

  const section: ResolvedSection | null = selected
    ? {
        id: row?.id ?? `library:${selected.type.key}`,
        type: selected.type.key,
        sortOrder: 0,
        enabled: true,
        fixed: selected.type.fixed,
        singleton: selected.type.singleton,
        sellerEditableFields: row?.sellerEditableFields ?? selected.type.sellerFields.map((field) => field.key),
        showOnMobile: true,
        settings: row?.settings ?? {},
        definition: selected.type,
      }
    : null;

  /*
     B5, in the preview: a services listing's enquiry section mounts the service
     composer — which service, the job, the scale, needed by — and not the goods
     lines table. Inert here, with no submit bound; it is the same component the
     storefront binds.
  */
  const enquireSlot =
    data?.kind === "services" && selected?.type.key === "enquiry_form" ? (
      <ServiceEnquiryComposer
        formLabel={t("section.library.composer_label")}
        businessName={data.business.displayName}
        services={(data.work?.services ?? []).map((service) => ({
          slug: service.slug,
          name: service.name,
          familyId: "general",
          requiresFromClient: null,
        }))}
        initialService={null}
        askForContact
        responseLine={
          data.business.responseTimeMedianMs === null
            ? t("response.unmeasured")
            : t("response.median", { duration: formatDuration(data.business.responseTimeMedianMs) })
        }
      />
    ) : undefined;

  const previewName = data?.business.displayName ?? "";
  const label = (entry: LibraryEntry) => t(entry.type.labelKey as never);
  const base = `/admin/storefront-templates/${template.id}/sections`;
  const hrefFor = (key: string) => {
    const next = new URLSearchParams({ section: key });
    if (store) next.set("preview", store.slug);
    else if (one(query.as)) next.set("as", as);
    return `${base}?${next}`;
  };

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/storefront-templates"
      title={`${template.name} — ${t("section.library.title")}`}
      eyebrow={t("section.library.eyebrow", { sector: template.sector.name })}
      meta={
        <span className="text-caption text-muted">
          {t("section.library.meta", { count: formatCount(stores) })}
        </span>
      }
      actions={
        <Link
          className={buttonClassName({ variant: "secondary" })}
          href={`/admin/storefront-templates/${template.id}`}
        >
          {t("theme.back_to_builder")}
        </Link>
      }
    >
      {/*
         The reach, stated with its number. A firm that sells only work renders
         the fixed services storefront (`1d-s`) and no template section reaches
         it yet — so a scope grid added here changes the page of every store
         that sells both, and of none that sells only work.
      */}
      {kinds.services > 0 && (
        <p className="mb-[var(--gutter)] max-w-prose text-caption text-muted">
          {t("section.library.reach_services_only", {
            count: kinds.services,
            formatted: formatCount(kinds.services),
          })}
        </p>
      )}

      <div className="grid gap-[var(--gutter)] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <SectionLibraryRail
          groups={groups}
          scope={scope}
          selectedKey={selected?.type.key ?? null}
          hrefs={Object.fromEntries(entries.map((entry) => [entry.type.key, hrefFor(entry.type.key)]))}
          navLabel={t("section.library.nav_label")}
        />

        <div className="min-w-0">
          {!selected || !section || !data ? (
            <p className="text-body-sm text-muted">{t("section.library.nothing_selectable")}</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h2 className="text-h3 text-ink">{label(selected)}</h2>
                  <span className="font-mono text-eyebrow uppercase text-muted">
                    {t("section.library.preview_of", { name: previewName })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {row && isConfigurable(selected.type.key) && (
                    <a className={buttonClassName({ variant: "secondary" })} href="#section-settings">
                      {t("section.library.settings")}
                    </a>
                  )}
                  {selected.inUse && selected.type.singleton ? (
                    <Tag mono>{t("section.library.on_page")}</Tag>
                  ) : (
                    <AddToPage
                      templateId={template.id}
                      type={selected.type.key}
                      label={label(selected)}
                      storeCount={formatCount(stores)}
                      doneHref={`${hrefFor(selected.type.key)}&added=${selected.type.key}`}
                      action={addFromLibrary}
                    />
                  )}
                </div>
              </div>

              {one(query.added) === selected.type.key && selected.inUse && (
                <div className="mt-3">
                  <Alert tone="ok" live="polite">
                    {t("section.library.added")}
                  </Alert>
                </div>
              )}

              {/* Preview source — a GET form, so it works with no script and the view is a URL. */}
              <form method="get" action={base} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="section" value={selected.type.key} />
                <div className="flex min-w-[16rem] flex-col gap-1">
                  <label htmlFor="preview-source" className="font-mono text-eyebrow uppercase text-muted">
                    {t("section.library.preview_source")}
                  </label>
                  <Select
                    id="preview-source"
                    name="preview"
                    size="sm"
                    defaultValue={store?.slug ?? ""}
                    options={[
                      { value: "", label: t("section.library.preview_specimen") },
                      ...governed.map((candidate) => ({
                        value: candidate.slug,
                        label: t(`section.library.preview_store.${candidate.sellsKind}` as never, {
                          name: candidate.displayName,
                        }),
                      })),
                    ]}
                  />
                </div>
                {selected.type.availableFor === "both" && !store && (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="preview-as" className="font-mono text-eyebrow uppercase text-muted">
                      {t("section.library.preview_as")}
                    </label>
                    <Select
                      id="preview-as"
                      name="as"
                      size="sm"
                      defaultValue={as}
                      options={[
                        { value: "goods", label: t("section.library.as.goods") },
                        { value: "services", label: t("section.library.as.services") },
                      ]}
                    />
                  </div>
                )}
                <button type="submit" className={buttonClassName({ variant: "secondary", size: "sm" })}>
                  {t("section.library.preview_show")}
                </button>
              </form>

              <div data-theme={template.defaultTheme} className="mt-4 rounded-card border border-line bg-paper p-6">
                {renderSection({
                  section,
                  data,
                  content: store ? {} : (specimenContentFor(data)[selected.type.key] ?? {}),
                  enquireHref: `/b/${data.business.slug}#enquire`,
                  enquireSlot,
                  preview: true,
                })}
              </div>

              <p className="mt-3 max-w-prose rounded-card border border-line bg-card px-4 py-3 text-body-sm text-body">
                {t(noteKey(selected) as never, { source: t(selected.type.sourceKey as never) })}
              </p>

              {!row && isConfigurable(selected.type.key) && (
                <p className="mt-2 max-w-prose text-caption text-muted">
                  {t("section.library.settings_after_add")}
                </p>
              )}

              {row && isConfigurable(selected.type.key) && (
                <section
                  id="section-settings"
                  aria-labelledby="section-settings-title"
                  className="mt-[var(--gutter)] scroll-mt-20 rounded-card border border-line bg-card p-5"
                >
                  <h2 id="section-settings-title" className="text-body font-medium text-ink">
                    {t("section.library.settings_title", { section: label(selected) })}
                  </h2>
                  <p className="mt-1 max-w-prose text-caption text-muted">
                    {t("section.library.settings_body", { count: formatCount(stores) })}
                  </p>
                  <div className="mt-4">
                    <SectionSettingsForm
                      templateId={template.id}
                      sectionId={row.id}
                      controls={SETTING_CONTROLS[selected.type.key]}
                      initial={readSettings(selected.type.key, row.settings) as unknown as Record<string, unknown>}
                      optionLabels={optionLabels()}
                      legends={legends()}
                      action={saveSectionSettings}
                    />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </AdminPage>
  );
}

/** Which sentence explains where a section's content comes from. */
function noteKey(entry: LibraryEntry): string {
  if (entry.type.source === "authored") return "section.library.note_authored";
  if (entry.type.availableFor === "services") return "section.library.note_live_services";
  return "section.library.note_live";
}

/** Every option's words, keyed `${control}.${option}`, worded here where `t()` is. */
function optionLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const controls of Object.values(SETTING_CONTROLS)) {
    for (const control of controls) {
      for (const option of control.options) {
        labels[`${control.key}.${option}`] =
          control.kind === "columns"
            ? t(`storefront_services.field.${option}` as "storefront_services.field.engagement")
            : t(`section.settings.${control.key}.${option}` as never);
      }
    }
  }
  return labels;
}

function legends(): Record<string, { legend: string; hint: string }> {
  return {
    columns: { legend: t("section.settings.columns"), hint: t("section.settings.columns_hint") },
    show: { legend: t("section.settings.show"), hint: t("section.settings.show_hint") },
    rows: { legend: t("section.settings.rows"), hint: t("section.settings.rows_hint") },
  };
}
