import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { BUILDABLE_SECTION_TYPES, sectionType } from "./section-types";
import { checkBrandHex, isThemePreset, type HexRefusal as BaseHexRefusal, type ThemePreset } from "@/lib/theme/contrast";
import {
  applyOrder,
  canAddSection,
  canDisable,
  checkSellerFields,
  type SectionRefusal,
  type SectionRow,
} from "./sections";

/**
 * Storefront templates — boards 5a and 5c, the service.
 *
 * The organising fact is that every mutation here is a fan-out. Changing the
 * Industrial template changes every live storefront in that sector, so the
 * store count is computed before the write, carried into the audit row's
 * `after`, and returned to the caller so the screen can name it in the confirm.
 * Criterion 11 asks for exactly that, and putting it in the service rather than
 * in each screen is what stops the fifth screen forgetting.
 *
 * `storefront.template.write` is ops lead only. It has been a declared
 * capability since handoff 3 with nothing behind it.
 */

type HexRefusal = BaseHexRefusal | "not_allowed";

export type TemplateResult<T = unknown> =
  | ({ ok: true; storeCount: number } & T)
  | { ok: false; error: Refusal; message: string };

/** Every way this service says no, and the sentence it says it with. */
type Refusal =
  | SectionRefusal
  | "not_found"
  | "not_a_sector"
  | "sector_taken"
  | "no_theme_offered"
  | "default_not_offered"
  | "radius_out_of_range";

const REFUSAL_MESSAGE: Record<Refusal, string> = {
  unknown_type: "That section type is not one we have built.",
  coming_soon: "Services and packages needs the services model, which is not built yet.",
  singleton_exists: "This template already has one of those, and it is a section that can only appear once.",
  section_is_fixed: "The header stays where it is. Every storefront needs one and it is always first.",
  unknown_field: "That field is not one this section type declares.",
  not_found: "That template is not here.",
  not_a_sector: "A template belongs to a top-level trade, not a subcategory.",
  sector_taken: "That trade already has a live template. Retire it first, or edit the one that is live.",
  no_theme_offered: "Offer at least one theme. A seller with none to pick from gets the default and no choice.",
  default_not_offered: "The default has to be one of the themes on offer, or a seller opens the picker and cannot find the one they are on.",
  radius_out_of_range: "Corner radius is a whole number of pixels from 0 to 24.",
};

function refuse<T>(error: Refusal): TemplateResult<T> {
  return { ok: false, error, message: REFUSAL_MESSAGE[error] };
}

const SECTION_SELECT = {
  id: true, type: true, sortOrder: true, enabled: true, fixed: true, singleton: true,
  sellerEditableFields: true, showOnMobile: true, settings: true,
} as const;

/**
 * How many live storefronts an edit to this template would change.
 *
 * Published listings in the sector. Not every listing: an unpublished one has
 * no storefront to change, and counting it would overstate the blast radius on
 * the screen whose whole job is to state it accurately.
 */
export async function storeCount(sectorId: string): Promise<number> {
  return prisma.business.count({
    where: { sectorId, publishedAt: { not: null }, mergedIntoId: null, suspendedAt: null },
  });
}

export interface TemplateSummary {
  id: string;
  name: string;
  sectorId: string;
  sectorName: string;
  status: string;
  version: number;
  sections: number;
  enabledSections: number;
  storeCount: number;
  publishedAt: Date | null;
}

/** Every template, with what an edit to each would move. */
export async function templateLibrary(): Promise<TemplateSummary[]> {
  const templates = await prisma.storefrontTemplate.findMany({
    orderBy: [{ sector: { name: "asc" } }, { status: "asc" }],
    select: {
      id: true, name: true, sectorId: true, status: true, version: true, publishedAt: true,
      sector: { select: { name: true } },
      sections: { select: { enabled: true } },
    },
  });

  const counts = new Map<string, number>();
  for (const sectorId of new Set(templates.map((template) => template.sectorId))) {
    counts.set(sectorId, await storeCount(sectorId));
  }

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    sectorId: template.sectorId,
    sectorName: template.sector.name,
    status: template.status,
    version: template.version,
    sections: template.sections.length,
    enabledSections: template.sections.filter((section) => section.enabled).length,
    storeCount: counts.get(template.sectorId) ?? 0,
    publishedAt: template.publishedAt,
  }));
}

export async function templateWithSections(id: string) {
  return prisma.storefrontTemplate.findUnique({
    where: { id },
    select: {
      id: true, name: true, sectorId: true, status: true, version: true, publishedAt: true,
      offeredThemes: true, defaultTheme: true, allowCustomHex: true, typePairing: true,
      cornerRadius: true, density: true, darkHeader: true, badgeRemovable: true,
      sector: { select: { id: true, name: true, slug: true } },
      sections: { select: SECTION_SELECT, orderBy: { sortOrder: "asc" } },
      pages: { select: { id: true, slug: true, title: true, status: true }, orderBy: { slug: "asc" } },
    },
  });
}

