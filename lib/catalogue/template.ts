import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { Prisma } from "@/lib/db/generated/client";
import {
  diffOverlay,
  type FieldNaming,
  type TemplateChange,
} from "./template-changes";
import {
  facetStateOf,
  readMappings,
  readOwnFields,
  type FacetState,
  type FieldMappings,
  type FieldOverride,
  type OwnField,
  type UnitDisplay,
} from "./overlay";

/**
 * A seller's copy of a category's spec template.
 *
 * Admin ships the template; the seller clones it and edits the labels. The
 * thing that must survive is the mapping back to the platform field, because
 * that is what lets a buyer compare a "Body material" from one supplier with a
 * "Material of construction" from another.
 *
 * The mapping is structural rather than conventional. `SellerTemplate.fieldMappings`
 * is keyed by the platform `SpecField` id, and `Product.specValues` is keyed by
 * the same id — see lib/spec.ts. A seller renaming a field changes the label
 * they see and cannot change the key, so a rename physically cannot drop the
 * mapping. Criterion 6 asks that renaming warns before saving and keeps the
 * mapping; the warning is a courtesy, and this is the guarantee.
 *
 * ## Hiding a field was removed, and it was the sharpest control on the screen
 *
 * A seller could tick `Hidden` on any field, including a filterable one. It was
 * documented as label-only and buyer-invisible — `getSpecFilters` refuses to
 * read it for exactly that reason — and it was neither:
 *
 *   1. board 3g's editor rendered inputs for `!hidden` fields only;
 *   2. `saveProduct` rebuilt `specValues` from the boxes the form posted;
 *   3. so hiding a field and then saving any product deleted that field's
 *      stored value from it.
 *
 * That column feeds `Business.specCompleteness`, which is twelve of the hundred
 * ranking points, and the spec table every buyer reads. A control whose only
 * effect was to make a seller harder to find, which also destroyed their data,
 * while `renameWarning` sat on the same screen promising nothing would be lost.
 *
 * It is gone rather than guarded. "Unfilled data stays visible" is a project
 * non-negotiable: a field a seller does not stock is left empty and renders
 * "Not provided", which is the truth and is what makes the completeness count
 * mean anything. There was never a state hiding was the right answer to.
 *
 * `saveProduct` merges over the stored values now, so the same hole cannot
 * reopen the next time a screen renders a partial field set.
 *
 * What a seller may do: rename a field, reorder it.
 */

/** One field as the seller sees it, over the platform field underneath. */
export interface MappedField {
  /**
   * The key `Product.specValues` uses.
   *
   * A platform `SpecField.id` for a mapped field, the own field's own id for
   * one the seller invented. Callers store and read by this and never need to
   * know which kind they are holding.
   */
  fieldId: string;
  /** The platform SpecField id, or null for a field the seller invented. */
  platformFieldId: string | null;
  /** The platform's own label, so the seller can see the pairing. Null for own. */
  platformLabel: string | null;
  /** What this seller calls it. Defaults to the platform label. */
  label: string;
  key: string;
  type: string;
  unit: string | null;
  /** What this seller stocks. A subset of the platform's, never wider. */
  options: string[];
  /** The platform's full list, so the settings rail can offer what was dropped. */
  platformOptions: string[];
  /** Required of this seller's products now. Platform floor OR seller's own. */
  required: boolean;
  /** The platform's own requirement — the floor a seller cannot lower. */
  platformRequired: boolean;
  /** Set where the seller added the requirement themselves. */
  sellerRequired: boolean;
  /** When a platform requirement starts biting. Null means from the beginning. */
  requiredFrom: Date | null;
  /** Drives the site-wide filter rail. Platform-owned, per category. */
  isFilterable: boolean;
  /** What board 3h's read-only FILTER column renders. */
  facet: FacetState;
  detached: boolean;
  own: boolean;
  unitDisplay: UnitDisplay;
  sortOrder: number;
  /**
   * The platform's own position, before any override.
   *
   * `saveDraft` drops a `sortOrder` equal to it, so a template still in the
   * platform's order stores no order at all — otherwise staging a rename wrote
   * a position for all seven fields and the pending list read as six phantom
   * "Moved X" entries beside the one real change.
   */
  platformSortOrder: number;
}

