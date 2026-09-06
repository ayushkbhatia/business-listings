import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { categoryHealth } from "@/lib/taxonomy/service";
import { readMappings, readOwnFields } from "@/lib/catalogue/overlay";
import { diffDraft, isEmptyDraft, readDraft, type PlatformChange } from "./changes";
import { proposalKey } from "./versions";

/**
 * Board 4e's reads — every count on the screen, and none of them a constant.
 *
 * The board hardcoded all of them, including the 322 and the 320. Two are worth
 * naming as risks in their own right: **coverage** drives a worklist, and
 * **filled** is the number ops will judge a template by. A wrong constant in
 * either is a directory that looks reliable and is not.
 *
 * ## Coverage is the number this screen exists to move
 *
 * The board read `84 templates · 1,204 attributes · used on 612,400 products`.
 * 1,204 is 84 × 14.3 — field *slots*, not attributes: if they were distinct
 * there would be no reuse across templates and no reason for the dictionary the
 * nav points at. What the header carries instead is how many subcategories have
 * a template at all, because the ones that do not hold products already listed
 * that carry no comparable fields, and no facet on `1b`/`1c` can reach them.
 *
 * ## Why `filled` is measured over mapped platform fields only
 *
 * Clones diverge: sellers rename fields, add their own, and detach fields from
 * their platform mapping (`3h` §4). Averaging over each seller's own field set
 * means averaging over different denominators, and a seller who adds ten fields
 * of their own would drag the platform template's number down for everyone.
 * So the denominator is products × mapped platform fields, and the screen says
 * so under the table. A template with no clones reads `—`, never `0%`: zero of
 * zero is not a fill rate, and 0% next to a healthy 94% reads as a failing
 * template rather than an unused one.
 */

export interface LibraryRow {
  id: string;
  name: string;
  /** `SPEC.VALVES` — the mono id under the name. Derived, never stored. */
  code: string;
  version: number;
  status: string;
  /** Every subcategory this template serves. Many-to-many since board 4e. */
  subcategories: { id: string; name: string }[];
  fields: number;
  facets: number;
  varies: number;
  /** Products filed under every subcategory this template serves. */
  products: number;
  clones: number;
  /** Null where no seller has cloned it. Rendered `—`, not `0%`. */
  filled: number | null;
  /** The version a pending draft would publish as, or null with none pending. */
  draftVersion: number | null;
  draftChanges: number;
}

/**
 * `valves-and-fittings` becomes `SPEC.VALVES`, and its fields `valves.bore`.
 *
 * Derived from the subcategory slug rather than the template's name, because
 * the same prefix has to appear on board `3h`'s locked `MAPPED TO` id — a
 * seller reading `valves.bore` there and ops reading something else here are
 * looking at the same field and cannot tell. `3h` takes the first slug segment;
 * so does this.
 */
export function templateCode(categorySlug: string | undefined): string {
  const stem = (categorySlug ?? "").split("-")[0]?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return stem ? `SPEC.${stem}` : "SPEC";
}

const TEMPLATE_SELECT = {
  id: true,
  name: true,
  version: true,
  status: true,
  draftChanges: true,
  categories: { select: { category: { select: { id: true, name: true, slug: true } } } },
  fields: {
    select: {
      id: true,
      key: true,
      label: true,
      unit: true,
      options: true,
      isFilterable: true,
      variesByVariant: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: "asc" },
  },
} as const;

/**
 * The categories a template governs: the ones it serves, and their children.
 *
 * The seller-side twin of `categoriesGovernedBy` in `lib/catalogue/template.ts`,
 * and it exists for the same reason that one does — a product filed under "Gate
 * valves" answers to the valve template hanging off "Valves & fittings", so
 * counting only the template's own categories reads `0` against a full
 * catalogue.
 */
async function governedBy(categoryIds: readonly string[]): Promise<string[]> {
  if (categoryIds.length === 0) return [];
  const children = await prisma.category.findMany({
    where: { parentId: { in: [...categoryIds] } },
    select: { id: true },
  });
  return [...new Set([...categoryIds, ...children.map((child) => child.id)])];
}

/**
 * Fill rate per template, across every clone, over mapped platform fields only.
 *
 * One pass over the clones and one over the products, rather than a query per
 * template: the numerator needs each product's `specValues` keys checked
 * against the platform field ids its seller has *not* detached, which is not
 * something the database can count for us without the overlay.
 */
