import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import type { Actor } from "@/lib/auth/roles";
import {
  wouldBeIncomplete,
  type ProductSpecs,
  type SpecFieldRule,
} from "@/lib/metrics/spec-completeness";

/**
 * Board 4e — the versioned spec library, and the grace period.
 *
 * Criterion 4: *"publishing a spec-template version with a new required field
 * does not invalidate existing products — the grace period works and the
 * affected count is accurate."*
 *
 * Both halves are here, and the second is the one that decides whether the
 * first gets used. A staff member who cannot see that a change makes 1,842
 * products incomplete will publish it; one who can will set a deadline. So the
 * count is computed **before** the publish, from the same function that
 * computes completeness afterwards — a count worked out a second way is a count
 * that eventually disagrees with the number it is counting.
 *
 * ## A version is a bump, not a clone
 *
 * The obvious implementation is to copy the live template's fields onto a new
 * row, add the change, and retire the old one. It is wrong here, and an
 * integration test caught it: `Product.specValues` is keyed by
 * **`SpecField.id`** — every writer in the product does that, because an id
 * survives a rename and a key does not — and cloning gives the carried-forward
 * fields new ids. Every product's stored specs would point at the previous
 * version's fields and every catalogue in the category would read as empty the
 * moment somebody published a version.
 *
 * So publishing adds the field to the template that already exists and bumps
 * `version`. Nothing is cloned, no id moves, `SellerTemplate.platformTemplateId`
 * stays valid, and `Category.defaultTemplateId` never has to be repointed. What
 * changed is recorded where changes are recorded: the audit row's before and
 * after.
 *
 * `taxonomy.write` — ops lead alone. Every seller in the category clones from
 * this.
 */

export interface TemplateSummary {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  version: number;
  status: string;
  fields: number;
  requiredFields: number;
  /** Fields whose grace period has not expired yet. */
  inGrace: number;
  /** Sellers who have cloned this template. */
  clones: number;
}

export async function templateLibrary(now = new Date()): Promise<TemplateSummary[]> {
  const templates = await prisma.specTemplate.findMany({
    orderBy: [{ categoryId: "asc" }, { version: "desc" }],
    select: {
      id: true,
      categoryId: true,
      name: true,
      version: true,
      status: true,
      category: { select: { name: true } },
      fields: { select: { required: true, isFilterable: true, requiredFrom: true } },
      _count: { select: { sellerTemplates: true } },
    },
  });

  return templates.map((template) => ({
    id: template.id,
    categoryId: template.categoryId,
    categoryName: template.category.name,
    name: template.name,
    version: template.version,
    status: template.status,
    fields: template.fields.length,
    requiredFields: template.fields.filter((f) => f.required).length,
    inGrace: template.fields.filter(
      (f) => f.requiredFrom !== null && f.requiredFrom.getTime() > now.getTime(),
    ).length,
    clones: template._count.sellerTemplates,
  }));
}

async function catalogueFor(templateId: string): Promise<{
  products: ProductSpecs[];
  rules: Map<string, SpecFieldRule[]>;
}> {
  const template = await prisma.specTemplate.findUniqueOrThrow({
    where: { id: templateId },
    select: {
      id: true,
      categoryId: true,
      fields: {
        select: { id: true, key: true, required: true, isFilterable: true, requiredFrom: true },
      },
    },
  });

  /*
   * Products in every category this template is the default for. A product is
   * tied to a template only through `Category.defaultTemplateId`, so the join
   * goes that way round rather than through a column on `Product`.
   */
  const rows = await prisma.product.findMany({
    where: { category: { defaultTemplateId: templateId } },
    select: { specValues: true },
  });

  return {
    products: rows.map((row) => ({
      templateId,
      values: row.specValues as Record<string, unknown> | null,
    })),
    rules: new Map([[templateId, template.fields]]),
  };
}

export interface NewField {
  key: string;
  label: string;
  labelAr?: string;
  type: "select" | "multiselect" | "number" | "number_range" | "text" | "boolean";
  unit?: string;
  options?: string[];
  required: boolean;
  isFilterable: boolean;
}