export interface SellerTemplateView {
  id: string;
  name: string;
  slug: string;
  platformTemplateId: string;
  platformTemplateName: string;
  categoryId: string;
  /** The platform category's slug. The prefix on the locked field id. */
  categorySlug: string;
  /** Board 3h's `YOUR REV 7`. */
  revision: number;
  /** Board 3h's `TRACKS PLATFORM v3`. */
  tracksVersion: number;
  /** What the platform is on now. Equal to `tracksVersion` when nothing is new. */
  platformVersion: number;
  /** The applied overlay — what products and buyers read. */
  fields: MappedField[];
  /** The draft overlay, when one is pending. Null when nothing is. */
  draft: MappedField[] | null;
  ownFields: OwnField[];
  /*
     The raw overrides, alongside the resolved fields.

     `pendingChanges` needs these rather than the resolved view, because "the
     seller set a label equal to the platform's" and "the seller set no label"
     resolve identically and are different changes — the first follows a later
     admin rename and the second does not.
  */
  rawApplied: FieldMappings;
  rawDraft: FieldMappings | null;
  rawDraftOwnFields: OwnField[] | null;
}

/**
 * Resolve a platform template plus an overlay into the fields a seller sees.
 *
 * One function, because the alternative is the state this subsystem was already
 * in: the map found five incompatible answers to "which fields govern this
 * product", and two of them disagree on the seeded pump catalogue today.
 */
function resolve(
  platformFields: readonly {
    id: string;
    key: string;
    label: string;
    type: string;
    unit: string | null;
    options: string[];
    required: boolean;
    requiredFrom: Date | null;
    isFilterable: boolean;
    sortOrder: number;
  }[],
  mappings: FieldMappings,
  ownFields: readonly OwnField[],
): MappedField[] {
  const mapped: MappedField[] = platformFields.map((field) => {
    const override = mappings[field.id] ?? {};
    const detached = override.detached ?? false;
    /*
       Narrowed, never widened. A seller stocks DN15 to DN100 out of the
       platform's eighteen sizes; they do not get to invent a nineteenth, because
       the facet rail offers the platform's list and a value outside it would be
       a product no filter can reach.
    */
    const options = override.options
      ? field.options.filter((option) => override.options!.includes(option))
      : field.options;

    return {
      fieldId: field.id,
      platformFieldId: field.id,
      platformLabel: field.label,
      label: override.label ?? field.label,
      key: field.key,
      type: field.type,
      unit: field.unit,
      options,
      platformOptions: field.options,
      // The floor, plus whatever the seller added on top of it.
      required: field.required || (override.required ?? false),
      platformRequired: field.required,
      sellerRequired: override.required ?? false,
      requiredFrom: field.requiredFrom,
      // Detaching takes the field out of the facet; it does not make the
      // platform's field non-filterable for anybody else.
      isFilterable: field.isFilterable && !detached,
      facet: facetStateOf({ own: false, detached, isFilterable: field.isFilterable }),
      detached,
      own: false,
      unitDisplay: override.unitDisplay ?? "both",
      sortOrder: override.sortOrder ?? field.sortOrder,
      platformSortOrder: field.sortOrder,
    };
  });

  const own: MappedField[] = ownFields.map((field) => ({
    fieldId: field.id,
    platformFieldId: null,
    platformLabel: null,
    label: field.label,
    key: field.id,
    type: field.type,
    unit: field.unit,
    options: field.options,
    platformOptions: [],
    required: field.required,
    platformRequired: false,
    sellerRequired: field.required,
    requiredFrom: null,
    isFilterable: false,
    facet: facetStateOf({ own: true, detached: false, isFilterable: false }),
    detached: false,
    own: true,
    unitDisplay: "both",
    sortOrder: field.sortOrder,
    // An own field has no platform position; its own is the only one there is.
    platformSortOrder: field.sortOrder,
  }));

  const all = [...mapped, ...own];
  // Stable within an equal sortOrder, so a render does not reshuffle rows the
  // seller has not touched.
  all.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  return all;
}

