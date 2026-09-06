import "server-only";
import { Prisma } from "@/lib/db/generated/client";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import { assertCan } from "@/lib/auth/can";
import { readMappings, readOwnFields, type OwnField } from "@/lib/catalogue/overlay";
import {
  applyDraft,
  diffDraft,
  isEmptyDraft,
  readDraft,
  type DraftField,
  type TemplateDraft,
} from "./changes";

/**
 * Board 4e — the spec library's writes.
 *
 * ## Two actions, not one
 *
 * The board had a single button, `Publish with 60-day grace`, over a card
 * saying publishing v4 "will leave 88,410 products with two empty required
 * fields until sellers fill them". Both halves contradict board `3h` §6, which
 * was already exported:
 *
 *   - **The fields arrive not required.** Additive platform changes land
 *     automatically on every clone, unfilled, facet state inherited, and
 *     nothing the seller has breaks. No product violates anything, no save is
 *     blocked, and there is nothing for a grace period to postpone.
 *   - **A grace period implies day 61**, and the only things that could happen
 *     then — delisting, unpublishing, dropping out of search — are precisely
 *     what `3h` §5 and `6f`'s 301-not-404 exist to prevent.
 *
 * So publishing and requiring are separate actions with separate reviews:
 *
 *   `publishDraft`  additive and safe. Adds fields, changes platform display
 *                   labels, facet flags and `varies_by_variant`. Lands on every
 *                   clone. Never required, never destructive.
 *   `setFieldRequired`  a field that already exists in a live version joins the
 *                   platform's required set. New products are held at first
 *                   save; existing ones are flagged and blocked on next save
 *                   (`3h` §5). Nothing is delisted, ever, and there is no
 *                   deadline.
 *
 * You cannot add and require in one publish. The two have different
 * consequences and the review has to name them separately.
 *
 * ## A version is a bump, not a clone
 *
 * The obvious implementation is to copy the live template's fields onto a new
 * row, add the change, and retire the old one. It is wrong here, and an
 * integration test caught it: `Product.specValues` is keyed by **`SpecField.id`**
 * — every writer in the product does that, because an id survives a rename and
 * a key does not — and cloning gives the carried-forward fields new ids. Every
 * product's stored specs would point at the previous version's fields and every
 * catalogue in the category would read as empty the moment somebody published.
 *
 * The same reasoning is why the draft lives in `SpecTemplate.draftChanges` on
 * the row rather than in a second `draft` row.
 *
 * ## Removal is not a delete
 *
 * Per `3h` §6 a platform removal leaves the field and its data on every clone
 * as a **seller-owned** field and drops only its facet status. `publishDraft`
 * does that conversion inside the same transaction, carrying the platform
 * field's id across so that `Product.specValues` keeps resolving — no data
 * moves, and the seller sees the field they had, now marked `YOURS ONLY`.
 *
 * `taxonomy.write` — ops lead alone. Every seller in the category clones from
 * this.
 */

export type SpecResult<T = void> =
  | ({ ok: true } & (T extends void ? Record<never, never> : { value: T }))
  | { ok: false; error: SpecError; message: string };

export type SpecError =
  | "not_found"
  | "not_live"
  | "duplicate_key"
  | "empty_draft"
  | "no_category"
  | "already";

const fail = (error: SpecError, message: string) => ({ ok: false as const, error, message });

/* ── Staging ─────────────────────────────────────────────────────────────── */