async function filledByTemplate(
  templates: readonly { id: string; fieldIds: string[]; categoryIds: string[] }[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (templates.length === 0) return out;

  const clones = await prisma.sellerTemplate.findMany({
    where: { platformTemplateId: { in: templates.map((t) => t.id) } },
    select: { businessId: true, platformTemplateId: true, fieldMappings: true },
  });

  const byTemplate = new Map<string, typeof clones>();
  for (const clone of clones) {
    const list = byTemplate.get(clone.platformTemplateId) ?? [];
    list.push(clone);
    byTemplate.set(clone.platformTemplateId, list);
  }

  for (const template of templates) {
    const mine = byTemplate.get(template.id) ?? [];
    if (mine.length === 0) {
      out.set(template.id, null);
      continue;
    }

    const families = await governedBy(template.categoryIds);
    const products = await prisma.product.findMany({
      where: {
        businessId: { in: mine.map((clone) => clone.businessId) },
        categoryId: { in: families },
      },
      select: { businessId: true, specValues: true },
    });

    /*
       A field this seller has detached is no longer mapped to the platform's,
       so it is out of both halves of the fraction. Counting it in the
       denominator would score a seller down for a deliberate choice `3h` §4
       gives them, and counting it in the numerator would credit a value that is
       no longer the same field as everyone else's.
    */
    const mappedFor = new Map(
      mine.map((clone) => {
        const overrides = readMappings(clone.fieldMappings);
        return [
          clone.businessId,
          template.fieldIds.filter((id) => overrides[id]?.detached !== true),
        ] as const;
      }),
    );

    let filled = 0;
    let slots = 0;
    for (const product of products) {
      const mapped = mappedFor.get(product.businessId) ?? template.fieldIds;
      const values = (product.specValues ?? {}) as Record<string, unknown>;
      slots += mapped.length;
      for (const fieldId of mapped) {
        if (isFilled(values[fieldId])) filled += 1;
      }
    }

    out.set(template.id, slots === 0 ? null : filled / slots);
  }

  return out;
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Every template in the library, with the counts the table renders. */
export const specLibrary = cache(async (): Promise<LibraryRow[]> => {
  const templates = await prisma.specTemplate.findMany({
    orderBy: { name: "asc" },
    select: { ...TEMPLATE_SELECT, _count: { select: { sellerTemplates: true } } },
  });

  const categoryIdsOf = (row: (typeof templates)[number]) =>
    row.categories.map((link) => link.category.id);

  const filled = await filledByTemplate(
    templates.map((row) => ({
      id: row.id,
      fieldIds: row.fields.map((field) => field.id),
      categoryIds: categoryIdsOf(row),
    })),
  );

  const families = await Promise.all(templates.map((row) => governedBy(categoryIdsOf(row))));
  const productCounts = await prisma.product.groupBy({
    by: ["categoryId"],
    where: { categoryId: { in: [...new Set(families.flat())] } },
    _count: { _all: true },
  });
  const byCategory = new Map(productCounts.map((row) => [row.categoryId, row._count._all]));

  return templates.map((row, i) => {
    const draft = readDraft(row.draftChanges);
    const pending = isEmptyDraft(draft) ? [] : diffDraft(row.fields, draft);
    return {
      id: row.id,
      name: row.name,
      code: templateCode(row.categories[0]?.category.slug),
      version: row.version,
      status: row.status,
      subcategories: row.categories.map((link) => link.category),
      fields: row.fields.length,
      facets: row.fields.filter((field) => field.isFilterable).length,
      varies: row.fields.filter((field) => field.variesByVariant).length,
      products: (families[i] ?? []).reduce((sum, id) => sum + (byCategory.get(id) ?? 0), 0),
      clones: row._count.sellerTemplates,
      filled: filled.get(row.id) ?? null,
      draftVersion: pending.length > 0 ? row.version + 1 : null,
      draftChanges: pending.length,
    };
  });
});

/* ── Coverage ────────────────────────────────────────────────────────────── */

export interface CoverageGap {
  id: string;
  name: string;
  slug: string;
  /** Products already listed here that carry no comparable fields. */
  products: number;
  listings: number;
  /**
   * Held rather than offered a template.
   *
   * A subcategory `4d` judges too thin to publish a landing page for does not
   * need a template either, and two screens should not both be authoring for a
   * subcategory one of them is holding back. The reason travels with it.
   */
  held: boolean;
}

export interface Coverage {
  /** Subcategories in the taxonomy. `4d` owns this number. */
  total: number;
  covered: number;
  gaps: CoverageGap[];
}

/**
 * Subcategories with no template, ranked by products already listed in them.
 *
 * The ranking is the argument: those products exist, they carry no comparable
 * fields, and no facet on `1b`/`1c` can reach them. A subcategory with two
 * thousand of them is a bigger hole than one with none, and the board rendered
 * the whole set as a single table row.
 */
export const coverage = cache(async (): Promise<Coverage> => {
  const [subcategories, health] = await Promise.all([
    prisma.category.findMany({
      where: { parentId: { not: null } },
      select: {
        id: true,
        name: true,
        slug: true,
        templates: { select: { templateId: true }, take: 1 },
        parent: { select: { templates: { select: { templateId: true }, take: 1 } } },
        _count: { select: { products: true } },
      },
      orderBy: { name: "asc" },
    }),
    /*
       `4d`'s own answer, not a second one computed here. Two screens must not
       both decide whether a subcategory is worth building for — and 4d is the
       one that owns the taxonomy, the thresholds and the demand signal.
    */
    categoryHealth(),
  ]);

  const decisionOf = new Map(health.map((row) => [row.id, row]));

  /*
     A subcategory inherits its parent's template, the same hop
     `resolveDefaultTemplateId` makes. Counting it uncovered because it holds no
     template row of its own would report a gap the buyer does not have — the
     valve template already reaches Gate valves.
  */
  const uncovered = subcategories.filter(
    (row) => row.templates.length === 0 && (row.parent?.templates.length ?? 0) === 0,
  );

  const gaps = uncovered
    .map((row) => {
      const judged = decisionOf.get(row.id);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        products: row._count.products,
        listings: judged?.listings ?? 0,
        held: judged ? !judged.decision.publishable : false,
      };
    })
    .sort((a, b) => b.products - a.products || a.name.localeCompare(b.name));

  return {
    total: subcategories.length,
    covered: subcategories.length - uncovered.length,
    gaps,
  };
});

/* ── Seller-proposed fields ──────────────────────────────────────────────── */

export interface ProposedField {
  id: string;
  key: string;
  sampleLabel: string;
  categoryName: string;
  businesses: number;
  /** How many distinct labels the sellers gave it. The board showed 7. */
  labels: number;
  types: number;
  units: number;
}

/**
 * What sellers keep inventing, with the spread that makes it a merge.
 *
 * The board's `Promote` was one click into a definition 412 sellers already
 * have their own version of — 7 labels, 3 types, 2 unit conventions between
 * them — so there was no single value for the button to write. The spread is
 * queried here because it is the fact that decides the shape of the control,
 * and a row that states it is honest whether or not a merge exists to run.
 */
export const proposedFields = cache(async (): Promise<ProposedField[]> => {
  const proposals = await prisma.specFieldProposal.findMany({
    where: { state: "proposed" },
    orderBy: [{ businessCount: "desc" }, { createdAt: "asc" }],
    select: {
      id: true,
      key: true,
      sampleLabel: true,
      businessCount: true,
      categoryId: true,
      category: { select: { name: true } },
    },
  });
  if (proposals.length === 0) return [];

  /*
     The spread has to be measured, not stored: `SpecFieldProposal` keeps one
     sample label and a count, and the count of *distinct* labels is the number
     that says the promotion is a merge. Read from the clones themselves, which
     is where the seven labels actually are.
  */
  const clones = await prisma.sellerTemplate.findMany({
    select: { ownFields: true, platformTemplate: { select: { categories: { select: { categoryId: true } } } } },
  });

  const spread = new Map<string, { labels: Set<string>; types: Set<string>; units: Set<string> }>();
  for (const clone of clones) {
    const categoryIds = clone.platformTemplate.categories.map((link) => link.categoryId);
    for (const own of readOwnFields(clone.ownFields)) {
      const key = proposalKey(own.label);
      if (!key) continue;
      for (const categoryId of categoryIds) {
        const bucket = `${categoryId}:${key}`;
        const entry =
          spread.get(bucket) ?? { labels: new Set(), types: new Set(), units: new Set() };
        entry.labels.add(own.label.trim());
        entry.types.add(own.type);
        entry.units.add(own.unit ?? "");
        spread.set(bucket, entry);
      }
    }
  }

  return proposals.map((proposal) => {
    const entry = spread.get(`${proposal.categoryId}:${proposal.key}`);
    return {
      id: proposal.id,
      key: proposal.key,
      sampleLabel: proposal.sampleLabel,
      categoryName: proposal.category.name,
      businesses: proposal.businessCount,
      labels: entry?.labels.size ?? 1,
      types: entry?.types.size ?? 1,
      units: entry?.units.size ?? 1,
    };
  });
});

/* ── One template, and what publishing its draft would cost ──────────────── */

export interface BlastRadius {
  /** Seller copies of this template. */
  clones: number;
  /** Sellers holding one. Same number as `clones`, and both are on screen. */
  sellers: number;
  /** Products filed under every subcategory the template serves. */
  products: number;
}

export interface TemplateDetail {
  id: string;
  name: string;
  code: string;
  /**
   * The prefix on a locked field id — `valves` in `valves.nominal_diameter`.
   *
   * The same string board `3h` puts in front of a seller's locked `MAPPED TO`
   * id, from the same slug segment. A seller reading `valves.bore` there and
   * ops reading something else here are looking at the same field and cannot
   * tell.
   */
  fieldPrefix: string;
  version: number;
  status: string;
  subcategories: { id: string; name: string }[];
  fields: {
    id: string;
    key: string;
    label: string;
    type: string;
    unit: string | null;
    options: string[];
    required: boolean;
    isFilterable: boolean;
    variesByVariant: boolean;
    sortOrder: number;
    /** Clones that have detached this field from its platform mapping. */
    detached: number;
    /** Products under this template with no value for it. */
    missing: number;
  }[];
  changes: PlatformChange[];
  blast: BlastRadius;
}

export async function templateDetail(templateId: string): Promise<TemplateDetail | null> {
  const row = await prisma.specTemplate.findUnique({
    where: { id: templateId },
    select: {
      ...TEMPLATE_SELECT,
      fields: {
        select: {
          id: true,
          key: true,
          label: true,
          type: true,
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
  if (!row) return null;

  const categoryIds = row.categories.map((link) => link.category.id);
  const families = await governedBy(categoryIds);

  const [clones, products] = await Promise.all([
    prisma.sellerTemplate.findMany({
      where: { platformTemplateId: templateId },
      select: { fieldMappings: true },
    }),
    prisma.product.findMany({
      where: { categoryId: { in: families } },
      select: { specValues: true },
    }),
  ]);

  const detachedBy = new Map<string, number>();
  for (const clone of clones) {
    for (const [fieldId, override] of Object.entries(readMappings(clone.fieldMappings))) {
      if (override.detached) detachedBy.set(fieldId, (detachedBy.get(fieldId) ?? 0) + 1);
    }
  }

  const missingBy = new Map<string, number>();
  for (const product of products) {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    for (const field of row.fields) {
      if (!isFilled(values[field.id])) {
        missingBy.set(field.id, (missingBy.get(field.id) ?? 0) + 1);
      }
    }
  }

  const draft = readDraft(row.draftChanges);

  return {
    id: row.id,
    name: row.name,
    code: templateCode(row.categories[0]?.category.slug),
    fieldPrefix: (row.categories[0]?.category.slug ?? "").split("-")[0] ?? "",
    version: row.version,
    status: row.status,
    subcategories: row.categories.map((link) => link.category),
    fields: row.fields.map((field) => ({
      ...field,
      detached: detachedBy.get(field.id) ?? 0,
      missing: missingBy.get(field.id) ?? 0,
    })),
    changes: isEmptyDraft(draft) ? [] : diffDraft(row.fields, draft),
    blast: { clones: clones.length, sellers: clones.length, products: products.length },
  };
}

/** Header figures. Every one a query — board 4e criterion 12. */
export const libraryHeader = cache(
  async (): Promise<{ templates: number; covered: number; total: number; products: number }> => {
    const [templates, cover, served] = await Promise.all([
      specLibrary(),
      coverage(),
      prisma.specTemplateCategory.findMany({ select: { categoryId: true } }),
    ]);

    /*
       Distinct products, not the sum of the table's `products` column. One
       template may serve several subcategories and one subcategory may hold
       several templates, so summing the column counts a product once per
       template covering it — the arithmetic the many-to-many made possible and
       the header would have been the first to get wrong.
    */
    const families = await governedBy([...new Set(served.map((link) => link.categoryId))]);
    const products = await prisma.product.count({ where: { categoryId: { in: families } } });

    return {
      templates: templates.length,
      covered: cover.covered,
      total: cover.total,
      products,
    };
  },
);