const TEMPLATE_SELECT = {
  id: true,
  businessId: true,
  name: true,
  slug: true,
  revision: true,
  tracksVersion: true,
  fieldMappings: true,
  draftMappings: true,
  draftOwnFields: true,
  ownFields: true,
  platformTemplate: {
    select: {
      id: true,
      name: true,
      version: true,
      categoryId: true,
      category: { select: { slug: true } },
      fields: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
          unit: true,
          options: true,
          required: true,
          requiredFrom: true,
          isFilterable: true,
          sortOrder: true,
        },
      },
    },
  },
} as const;

export async function getSellerTemplate(
  businessId: string,
  sellerTemplateId: string,
): Promise<SellerTemplateView | null> {
  const template = await prisma.sellerTemplate.findUnique({
    where: { id: sellerTemplateId },
    select: TEMPLATE_SELECT,
  });

  // Someone else's template and one that does not exist give the same answer.
  if (!template || template.businessId !== businessId) return null;
  return toView(template);
}

/** The same view, by the slug the route carries. */
export async function getSellerTemplateBySlug(
  businessId: string,
  slug: string,
): Promise<SellerTemplateView | null> {
  const template = await prisma.sellerTemplate.findFirst({
    where: { businessId, slug },
    select: TEMPLATE_SELECT,
  });
  return template ? toView(template) : null;
}

type TemplateRow = Prisma.SellerTemplateGetPayload<{ select: typeof TEMPLATE_SELECT }>;

function toView(template: TemplateRow): SellerTemplateView {
  const platformFields = template.platformTemplate.fields;
  const applied = readMappings(template.fieldMappings);
  const ownFields = readOwnFields(template.ownFields);

  /*
     A draft is present or it is not; there is no third state.

     `draftMappings` is nullable rather than defaulted for that reason — board
     3h makes the primary action absent when nothing is pending rather than
     disabled, and a defaulted `{}` would make "no draft" and "a draft equal to
     the applied state" indistinguishable.
  */
  const hasDraft = template.draftMappings !== null;
  const draftMappings = readMappings(template.draftMappings);
  const draftOwn = hasDraft ? readOwnFields(template.draftOwnFields) : ownFields;

  return {
    id: template.id,
    name: template.name,
    slug: template.slug,
    platformTemplateId: template.platformTemplate.id,
    platformTemplateName: template.platformTemplate.name,
    categoryId: template.platformTemplate.categoryId,
    categorySlug: template.platformTemplate.category.slug,
    revision: template.revision,
    tracksVersion: template.tracksVersion,
    platformVersion: template.platformTemplate.version,
    fields: resolve(platformFields, applied, ownFields),
    draft: hasDraft
      ? resolve(platformFields, draftMappings, draftOwn)
      : null,
    ownFields,
    rawApplied: applied,
    rawDraft: hasDraft ? draftMappings : null,
    rawDraftOwnFields: hasDraft ? draftOwn : null,
  };
}

async function getSellerTemplateOrThrow(businessId: string, id: string) {
  const view = await getSellerTemplate(businessId, id);
  if (!view) throw new Error("That template cannot be found.");
  return view;
}

/**
 * The URL segment for `/dashboard/templates/:slug`.
 *
 * Unique per business rather than globally: two suppliers both calling a
 * template "Valves" is not a collision, and a global unique would leak one
 * seller's naming into another's error message.
 *
 * Null when the name slugifies to nothing — a template called "&" — or when
 * this business already holds that slug. The caller falls back to the row's id,
 * which is unique by construction. An ugly URL is the right trade against
 * refusing to create the template at all.
 */