async function loadDraft(templateId: string) {
  return prisma.specTemplate.findUnique({
    where: { id: templateId },
    select: {
      id: true,
      name: true,
      version: true,
      status: true,
      draftChanges: true,
      fields: {
        select: {
          id: true,
          key: true,
          label: true,
          unit: true,
          options: true,
          required: true,
          isFilterable: true,
          variesByVariant: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
}

/**
 * Put one edit in the draft.
 *
 * Staging is not a staff mutation and writes no audit row: nothing is visible
 * to a seller or a buyer until the draft is published, and an audit log that
 * records keystrokes stops being a record of decisions. The publish is the
 * decision, and it is the one that writes.
 */
export async function stageChange(
  actor: Actor,
  templateId: string,
  edit: (draft: TemplateDraft) => TemplateDraft,
): Promise<SpecResult> {
  assertCan(actor, "taxonomy.write");
  const template = await loadDraft(templateId);
  if (!template) return fail("not_found", "That template is not in the library.");

  const next = edit(readDraft(template.draftChanges));
  await prisma.specTemplate.update({
    where: { id: templateId },
    // Null rather than an empty object, so the draft card is absent with
    // nothing pending rather than rendering an empty one — board 4e §5.
    data: { draftChanges: isEmptyDraft(next) ? Prisma.DbNull : (next as object) },
  });
  return { ok: true };
}

export async function stageAddField(
  actor: Actor,
  templateId: string,
  field: DraftField,
): Promise<SpecResult> {
  assertCan(actor, "taxonomy.write");
  const template = await loadDraft(templateId);
  if (!template) return fail("not_found", "That template is not in the library.");
  if (template.fields.some((existing) => existing.key === field.key)) {
    return fail("duplicate_key", `This template already has a field keyed ${field.key}.`);
  }

  return stageChange(actor, templateId, (draft) => {
    if (draft.added.some((staged) => staged.key === field.key)) return draft;
    return { ...draft, added: [...draft.added, field] };
  });
}

export async function discardDraft(actor: Actor, templateId: string): Promise<SpecResult> {
  assertCan(actor, "taxonomy.write");
  await prisma.specTemplate.update({
    where: { id: templateId },
    data: { draftChanges: Prisma.DbNull },
  });
  return { ok: true };
}

/* ── Action one · publish a version ──────────────────────────────────────── */

export interface PublishInput {
  actor: Actor;
  templateId: string;
  reason: string;
}

export interface Published {
  version: number;
  added: number;
  removed: number;
  edited: number;
  /** Clones the change landed on. None of them is required to do anything. */
  clones: number;
}

/**
 * Publish the staged draft as the next version. Additive and safe.
 *
 * Every field it adds is written `required: false`, unconditionally and not as
 * a default the caller may override. That is the whole of criterion 1: a
 * publish cannot mark an existing product as violating its template, cannot
 * block a seller's save, and cannot change a product's published state.
 */
export async function publishDraft(input: PublishInput): Promise<SpecResult<Published>> {
  const template = await loadDraft(input.templateId);
  if (!template) return fail("not_found", "That template is not in the library.");
  if (template.status !== "live") {
    return fail("not_live", "Only the live version can be added to. Publish that one first.");
  }

  const draft = readDraft(template.draftChanges);
  if (isEmptyDraft(draft)) {
    return fail("empty_draft", "Nothing is staged on this template, so there is nothing to publish.");
  }

  const clones = await prisma.sellerTemplate.findMany({
    where: { platformTemplateId: template.id },
    select: { id: true, fieldMappings: true, ownFields: true },
  });

  const removed = template.fields.filter((field) => draft.removed.includes(field.id));
  const resulting = applyDraft(template.fields, draft);
  const changes = diffDraft(template.fields, draft);

  const version = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `SpecTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        for (const [fieldId, edit] of Object.entries(draft.edited)) {
          if (draft.removed.includes(fieldId)) continue;
          if (!template.fields.some((field) => field.id === fieldId)) continue;
          await tx.specField.update({
            where: { id: fieldId },
            data: {
              ...(edit.label !== undefined ? { label: edit.label } : {}),
              ...(edit.sortOrder !== undefined ? { sortOrder: edit.sortOrder } : {}),
              ...(edit.isFilterable !== undefined ? { isFilterable: edit.isFilterable } : {}),
              ...(edit.variesByVariant !== undefined
                ? { variesByVariant: edit.variesByVariant }
                : {}),
              ...(edit.options !== undefined ? { options: edit.options } : {}),
              ...(edit.unit !== undefined ? { unit: edit.unit } : {}),
            },
          });
        }

        /*
           A removal, and the reason it is a loop over clones rather than one
           delete. `3h` §6: the field and its data stay on every clone as a
           seller-owned field. Carrying the platform field's **id** across into
           `ownFields` is what makes that true rather than merely stated —
           `Product.specValues` is keyed by it, so every value keeps resolving
           and nothing is migrated.
        */
        for (const clone of clones) {
          if (removed.length === 0) break;
          const overrides = readMappings(clone.fieldMappings);
          const own = readOwnFields(clone.ownFields);
          const nextOwn: OwnField[] = [...own];

          for (const field of removed) {
            if (own.some((existing) => existing.id === field.id)) continue;
            const override = overrides[field.id];
            nextOwn.push({
              id: field.id,
              // The seller's own label if they set one, so a removal does not
              // silently rename their field back to the platform's wording.
              label: override?.label ?? field.label,
              type: "text",
              unit: field.unit,
              options: override?.options ?? [...field.options],
              required: override?.required === true,
              sortOrder: override?.sortOrder ?? field.sortOrder,
            });
            delete overrides[field.id];
          }

          await tx.sellerTemplate.update({
            where: { id: clone.id },
            data: { fieldMappings: overrides as object, ownFields: nextOwn as object[] },
          });
        }

        for (const field of removed) {
          await tx.specField.delete({ where: { id: field.id } });
        }

        for (const field of draft.added) {
          const position = resulting.findIndex((entry) => entry.key === field.key);
          await tx.specField.create({
            data: {
              templateId: template.id,
              key: field.key,
              label: field.label,
              labelAr: field.labelAr ?? null,
              type: field.type,
              unit: field.unit ?? null,
              options: field.options ?? [],
              /*
                 Not required, always, and not a parameter. `3h` §6 is that an
                 additive platform change lands not required; making this
                 configurable would put criterion 1 in the hands of whoever
                 filled the form.
              */
              required: false,
              requiredFrom: null,
              isFilterable: field.isFilterable,
              variesByVariant: field.variesByVariant,
              sortOrder: position >= 0 ? position : template.fields.length,
            },
          });
        }

        const bumped = await tx.specTemplate.update({
          where: { id: template.id },
          data: { version: template.version + 1, draftChanges: Prisma.DbNull },
          select: { version: true },
        });

        return {
          result: bumped.version,
          before: { version: template.version, fields: template.fields.length },
          after: {
            version: bumped.version,
            fields: resulting.length,
            changes: changes.map((change) => `${change.kind}:${change.label}`),
            clones: clones.length,
          },
        };
      },
    ),
  );

  return {
    ok: true,
    value: {
      version,
      added: draft.added.length,
      removed: removed.length,
      edited: Object.keys(draft.edited).length,
      clones: clones.length,
    },
  };
}

/* ── Action two · require a platform field ───────────────────────────────── */

export interface RequireReview {
  fieldId: string;
  label: string;
  /** Products under this template with no value for the field. */
  affected: number;
  /** Sellers holding at least one of them. */
  sellers: number;
  /**
   * Clones that have detached this field.
   *
   * Named separately because they cannot be held to a mapping they no longer
   * have — board 4e's Q3, answered as recommended: edit the library field, do
   * not block on the detachment.
   */
  detached: number;
}

/** What requiring a field would flag, computed before anything is written. */
export async function reviewRequireField(fieldId: string): Promise<RequireReview | null> {
  const field = await prisma.specField.findUnique({
    where: { id: fieldId },
    select: {
      id: true,
      label: true,
      templateId: true,
      template: {
        select: {
          categories: { select: { categoryId: true } },
          sellerTemplates: { select: { fieldMappings: true } },
        },
      },
    },
  });
  if (!field) return null;

  const categoryIds = field.template.categories.map((link) => link.categoryId);
  const children = await prisma.category.findMany({
    where: { parentId: { in: categoryIds } },
    select: { id: true },
  });
  const families = [...new Set([...categoryIds, ...children.map((child) => child.id)])];

  const products = await prisma.product.findMany({
    where: { categoryId: { in: families } },
    select: { businessId: true, specValues: true },
  });

  const missing = products.filter((product) => {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    const value = values[field.id];
    if (value === null || value === undefined) return true;
    if (typeof value === "string") return value.trim() === "";
    if (Array.isArray(value)) return value.length === 0;
    return false;
  });

  const detached = field.template.sellerTemplates.filter(
    (clone) => readMappings(clone.fieldMappings)[field.id]?.detached === true,
  ).length;

  return {
    fieldId: field.id,
    label: field.label,
    affected: missing.length,
    sellers: new Set(missing.map((product) => product.businessId)).size,
    detached,
  };
}

/**
 * Add a platform field to the required set, or take it out again.
 *
 * The separate action, and the one that flags. It never delists, never
 * unpublishes and carries no deadline: `requiredFrom` stays null, because a
 * date here would reintroduce the day 61 the handoff retires.
 *
 * A platform requirement is a **floor** — board `3h` Q1, answered as
 * recommended and already enforced in `lib/catalogue/overlay.ts`: a seller may
 * add a requirement and may not remove one, or the comparison table has holes
 * in exactly the columns it advertised.
 */
export async function setFieldRequired(input: {
  actor: Actor;
  fieldId: string;
  required: boolean;
  reason: string;
}): Promise<SpecResult<RequireReview>> {
  const field = await prisma.specField.findUnique({
    where: { id: input.fieldId },
    select: { id: true, label: true, required: true, template: { select: { status: true } } },
  });
  if (!field) return fail("not_found", "That field is not in the library.");
  if (field.template.status !== "live") {
    return fail("not_live", "Only a field in the live version can be required.");
  }
  if (field.required === input.required) {
    return fail(
      "already",
      input.required
        ? `${field.label} is already required.`
        : `${field.label} is not required.`,
    );
  }

  const review = await reviewRequireField(input.fieldId);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `SpecField:${field.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.specField.update({
          where: { id: field.id },
          data: { required: input.required, requiredFrom: null },
        });
        return {
          result: null,
          before: { required: field.required },
          after: {
            required: input.required,
            productsFlagged: review?.affected ?? 0,
            sellers: review?.sellers ?? 0,
            detachedClones: review?.detached ?? 0,
          },
        };
      },
    ),
  );

  return review
    ? { ok: true, value: review }
    : fail("not_found", "That field is not in the library.");
}

/* ── Creating a template ─────────────────────────────────────────────────── */

/**
 * A new library template, serving one subcategory to begin with.
 *
 * It starts `live` with no fields rather than `draft`: `draft` is a status
 * nothing has ever promoted out of, and a template a seller cannot yet clone is
 * indistinguishable on this screen from one that does not exist. An empty live
 * template is honest — it says the subcategory is covered and has nothing in it
 * yet, which is exactly what coverage should then stop reporting as a gap.
 */
export async function createTemplate(input: {
  actor: Actor;
  name: string;
  categoryId: string;
  reason: string;
}): Promise<SpecResult<string>> {
  const category = await prisma.category.findUnique({
    where: { id: input.categoryId },
    select: { id: true, defaultTemplateId: true },
  });
  if (!category) return fail("no_category", "That subcategory is not in the taxonomy.");

  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `Category:${category.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        const created = await tx.specTemplate.create({
          data: {
            name: input.name,
            version: 1,
            status: "live",
            categories: { create: { categoryId: category.id } },
          },
          select: { id: true },
        });

        /*
           The first template a subcategory gets becomes its default, because a
           subcategory with a template and no default resolves to nothing — the
           state the seeded pump catalogue was in, where the buyer-facing facet
           rail found a template and `templateForCategory` did not. A second
           template does not steal the slot: which one a seller is offered first
           is `4d`'s to set.
        */
        if (!category.defaultTemplateId) {
          await tx.category.update({
            where: { id: category.id },
            data: { defaultTemplateId: created.id },
          });
        }

        return {
          result: created.id,
          before: { defaultTemplateId: category.defaultTemplateId },
          after: { templateId: created.id, name: input.name },
        };
      },
    ),
  );

  return { ok: true, value: id };
}

/**
 * Which subcategories a template serves.
 *
 * The many-to-many, edited. `4d`'s per-subcategory setting is the default a
 * seller is offered first; this is the set they may choose from.
 */
export async function setTemplateCategories(input: {
  actor: Actor;
  templateId: string;
  categoryIds: readonly string[];
  reason: string;
}): Promise<SpecResult> {
  const template = await prisma.specTemplate.findUnique({
    where: { id: input.templateId },
    select: { id: true, categories: { select: { categoryId: true } } },
  });
  if (!template) return fail("not_found", "That template is not in the library.");

  const before = template.categories.map((link) => link.categoryId).sort();
  const after = [...new Set(input.categoryIds)].sort();

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `SpecTemplate:${template.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.specTemplateCategory.deleteMany({
          where: { templateId: template.id, categoryId: { notIn: after } },
        });
        for (const categoryId of after) {
          await tx.specTemplateCategory.upsert({
            where: { templateId_categoryId: { templateId: template.id, categoryId } },
            create: { templateId: template.id, categoryId },
            update: {},
          });
        }
        return { result: null, before: { categories: before }, after: { categories: after } };
      },
    ),
  );

  return { ok: true };
}

/**
 * Which template a subcategory offers a seller first.
 *
 * Board 4e criterion 6, and `4d`'s control writes through here. It is a
 * **default**, not an exclusive assignment: the relation is many-to-many since
 * this board, so the other templates serving the subcategory stay available on
 * `3h`'s `CLONE FROM LIBRARY` rail. What it does decide is what every
 * product-side reader resolves to — `resolveTemplateId`, the CSV mapper, the
 * required-field check — which is why it is audited rather than being a
 * settings toggle.
 */
export async function setCategoryDefaultTemplate(input: {
  actor: Actor;
  categoryId: string;
  templateId: string;
  reason: string;
}): Promise<SpecResult> {
  const [category, serving] = await Promise.all([
    prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true, defaultTemplateId: true },
    }),
    prisma.specTemplateCategory.findUnique({
      where: {
        templateId_categoryId: { templateId: input.templateId, categoryId: input.categoryId },
      },
      select: { templateId: true },
    }),
  ]);
  if (!category) return fail("no_category", "That subcategory is not in the taxonomy.");
  if (!serving) {
    return fail(
      "not_found",
      "That template does not serve this subcategory, so it cannot be the one offered first.",
    );
  }
  if (category.defaultTemplateId === input.templateId) {
    return fail("already", "That template is already the one offered first here.");
  }

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor: input.actor,
        capability: "taxonomy.write",
        subject: `Category:${category.id}`,
        reason: input.reason,
        tx,
      },
      async () => {
        await tx.category.update({
          where: { id: category.id },
          data: { defaultTemplateId: input.templateId },
        });
        return {
          result: null,
          before: { defaultTemplateId: category.defaultTemplateId },
          after: { defaultTemplateId: input.templateId },
        };
      },
    ),
  );

  return { ok: true };
}