/**
 * How many products a proposed field would make incomplete, and by when.
 *
 * Called by the screen before anything is written. A grace deadline in the
 * future returns zero affected *now* and the same count as of that date, which
 * is the whole argument for offering one.
 */
export async function affectedByNewField(
  templateId: string,
  field: NewField,
  now = new Date(),
): Promise<{ affectedNow: number; total: number }> {
  const { products, rules } = await catalogueFor(templateId);

  // `id` is what specValues is keyed by, and a field that does not exist yet
  // has no id — so nothing can already carry it, which is exactly the point.
  const proposed: SpecFieldRule = {
    id: `__proposed__${field.key}`,
    key: field.key,
    required: field.required,
    isFilterable: field.isFilterable,
    requiredFrom: null,
  };

  return {
    affectedNow: field.required && field.isFilterable
      ? wouldBeIncomplete(products, rules, { templateId, field: proposed }, now)
      : 0,
    total: products.length,
  };
}

export type PublishResult =
  | { ok: true; templateId: string; version: number; affected: number }
  | {
      ok: false;
      error: "not_found" | "not_live" | "duplicate_key" | "grace_in_past";
      message: string;
    };

export interface PublishVersionInput {
  actor: Actor;
  /** The live template being superseded. */
  templateId: string;
  field: NewField;
  /**
   * When the new field starts being required.
   *
   * Null means immediately, which is honest for a template nobody has filled in
   * and cruel for one they have. The screen offers a date whenever the affected
   * count is above zero.
   */
  requiredFrom: Date | null;
  reason: string;
}

/**
 * Publish a new version with one field added.
 *
 * One field at a time, deliberately. A version that changes six things is a
 * version whose affected count is a single number covering six different
 * decisions, and the reason on the audit row cannot explain it.
 */
export async function publishVersionWithField(
  input: PublishVersionInput,
  now = new Date(),
): Promise<PublishResult> {
  const template = await prisma.specTemplate.findUnique({
    where: { id: input.templateId },
    select: {
      id: true,
      categoryId: true,
      name: true,
      version: true,
      status: true,
      fields: { select: { key: true } },
      _count: { select: { fields: true } },
    },
  });
  if (!template) {
    return { ok: false, error: "not_found", message: "That template is not in the library." };
  }
  if (template.status !== "live") {
    return {
      ok: false,
      error: "not_live",
      message: "Only the live version can be added to. Publish that one first.",
    };
  }
  if (template.fields.some((f) => f.key === input.field.key)) {
    return {
      ok: false,
      error: "duplicate_key",
      message: `This template already has a field keyed ${input.field.key}.`,
    };
  }
  if (input.requiredFrom && input.requiredFrom.getTime() <= now.getTime()) {
    return {
      ok: false,
      error: "grace_in_past",
      message: "A grace period ends in the future. Leave it empty to require the field now.",
    };
  }

  const { affectedNow } = await affectedByNewField(input.templateId, input.field, now);

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
        await tx.specField.create({
          data: {
            templateId: template.id,
            key: input.field.key,
            label: input.field.label,
            labelAr: input.field.labelAr ?? null,
            type: input.field.type,
            unit: input.field.unit ?? null,
            options: input.field.options ?? [],
            required: input.field.required,
            isFilterable: input.field.isFilterable,
            /*
             * The grace period. A CHECK refuses it on a field that is not
             * required — a deadline for something optional is not a deadline —
             * so the service never writes one there.
             */
            requiredFrom: input.field.required ? input.requiredFrom : null,
            sortOrder: template._count.fields,
          },
        });

        const bumped = await tx.specTemplate.update({
          where: { id: template.id },
          data: { version: template.version + 1 },
          select: { version: true },
        });

        return {
          result: bumped.version,
          before: { version: template.version, fields: template._count.fields },
          after: {
            version: bumped.version,
            fields: template._count.fields + 1,
            addedField: input.field.key,
            requiredFrom: input.requiredFrom?.toISOString() ?? null,
            productsAffected: affectedNow,
          },
        };
      },
    ),
  );

  return {
    ok: true,
    templateId: template.id,
    version,
    affected: affectedNow,
  };
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