export async function slugForTemplate(
  businessId: string,
  name: string,
  exceptId?: string,
): Promise<string | null> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base === "") return null;

  const taken = await prisma.sellerTemplate.findFirst({
    where: { businessId, slug: base, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return taken ? null : base;
}

/**
 * Clone a platform template for this business, or return the existing clone.
 *
 * Idempotent by (business, platform template) — and since migration
 * `20260914090100` that is a database unique rather than a convention, because
 * five readers resolved "the seller's template" differently and a second row
 * made them disagree about which labels a seller had.
 */
export async function cloneTemplate(
  actor: Actor,
  businessId: string,
  platformTemplateId: string,
): Promise<SellerTemplateView> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    throw new Error("You can only edit your own templates.");
  }

  const existing = await prisma.sellerTemplate.findFirst({
    where: { businessId, platformTemplateId },
    select: { id: true },
  });
  if (existing) return getSellerTemplateOrThrow(businessId, existing.id);

  const platform = await prisma.specTemplate.findUniqueOrThrow({
    where: { id: platformTemplateId },
    select: { id: true, name: true, version: true },
  });

  /*
   * An empty mapping object, not a copy of every label.
   *
   * A clone that copies the labels is a snapshot: when admin renames a platform
   * field, every seller who cloned before the rename keeps the old wording
   * forever and nobody knows the two are the same field. Storing only what the
   * seller actually changed means an untouched field follows the platform, and
   * a renamed one is visibly a deliberate choice.
   */
  const slug = await slugForTemplate(businessId, platform.name);
  const created = await prisma.sellerTemplate.create({
    data: {
      businessId,
      platformTemplateId: platform.id,
      name: platform.name,
      // Replaced with the row's own id below when the name gives no usable
      // slug. It cannot be the id here — the insert is what generates one.
      slug: slug ?? `pending-${randomUUID()}`,
      fieldMappings: {},
      // Cloned from what the platform is on now, so a brand new template does
      // not immediately show a nudge about changes it already has.
      tracksVersion: platform.version,
    },
    select: { id: true },
  });
  if (slug === null) {
    await prisma.sellerTemplate.update({ where: { id: created.id }, data: { slug: created.id } });
  }

  return getSellerTemplateOrThrow(businessId, created.id);
}

/** Every template this business holds, for board 3h's rail. */
export interface TemplateSummary {
  id: string;
  name: string;
  slug: string;
  /** Products filed under this template's category. The rail's count. */
  products: number;
  pendingChanges: number;
}

export async function templatesFor(businessId: string): Promise<TemplateSummary[]> {
  const rows = await prisma.sellerTemplate.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: TEMPLATE_SELECT,
  });

  const views = rows.map(toView);
  const counts = await appliedCounts(
    businessId,
    views.map((view) => view.categoryId),
  );

  return views.map((view) => ({
    id: view.id,
    name: view.name,
    slug: view.slug,
    products: counts.get(view.categoryId) ?? 0,
    pendingChanges: pendingChanges(view).length,
  }));
}

/**
 * The categories a template governs: its own, and every child of it.
 *
 * `resolveDefaultTemplateId` reads a category then hops to its parent, so a
 * product filed under "Gate valves" answers to the valve template hanging off
 * "Valves & fittings". Counting only the template's own category is why the
 * screen first rendered `0 / 0` against a catalogue of 26 — every product was
 * in a subcategory.
 *
 * One definition, exported, because the map found five incompatible answers to
 * "which products does this template govern" and two of them already disagree
 * on the seeded pump catalogue.
 */
export async function categoriesGovernedBy(categoryId: string): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: categoryId },
    select: { id: true },
  });
  return [categoryId, ...children.map((child) => child.id)];
}