/* ── Seller-proposed fields ──────────────────────────────────────────────── */

/** Normalised so "Wall Thk." and "wall thk" are one proposal, not two. */
export function proposalKey(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * What sellers keep inventing, ranked by how many of them invented it.
 *
 * "Fields that appear often enough get promoted" was not a countable thing
 * while `SellerTemplate.fieldMappings` was an opaque Json blob — this is the
 * count. It is what stops 40,000 businesses inventing 40,000 attribute names.
 *
 * There is no `promote` beside it, and the absence is deliberate. Board 4e §7:
 * promotion is a **merge** into an attribute in the dictionary, mapping the
 * seller fields whose type and unit match and leaving the rest seller-owned.
 * The dictionary has a nav item, a header button and no board in the 95, so
 * there is nowhere for a merge to write — and a `Promote` button that writes
 * one of seven labels into a definition 412 sellers already have their own
 * version of is the same one-click defect the board was corrected for.
 */
export async function fieldProposals(categoryId?: string) {
  return prisma.specFieldProposal.findMany({
    where: { state: "proposed", ...(categoryId ? { categoryId } : {}) },
    orderBy: [{ businessCount: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      sampleLabel: true,
      businessCount: true,
      createdAt: true,
      category: { select: { id: true, name: true } },
    },
  });
}

/**
 * Records that one more business is using a field by this name.
 *
 * Called from the catalogue import and the product editor when a seller maps a
 * column to something the platform template does not have. Idempotent per
 * business by construction: the count is recomputed from the seller templates
 * rather than incremented, so a seller saving twice does not vote twice.
 */
export async function noteProposedField(
  categoryId: string,
  label: string,
  businessCount: number,
): Promise<void> {
  const key = proposalKey(label);
  if (!key) return;

  await prisma.specFieldProposal.upsert({
    where: { categoryId_key: { categoryId, key } },
    create: { categoryId, key, sampleLabel: label.trim(), businessCount },
    update: { businessCount },
  });
}