export interface CreateTemplateInput {
  actor: Actor;
  sectorId: string;
  name: string;
  reason: string;
}

/**
 * A new template, with the sections every storefront needs.
 *
 * Starts as a draft with the header, hero, trust strip, catalogue and enquiry
 * form — the five that make a storefront a storefront. A template that starts
 * empty is a template somebody publishes empty.
 */
export async function createTemplate(input: CreateTemplateInput): Promise<TemplateResult<{ id: string }>> {
  const sector = await prisma.category.findUnique({
    where: { id: input.sectorId },
    select: { id: true, parentId: true },
  });
  if (!sector) return refuse("not_found");
  if (sector.parentId !== null) return refuse("not_a_sector");

  const count = await storeCount(input.sectorId);

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `Category:${input.sectorId}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const template = await tx.storefrontTemplate.create({
          data: {
            sectorId: input.sectorId,
            name: input.name,
            status: "draft",
            offeredThemes: ["default"],
            sections: {
              create: ["header", "hero", "trust_strip", "catalogue_grid", "enquiry_form"].map(
                (type, index) => {
                  const definition = sectionType(type)!;
                  return {
                    type,
                    sortOrder: index,
                    fixed: definition.fixed,
                    singleton: definition.singleton,
                    sellerEditableFields: definition.sellerFields.map((field) => field.key),
                  };
                },
              ),
            },
          },
          select: { id: true },
        });

        return {
          result: template.id,
          before: null,
          after: { name: input.name, sectorId: input.sectorId, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, id, storeCount: count };
}

async function templateFor(templateId: string) {
  return prisma.storefrontTemplate.findUnique({
    where: { id: templateId },
    select: { id: true, sectorId: true, status: true, sections: { select: SECTION_SELECT } },
  });
}

export interface AddSectionInput {
  actor: Actor;
  templateId: string;
  type: string;
  reason: string;
}

export async function addSection(input: AddSectionInput): Promise<TemplateResult<{ sectionId: string }>> {
  const template = await templateFor(input.templateId);
  if (!template) return refuse("not_found");

  const refusal = canAddSection(input.type, template.sections);
  if (refusal) return refuse(refusal);

  const definition = sectionType(input.type)!;
  const count = await storeCount(template.sectorId);
  const nextOrder = Math.max(-1, ...template.sections.map((section) => section.sortOrder)) + 1;

  const sectionId = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const section = await tx.templateSection.create({
          data: {
            templateId: template.id,
            type: input.type,
            sortOrder: nextOrder,
            fixed: definition.fixed,
            singleton: definition.singleton,
            sellerEditableFields: definition.sellerFields.map((field) => field.key),
          },
          select: { id: true },
        });
        return {
          result: section.id,
          before: null,
          after: { added: input.type, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, sectionId, storeCount: count };
}

export interface SectionToggleInput {
  actor: Actor;
  templateId: string;
  sectionId: string;
  enabled: boolean;
  reason: string;
}

export async function setSectionEnabled(
  input: SectionToggleInput,
): Promise<TemplateResult> {
  const template = await templateFor(input.templateId);
  if (!template) return refuse("not_found");

  const section = template.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) return refuse("not_found");

  // Criterion 6. The database refuses it too — `fixed` implies `enabled` — and
  // this is the half that says why.
  if (!input.enabled) {
    const refusal = canDisable(section);
    if (refusal) return refuse(refusal);
  }

  const count = await storeCount(template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.templateSection.update({
          where: { id: section.id },
          data: { enabled: input.enabled },
        });
        return {
          result: null,
          before: { section: section.type, enabled: section.enabled },
          after: { section: section.type, enabled: input.enabled, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

export interface ReorderInput {
  actor: Actor;
  templateId: string;
  orderedIds: string[];
  reason: string;
}

export async function reorderSections(input: ReorderInput): Promise<TemplateResult> {
  const template = await templateFor(input.templateId);
  if (!template) return refuse("not_found");

  const before = [...template.sections].sort((a, b) => a.sortOrder - b.sortOrder);
  const after = applyOrder(before as SectionRow[], input.orderedIds);
  const count = await storeCount(template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        for (const section of after) {
          await tx.templateSection.update({
            where: { id: section.id },
            data: { sortOrder: section.sortOrder },
          });
        }
        return {
          result: null,
          before: { order: before.map((section) => section.type) },
          after: { order: after.map((section) => section.type), storeCount: count },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

export interface SellerFieldsInput {
  actor: Actor;
  templateId: string;
  sectionId: string;
  fields: string[];
  reason: string;
}

export async function setSellerEditableFields(
  input: SellerFieldsInput,
): Promise<TemplateResult> {
  const template = await templateFor(input.templateId);
  if (!template) return refuse("not_found");

  const section = template.sections.find((candidate) => candidate.id === input.sectionId);
  if (!section) return refuse("not_found");

  const refusal = checkSellerFields(section.type, input.fields);
  if (refusal) return refuse(refusal);

  const count = await storeCount(template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.templateSection.update({
          where: { id: section.id },
          data: { sellerEditableFields: input.fields },
        });
        return {
          result: null,
          before: { section: section.type, fields: section.sellerEditableFields },
          after: { section: section.type, fields: input.fields, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

export interface PublishInput {
  actor: Actor;
  templateId: string;
  reason: string;
}

/**
 * Publish, which is where the fan-out actually happens.
 *
 * Retires whatever was live in this sector first — one live template per sector
 * is a partial unique index, and publishing without retiring would be refused
 * by the database rather than by anything a person could read.
 *
 * The version snapshot is written in the same transaction with the store count
 * on it, because the count is the decision: somebody confirmed "this affects
 * 1,842 stores", and a history that lost the number cannot say what was agreed.
 */
export async function publishTemplate(input: PublishInput): Promise<TemplateResult<{ version: number }>> {
  const template = await prisma.storefrontTemplate.findUnique({
    where: { id: input.templateId },
    select: {
      id: true, sectorId: true, status: true, version: true, name: true,
      offeredThemes: true, defaultTheme: true, allowCustomHex: true, typePairing: true,
      cornerRadius: true, density: true, darkHeader: true, badgeRemovable: true,
      sections: { select: SECTION_SELECT, orderBy: { sortOrder: "asc" } },
    },
  });
  if (!template) return refuse("not_found");

  const count = await storeCount(template.sectorId);
  const version = template.status === "live" ? template.version + 1 : template.version;
  const now = new Date();

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.storefrontTemplate.updateMany({
          where: { sectorId: template.sectorId, status: "live", NOT: { id: template.id } },
          data: { status: "retired" },
        });

        await tx.storefrontTemplate.update({
          where: { id: template.id },
          data: { status: "live", version, publishedAt: now },
        });

        await tx.templateVersion.create({
          data: {
            templateId: template.id,
            version,
            storeCount: count,
            publishedBy: input.actor.id,
            reason: input.reason,
            snapshot: {
              name: template.name,
              theme: {
                offeredThemes: template.offeredThemes,
                defaultTheme: template.defaultTheme,
                allowCustomHex: template.allowCustomHex,
                typePairing: template.typePairing,
                cornerRadius: template.cornerRadius,
                density: template.density,
                darkHeader: template.darkHeader,
                badgeRemovable: template.badgeRemovable,
              },
              /*
               * Section ids are in the snapshot and that is the whole point. A
               * restore upserts by id, so `StorefrontContent` — which is keyed
               * to the same id — survives. A snapshot that recreated sections
               * with new ids would silently wipe what every seller in the
               * sector had filled in.
               */
              sections: template.sections,
            },
          },
        });

        return {
          result: null,
          before: { status: template.status, version: template.version },
          after: { status: "live", version, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, version, storeCount: count };
}

export interface RestoreInput {
  actor: Actor;
  templateId: string;
  version: number;
  reason: string;
}

interface Snapshot {
  sections: SectionRow[];
}

/**
 * Criterion 12 — publish is reversible from version history.
 *
 * Upserts sections by their original id. A section deleted since the snapshot
 * comes back with the id it had, which is what keeps every seller's content
 * attached to it. Sections added since are removed, because restoring a version
 * that did not have them and leaving them behind is not a restore.
 */
export async function restoreVersion(input: RestoreInput): Promise<TemplateResult> {
  const [template, snapshotRow] = await Promise.all([
    prisma.storefrontTemplate.findUnique({
      where: { id: input.templateId },
      select: { id: true, sectorId: true, version: true },
    }),
    prisma.templateVersion.findFirst({
      where: { templateId: input.templateId, version: input.version },
      select: { snapshot: true, version: true },
    }),
  ]);
  if (!template || !snapshotRow) return refuse("not_found");

  const snapshot = snapshotRow.snapshot as unknown as Snapshot;
  const count = await storeCount(template.sectorId);
  const keepIds = snapshot.sections.map((section) => section.id);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.templateSection.deleteMany({
          where: { templateId: template.id, NOT: { id: { in: keepIds } } },
        });

        for (const section of snapshot.sections) {
          const data = {
            templateId: template.id,
            type: section.type,
            sortOrder: section.sortOrder,
            enabled: section.enabled,
            fixed: section.fixed,
            singleton: section.singleton,
            sellerEditableFields: section.sellerEditableFields,
            showOnMobile: section.showOnMobile,
            settings: (section.settings ?? {}) as object,
          };
          await tx.templateSection.upsert({
            where: { id: section.id },
            // The id is given, not generated. That is what keeps every seller's
            // filled-in content attached to the section it was filled into.
            create: { id: section.id, ...data },
            update: data,
          });
        }

        return {
          result: null,
          before: { version: template.version },
          after: { restoredFrom: input.version, storeCount: count },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

export interface ThemeInput {
  actor: Actor;
  templateId: string;
  offeredThemes: string[];
  defaultTheme: string;
  allowCustomHex: boolean;
  typePairing: "editorial" | "clean" | "technical";
  density: "compact" | "comfortable" | "roomy";
  cornerRadius: number;
  darkHeader: boolean;
  badgeRemovable: boolean;
  reason: string;
}

/**
 * Board 5b — the theme settings for one template.
 *
 * Two refusals worth naming. A theme nobody wrote tokens for cannot be offered,
 * because `[data-theme="neon"]` matches nothing and the storefront would render
 * with the default palette while the builder said otherwise. And the default
 * has to be one of the offered set, or a seller opens the picker to find the
 * theme they are already on is not in it.
 *
 * The badge-removable flag is a Pro entitlement and is set here rather than on
 * the plan: which sectors may take our badge off is a storefront decision, and
 * `Plan.customDomain` is the shape it follows.
 */
export async function setTemplateTheme(
  input: ThemeInput,
): Promise<TemplateResult<Record<never, never>>> {
  const template = await prisma.storefrontTemplate.findUnique({
    where: { id: input.templateId },
    select: {
      id: true, sectorId: true, offeredThemes: true, defaultTheme: true,
      allowCustomHex: true, typePairing: true, density: true, cornerRadius: true,
      darkHeader: true, badgeRemovable: true,
    },
  });
  if (!template) return refuse("not_found");

  const offered = [...new Set(input.offeredThemes)].filter(isThemePreset);
  if (offered.length === 0) return refuse("no_theme_offered");
  if (!offered.includes(input.defaultTheme as ThemePreset)) return refuse("default_not_offered");
  if (!Number.isInteger(input.cornerRadius) || input.cornerRadius < 0 || input.cornerRadius > 24) {
    return refuse("radius_out_of_range");
  }

  const count = await storeCount(template.sectorId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "storefront.template.write",
        subject: `StorefrontTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.storefrontTemplate.update({
          where: { id: template.id },
          data: {
            offeredThemes: offered,
            defaultTheme: input.defaultTheme,
            allowCustomHex: input.allowCustomHex,
            typePairing: input.typePairing,
            density: input.density,
            cornerRadius: input.cornerRadius,
            darkHeader: input.darkHeader,
            badgeRemovable: input.badgeRemovable,
          },
        });
        return {
          result: null,
          before: {
            offeredThemes: template.offeredThemes,
            defaultTheme: template.defaultTheme,
            density: template.density,
          },
          after: {
            offeredThemes: offered,
            defaultTheme: input.defaultTheme,
            density: input.density,
            storeCount: count,
          },
        };
      },
    ),
  );

  return { ok: true, storeCount: count };
}