/** How many products sit under each of these templates, in one query. */
async function appliedCounts(
  businessId: string,
  categoryIds: readonly string[],
): Promise<Map<string, number>> {
  if (categoryIds.length === 0) return new Map();

  const families = await Promise.all(categoryIds.map((id) => categoriesGovernedBy(id)));
  const rows = await prisma.product.groupBy({
    by: ["categoryId"],
    where: { businessId, categoryId: { in: [...new Set(families.flat())] } },
    _count: { _all: true },
  });
  const byCategory = new Map(rows.map((row) => [row.categoryId, row._count._all]));

  const out = new Map<string, number>();
  categoryIds.forEach((id, index) => {
    out.set(
      id,
      families[index]!.reduce((sum, child) => sum + (byCategory.get(child) ?? 0), 0),
    );
  });
  return out;
}

/* ── The draft, and applying it ──────────────────────────────────────────── */

/**
 * What the seller has changed and not applied.
 *
 * Derived from the two stored overlays rather than accumulated as a list, so it
 * cannot drift from what applying would actually do — the failure mode of a
 * stored change log is a screen describing an edit the apply does not make.
 */
export function pendingChanges(view: SellerTemplateView): TemplateChange[] {
  if (!view.draft) return [];

  const naming: FieldNaming[] = view.fields.map((field) => ({
    fieldId: field.fieldId,
    base: field.platformLabel ?? field.label,
    basePosition: field.platformSortOrder,
  }));
  for (const field of view.draft) {
    if (naming.some((n) => n.fieldId === field.fieldId)) continue;
    naming.push({
      fieldId: field.fieldId,
      base: field.platformLabel ?? field.label,
      basePosition: field.platformSortOrder,
    });
  }

  return diffOverlay(
    { mappings: appliedMappingsOf(view), ownFields: view.ownFields },
    { mappings: draftMappingsOf(view), ownFields: draftOwnFieldsOf(view) },
    naming,
  );
}

/*
   The two overlays, read back off the view.

   `toView` resolves them into `MappedField[]` for rendering; the diff needs the
   raw overrides, because "the seller set a label equal to the platform's" and
   "the seller set no label" resolve identically and are different changes.
*/
function appliedMappingsOf(view: SellerTemplateView): FieldMappings {
  return view.rawApplied;
}
function draftMappingsOf(view: SellerTemplateView): FieldMappings {
  return view.rawDraft ?? {};
}
function draftOwnFieldsOf(view: SellerTemplateView): OwnField[] {
  return view.rawDraftOwnFields ?? view.ownFields;
}

export type DraftResult = { ok: true } | { ok: false; error: string };

/**
 * Write the seller's edits to the draft. Nothing a buyer sees moves.
 *
 * Board 3h §8: no template change applies without passing through the
 * pending-changes review. This is the write that stages one, and it is the only
 * write the editor performs — `applyDraft` is a separate, confirmed act.
 */
