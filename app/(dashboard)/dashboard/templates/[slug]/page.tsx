import Link from "next/link";
import { notFound } from "next/navigation";
import { PageEvent } from "@/components/telemetry/PageEvent";
import { Panel } from "@/components/structure";
import { StatusBadge } from "@/components/display";
import { can } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import {
  fillFor,
  getSellerTemplateBySlug,
  pendingChanges,
  templatesFor,
  type MappedField,
} from "@/lib/catalogue/template";
import type { TemplateChange } from "@/lib/catalogue/template-changes";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { TemplatesRail } from "../_rail";
import { TemplateBoard, type BoardChange, type BoardField } from "../TemplateBoard";
import {
  applyTemplateDraft,
  cloneFromLibrary,
  discardTemplateDraft,
  saveTemplateDraft,
} from "../actions";

/**
 * Board 3h — one spec template.
 *
 * A template decides three things at once and they belong to different owners:
 * what the seller fills in and what it is called (theirs), the order buyers
 * read it in (theirs), and which fields buyers can filter on (the platform's,
 * per category). The board gave all three to the seller; the split is the
 * substance of this screen.
 *
 * It also applies retroactively to products that already exist, so every
 * control here is an edit to a live catalogue rather than a setting for future
 * products. That is why nothing on it writes directly: edits stage a draft and
 * applying is a separate act against a list stating each change's blast radius.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  // The template's own name, not the slug spelled out — "our valve spec" in a
  // browser tab is the URL leaking into the chrome.
  const seat = await requireSellerSeat();
  const { slug } = await params;
  const view = await getSellerTemplateBySlug(seat.businessId, slug);
  return { title: view?.name ?? t("template.title") };
}

export default async function TemplatePage({ params }: { params: Promise<{ slug: string }> }) {
  const seat = await requireSellerSeat();
  // Owner and manager. See the note on the index route: this decides what every
  // product in the catalogue is described by, and the route had no gate at all.
  if (!can(seat.actor, "product.edit")) notFound();

  const { slug } = await params;
  const view = await getSellerTemplateBySlug(seat.businessId, slug);
  if (!view) notFound();

  const [templates, fill, badges, clonable] = await Promise.all([
    templatesFor(seat.businessId),
    fillFor(seat.businessId, view),
    getNavBadges(seat.businessId),
    /*
       What is left in the library.

       "Browse all 84" on the board was a constant of unclear provenance — and
       84 is also the area-page count on board 6a. This is what the query
       returned, minus what this business has already cloned.
    */
    prisma.specTemplate.findMany({
      where: {
        status: "live",
        sellerTemplates: { none: { businessId: seat.businessId } },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  /*
     The draft is what the seller is editing; the applied overlay is what
     products carry. The table renders the draft where there is one, so a seller
     sees their own pending edits rather than the state they have moved on from.
  */
  const shown = view.draft ?? view.fields;
  const changes = pendingChanges(view);

  /*
     Fields the platform has added since this template last tracked it.

     §6: additive platform changes land automatically — the field appears,
     unfilled and not required, with its facet state inherited. Nothing the
     seller has breaks, which is why this is a note rather than a decision.
  */
  const newFields = view.platformVersion > view.tracksVersion ? unfilledNew(shown, fill) : [];

  const fields: BoardField[] = shown.map((field) => {
    const counts = fill.byField.get(field.fieldId) ?? { filled: 0, toFix: 0 };
    return {
      fieldId: field.fieldId,
      label: field.label,
      typeLabel: typeLabel(field),
      type: field.type,
      platformFieldId: field.platformFieldId,
      // The immutable half of the pairing, shown locked. A rename cannot touch
      // it, which is why a rename cannot break comparison.
      mappedTo: field.platformFieldId ? `${categoryKey(view.categorySlug)}.${field.key}` : null,
      platformLabel: field.platformLabel,
      required: field.required,
      platformRequired: field.platformRequired,
      facet: field.facet,
      facetLabel: t(`template.facet.${field.facet}` as "template.facet.platform"),
      varies: field.variesByVariant,
      // Pre-resolved to a string: a function cannot cross into a client
      // component, which is the repeated defect this file already guards.
      variesLabel: t("template.varies"),
      detached: field.detached,
      own: field.own,
      isNew: newFields.includes(field.fieldId),
      options: field.options,
      platformOptions: field.platformOptions,
      unit: field.unit,
      unitDisplay: field.unitDisplay,
      platformSortOrder: field.platformSortOrder,
      filled: counts.filled,
      total: fill.total,
      toFix: counts.toFix,
    };
  });

  const boardChanges: BoardChange[] = changes.map((change) => ({
    sentence: sentenceFor(change),
    blastLabel: blastLabel(change, fill.total, fill.byField.get(change.fieldId)?.toFix ?? 0),
    blast: change.blast,
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/templates"
      eyebrow={t("template.eyebrow")}
      title={view.name}
      meta={
        <span className="flex flex-wrap items-center gap-2 text-caption text-muted">
          {/*
            Two numbers, not one. The board's `v3 · YOUR COPY` claimed the
            seller was on v3 while offering to compare them against platform v3
            and flagging a field new in v3 — which cannot all hold.
          */}
          <StatusBadge tone="neutral" size="sm" shape="chip">
            {/*
                The template is named, because versions are per template.
                Board 4e's library shows v1 and v2 on different rows and there
                is no platform-wide version — read beside that screen, an
                unqualified `tracks platform v3` reads like a release number.
            */}
            {t("template.header_revision", {
              revision: String(view.revision),
              template: view.platformTemplateName,
              version: String(view.tracksVersion),
            })}
          </StatusBadge>
          <span>{t("template.header_applied", { count: fill.total })}</span>
        </span>
      }
      actions={
        <Link
          href={`/dashboard/templates/${view.slug}/history`}
          className="text-body-sm underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("template.history")}
        </Link>
      }
    >
      <PageEvent
        name="template_viewed"
        props={{ fields: fields.length, pending: changes.length, gaps: fill.productsWithGaps }}
      />

      <div className="flex flex-col gap-[var(--gutter)] xl:flex-row">
        <TemplatesRail
          templates={templates}
          clonable={clonable}
          activeSlug={view.slug}
          cloneAction={clone}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-[var(--gutter)]">
          {newFields.length > 0 && (
            <Panel>
              <div className="flex flex-col gap-2">
                <p className="max-w-prose text-body-sm text-ink">
                  <span className="font-medium">
                    {t("template.platform_added", {
                      count: newFields.length,
                      version: String(view.platformVersion),
                    })}
                  </span>{" "}
                  <span className="text-muted">
                    {t("template.platform_body", {
                      field: labelOf(shown, newFields[0]!),
                    })}
                  </span>
                </p>
                {/*
                  The board's nudge read "buyers filtered on Cv in 41 valve
                  searches in Dubai last month". There is no such number:
                  `SearchQueryLog` records the query, the category and the
                  emirate, and not which facets were applied. A figure shown to
                  a seller as a reason to do work has to be one we measured, so
                  this says what we can and cannot tell them instead.
                */}
                <p className="max-w-prose text-caption text-muted">
                  {t("template.platform_no_usage")}
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    href={`/dashboard/products/export?template=${view.slug}`}
                    prefetch={false}
                    className="text-body-sm underline underline-offset-2 focus-visible:outline-none focus-visible:shadow-focus"
                  >
                    {t("template.platform_export", { count: fill.total })}
                  </Link>
                  {/*
                    §6: until board 11d exists the export is a one-way
                    convenience, and the copy must not promise the return leg.
                  */}
                  <span className="text-caption text-muted">
                    {t("template.platform_no_return")}
                  </span>
                </div>
              </div>
            </Panel>
          )}

          <TemplateBoard
            sellerTemplateId={view.id}
            fields={fields}
            changes={boardChanges}
            total={fill.total}
            gaps={fill.productsWithGaps}
            gapsHref="/dashboard/products?gaps=1"
            saveAction={saveTemplateDraft}
            applyAction={applyTemplateDraft}
            discardAction={discardTemplateDraft}
          />
        </div>
      </div>
    </SellerPage>
  );
}

/** React needs a form action that returns nothing. */
async function clone(formData: FormData): Promise<void> {
  "use server";
  await cloneFromLibrary(formData);
}

/** "Select · 18 · DN / inch". Type and unit are one description of the shape. */
function typeLabel(field: MappedField): string {
  const type = TYPE_WORDS[field.type] ?? field.type;
  if (field.options.length > 0) {
    return field.unit
      ? `${type} · ${field.options.length} · ${field.unit}`
      : t("template.type_options", { type, count: field.options.length });
  }
  return field.unit ? t("template.type_unit", { type, unit: field.unit }) : type;
}

const TYPE_WORDS: Record<string, string> = {
  select: "Select",
  multiselect: "Multi-select",
  number: "Number",
  number_range: "Number range",
  text: "Text",
  boolean: "Yes / no",
};

/**
 * The mono field id shown locked in the rail — `valves.nominal_size`.
 *
 * Prefixed by the platform category's family rather than the seller's own
 * template name: the whole point of the pairing is that it is the same string
 * for every seller who holds this field, and a prefix taken from what one
 * seller called their template is not.
 */
function categoryKey(categorySlug: string): string {
  return categorySlug.split("-")[0] ?? categorySlug;
}

function labelOf(fields: readonly MappedField[], fieldId: string): string {
  return fields.find((field) => field.fieldId === fieldId)?.label ?? "";
}

/** Fields carrying nothing at all — what an additive platform change looks like. */
function unfilledNew(
  fields: readonly MappedField[],
  fill: Awaited<ReturnType<typeof fillFor>>,
): string[] {
  return fields
    .filter((field) => !field.own && (fill.byField.get(field.fieldId)?.filled ?? 0) === 0)
    .map((field) => field.fieldId);
}

function sentenceFor(change: TemplateChange): string {
  switch (change.kind) {
    case "renamed":
      return t("template.change.renamed", { from: change.from ?? "", to: change.label });
    case "reordered":
      return t("template.change.reordered", { field: change.label });
    case "required_on":
      return t("template.change.required_on", { field: change.label });
    case "options_narrowed":
      return t("template.change.options_narrowed", { field: change.label });
    case "unit_display":
      return t("template.change.unit_display", { field: change.label });
    case "detached":
      return t("template.change.detached", { field: change.label });
    case "field_added":
      return t("template.change.field_added", { field: change.label });
    case "field_removed":
      return t("template.change.field_removed", { field: change.label });
  }
}

/**
 * What applying one change costs, as a count rather than an adjective.
 *
 * A flag's number is the products missing the field — §5's "6 flagged · none
 * delisted", where the second half is the part that matters. A republish is the
 * whole catalogue on this template, because every product carrying the field
 * now says something different.
 */
function blastLabel(change: TemplateChange, total: number, toFix: number): string {
  switch (change.blast) {
    case "display_only":
      return t("template.blast.display_only");
    case "republish":
      return t("template.blast.republish", { count: total });
    case "flag":
      return t("template.blast.flag", { count: toFix });
  }
}