/**
 * A seller's own brand colour, checked before it is stored.
 *
 * Criterion 5. The refusal carries the number, because a refusal with no number
 * is one somebody argues with — and because the seller can act on "3.1 against
 * the page background" in a way they cannot act on "too light".
 */
export async function setBrandHex(
  actor: Actor,
  businessId: string,
  hex: string,
): Promise<{ ok: true; ratio: number } | { ok: false; error: HexRefusal; ratio: number }> {
  const check = checkBrandHex(hex);
  if (!check.ok) return { ok: false, error: check.reason!, ratio: check.ratio };

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { sectorId: true },
  });
  if (!business) return { ok: false, error: "not_a_hex", ratio: 0 };

  const template = business.sectorId
    ? await prisma.storefrontTemplate.findFirst({
        where: { sectorId: business.sectorId, status: "live" },
        select: { allowCustomHex: true },
      })
    : null;

  // A template that does not offer custom colours is not overridden by a
  // seller who found the field. Refused as though the hex were wrong, because
  // from the seller's side it is: it is not a colour they may use.
  if (!template?.allowCustomHex) return { ok: false, error: "not_allowed", ratio: check.ratio };

  void actor;
  await prisma.business.update({
    where: { id: businessId },
    data: { themePreset: hex },
  });
  return { ok: true, ratio: check.ratio };
}

/** The library screen's catalogue, with what is in use in this template. */
export function sectionLibrary(inUse: readonly { type: string }[]) {
  const used = new Set(inUse.map((section) => section.type));
  return BUILDABLE_SECTION_TYPES.map((type) => ({
    ...type,
    state: used.has(type.key) ? ("in_use" as const) : ("available" as const),
  }));
}