export async function saveDraft(
  actor: Actor,
  businessId: string,
  sellerTemplateId: string,
  next: { mappings: FieldMappings; ownFields: readonly OwnField[] },
): Promise<DraftResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own templates." };
  }

  const view = await getSellerTemplate(businessId, sellerTemplateId);
  if (!view) return { ok: false, error: "That template cannot be found." };

  const byId = new Map(view.fields.map((field) => [field.fieldId, field]));

  for (const [fieldId, override] of Object.entries(next.mappings)) {
    const field = byId.get(fieldId);
    if (!field || field.own) {
      // An edit naming a field that is not on the template means the form and
      // the template have drifted. Writing the half that matched would leave
      // the seller looking at a template that does not say what they saved.
      return { ok: false, error: "That template has changed since this page opened. Reload it." };
    }
    if ((override.label ?? "").trim() === "" && override.label !== undefined) {
      return { ok: false, error: `Give "${field.platformLabel}" a name.` };
    }
    /*
       The floor, enforced on the write rather than only in the control.

       Board 3h open question 1: platform `required` is a floor a seller adds to
       and cannot lower. The toggle is disabled on those rows, and a disabled
       control is a UI opinion — a server action is a URL.
    */
    if (field.platformRequired && override.required === false) {
      return { ok: false, error: "The platform requires that field. You can add requirements, not remove them." };
    }
  }

  for (const own of next.ownFields) {
    if (own.label.trim() === "") return { ok: false, error: "Give your own field a name." };
  }

  /*
     Only what differs from the platform is stored.

     The screen strips a label equal to the platform's before it posts, and the
     screen is not what has to hold — a server action is a URL. Storing the
     platform's own label as an override turns an untouched field into a
     snapshot: admin renames the field later, every seller who once opened this
     screen keeps the old wording, and nobody can tell the two are the same
     field.
  */
  const normalised: FieldMappings = {};
  for (const [fieldId, override] of Object.entries(next.mappings)) {
    const field = byId.get(fieldId)!;
    const entry: FieldOverride = {};

    if (override.label !== undefined && override.label.trim() !== field.platformLabel) {
      entry.label = override.label.trim();
    }
    // A position equal to the platform's is not an override. Without this,
    // staging any edit wrote a position for every field and the pending list
    // read as one real change beside six phantom reorders.
    if (override.sortOrder !== undefined && override.sortOrder !== field.platformSortOrder) {
      entry.sortOrder = override.sortOrder;
    }
    // The platform's requirement is the floor; storing it here would freeze a
    // copy of a value that is not this seller's to hold.
    if (override.required && !field.platformRequired) entry.required = true;
    if (override.options && override.options.length !== field.platformOptions.length) {
      entry.options = override.options;
    }
    if (override.unitDisplay === "primary") entry.unitDisplay = "primary";
    if (override.detached) entry.detached = true;

    if (Object.keys(entry).length > 0) normalised[fieldId] = entry;
  }

  await prisma.sellerTemplate.update({
    where: { id: sellerTemplateId },
    data: {
      draftMappings: normalised as unknown as object,
      draftOwnFields: [...next.ownFields] as unknown as object,
    },
  });

  return { ok: true };
}

/** Throw the draft away. The applied overlay is untouched. */
export async function discardDraft(
  actor: Actor,
  businessId: string,
  sellerTemplateId: string,
): Promise<DraftResult> {
  assertCanEditProduct(actor);
  const { count } = await prisma.sellerTemplate.updateMany({
    where: { id: sellerTemplateId, businessId: actor.businessId ?? businessId },
    data: { draftMappings: Prisma.DbNull, draftOwnFields: Prisma.DbNull },
  });
  return count === 0 ? { ok: false, error: "That template cannot be found." } : { ok: true };
}

export type ApplyResult =
  | { ok: true; revision: number; changes: TemplateChange[] }
  | { ok: false; error: string };

/**
 * Apply the draft, and write the revision that can undo it.
 *
 * One transaction: the overlay moves, the counter moves, and the snapshot that
 * `Revision history` restores from is written. Any two of those without the
 * third is a history that cannot reproduce what the seller is looking at.
 */
export async function applyDraft(
  actor: Actor,
  businessId: string,
  sellerTemplateId: string,
): Promise<ApplyResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own templates." };
  }

  const view = await getSellerTemplate(businessId, sellerTemplateId);
  if (!view) return { ok: false, error: "That template cannot be found." };
  if (!view.draft) return { ok: false, error: "There is nothing waiting to be applied." };

  const changes = pendingChanges(view);
  const mappings = draftMappingsOf(view);
  const ownFields = draftOwnFieldsOf(view);
  const revision = view.revision + 1;

  await prisma.$transaction([
    prisma.sellerTemplateRevision.create({
      data: {
        sellerTemplateId,
        revision,
        name: view.name,
        fieldMappings: mappings as unknown as object,
        ownFields: [...ownFields] as unknown as object,
        summary: changes as unknown as object,
        createdById: actor.id,
      },
    }),
    prisma.sellerTemplate.update({
      where: { id: sellerTemplateId },
      data: {
        fieldMappings: mappings as unknown as object,
        ownFields: [...ownFields] as unknown as object,
        revision,
        draftMappings: Prisma.DbNull,
        draftOwnFields: Prisma.DbNull,
      },
    }),
  ]);

  return { ok: true, revision, changes };
}

export interface RevisionSummary {
  revision: number;
  createdAt: Date;
  author: string | null;
  changes: TemplateChange[];
}

export async function revisionsFor(
  businessId: string,
  sellerTemplateId: string,
): Promise<RevisionSummary[]> {
  const rows = await prisma.sellerTemplateRevision.findMany({
    where: { sellerTemplateId, template: { businessId } },
    orderBy: { revision: "desc" },
    select: {
      revision: true,
      createdAt: true,
      summary: true,
      createdBy: { select: { fullName: true, email: true } },
    },
  });

  return rows.map((row) => ({
    revision: row.revision,
    createdAt: row.createdAt,
    author: row.createdBy?.fullName ?? row.createdBy?.email ?? null,
    changes: Array.isArray(row.summary) ? (row.summary as unknown as TemplateChange[]) : [],
  }));
}

/**
 * Roll back to a prior revision.
 *
 * Forward, never backward: restoring writes a *new* revision carrying the old
 * snapshot, so the history is append-only and a rollback can itself be rolled
 * back. Rewinding the counter would make the record of what happened depend on
 * what happened next.
 */
export async function rollbackTo(
  actor: Actor,
  businessId: string,
  sellerTemplateId: string,
  revision: number,
): Promise<ApplyResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only edit your own templates." };
  }

  const [current, target] = await Promise.all([
    prisma.sellerTemplate.findFirst({
      where: { id: sellerTemplateId, businessId },
      select: { revision: true, name: true },
    }),
    prisma.sellerTemplateRevision.findFirst({
      where: { sellerTemplateId, revision, template: { businessId } },
      select: { fieldMappings: true, ownFields: true, name: true },
    }),
  ]);
  if (!current || !target) return { ok: false, error: "That revision cannot be found." };

  const next = current.revision + 1;
  const restored: TemplateChange[] = [
    {
      kind: "reordered",
      fieldId: sellerTemplateId,
      label: target.name,
      blast: "display_only",
    },
  ];

  await prisma.$transaction([
    prisma.sellerTemplateRevision.create({
      data: {
        sellerTemplateId,
        revision: next,
        name: target.name,
        fieldMappings: target.fieldMappings as object,
        ownFields: target.ownFields as object,
        summary: restored as unknown as object,
        createdById: actor.id,
      },
    }),
    prisma.sellerTemplate.update({
      where: { id: sellerTemplateId },
      data: {
        fieldMappings: target.fieldMappings as object,
        ownFields: target.ownFields as object,
        revision: next,
        draftMappings: Prisma.DbNull,
        draftOwnFields: Prisma.DbNull,
      },
    }),
  ]);

  return { ok: true, revision: next, changes: restored };
}

/* ── The numbers the screen turns on ─────────────────────────────────────── */

export interface FieldFill {
  fieldId: string;
  /** Products carrying a value for this field. */
  filled: number;
  /** Products missing it while it is required. Zero when it is not. */
  toFix: number;
}

export interface TemplateFill {
  /** Products on this template's category. The denominator, stated once. */
  total: number;
  byField: Map<string, FieldFill>;
  /** Distinct products missing at least one required field. §5's `Fix N`. */
  productsWithGaps: number;
}

/**
 * `FILLED`, per field, over the seller's own products.
 *
 * The number the whole screen turns on, and every one on the board was
 * hardcoded — including the eight this is. One pass over the catalogue rather
 * than one query per field: a template with twenty fields is otherwise twenty
 * scans of the same rows to produce one table.
 */
export async function fillFor(
  businessId: string,
  view: SellerTemplateView,
  now = new Date(),
): Promise<TemplateFill> {
  const products = await prisma.product.findMany({
    // The template's own category and its children — a product filed under
    // "Gate valves" answers to the valve template. See `categoriesGovernedBy`.
    where: { businessId, categoryId: { in: await categoriesGovernedBy(view.categoryId) } },
    select: { id: true, specValues: true },
  });

  const byField = new Map<string, FieldFill>(
    view.fields.map((field) => [field.fieldId, { fieldId: field.fieldId, filled: 0, toFix: 0 }]),
  );

  /*
     Required *now*, which is not the same as required.

     `SpecField.requiredFrom` is board 4e's grace period: a field added to a
     live template with a deadline in the future is not yet required, so the
     products filed before it are incomplete-but-valid rather than broken. A
     violation count that ignored it would show a seller gaps they cannot yet
     be asked to fix.
  */
  const requiredNow = view.fields.filter(
    (field) =>
      field.required &&
      (field.requiredFrom === null || field.requiredFrom.getTime() <= now.getTime()),
  );

  let productsWithGaps = 0;

  for (const product of products) {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    let hasGap = false;

    for (const field of view.fields) {
      const entry = byField.get(field.fieldId)!;
      if (isFilled(values[field.fieldId])) entry.filled += 1;
    }
    for (const field of requiredNow) {
      if (isFilled(values[field.fieldId])) continue;
      byField.get(field.fieldId)!.toFix += 1;
      hasGap = true;
    }
    if (hasGap) productsWithGaps += 1;
  }

  return { total: products.length, byField, productsWithGaps };
}

/** The same emptiness test `lib/metrics/spec-completeness.ts` applies. */
function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/* ── What a product must carry before it can be saved ────────────────────── */

export interface RequirementCheck {
  ok: boolean;
  /** Labels of the fields still empty, in the seller's own words. */
  missing: string[];
}

/**
 * Board 3h §5, the half that bites: a flagged product blocks its next save.
 *
 * The asymmetry is deliberate and is the whole point. Turning a requirement on
 * never delists anything — 318 live products stay live and stay in search — and
 * the requirement is enforced at the next edit of each one. A seller who
 * tightened their own template gets a catalogue that converges rather than a
 * catalogue that drops out of search from a toggle with no confirmation.
 *
 * Nothing enforced this before. `SpecField.required` and `requiredFrom` existed
 * and were read only by measurement — the completeness job and the ranking
 * signal — never by a writer, so a product with entirely empty specs could be
 * saved `live`.
 *
 * The labels are the seller's own, because the message names a box on the
 * screen they are looking at rather than the platform's word for it.
 */
export function missingRequired(
  view: SellerTemplateView,
  specValues: Record<string, unknown>,
  now = new Date(),
): RequirementCheck {
  const missing = view.fields
    .filter(
      (field) =>
        field.required &&
        (field.requiredFrom === null || field.requiredFrom.getTime() <= now.getTime()) &&
        !isFilled(specValues[field.fieldId]),
    )
    .map((field) => field.label);

  return { ok: missing.length === 0, missing };
}

/**
 * The seller's template for a product's category, overlay and all.
 *
 * A product filed under "Gate valves" answers to the valve template, and a
 * seller who has cloned it sees their own labels — so the refusal names the box
 * on their screen. Null where they have no clone, which is not an error: the
 * platform's own requirements still apply and `requiredFor` falls back to them.
 */
export async function templateForCategory(
  businessId: string,
  categoryId: string,
): Promise<SellerTemplateView | null> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { defaultTemplateId: true, parent: { select: { defaultTemplateId: true } } },
  });
  const platformTemplateId = category?.defaultTemplateId ?? category?.parent?.defaultTemplateId;
  if (!platformTemplateId) return null;

  const clone = await prisma.sellerTemplate.findFirst({
    where: { businessId, platformTemplateId },
    select: { id: true },
  });
  if (!clone) return null;

  return getSellerTemplate(businessId, clone.id);
}
