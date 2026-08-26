import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import {
  assertNoPriceEscapes,
  planIsUsable,
  suggestColumn,
  type ColumnPlan,
  type ColumnSuggestion,
  type SpecFieldOption,
} from "./columns";
import { columnValues, parseCsv, type ParsedCsv } from "./csv";

/**
 * Applying a mapping, and undoing it.
 *
 * Criterion 7 has two halves. The first is that a price column cannot import —
 * `lib/import/columns.ts` is the fence and `assertNoPriceEscapes` is where this
 * service refuses to proceed. The second is that an import is reversible for
 * twenty-four hours, which is what `ImportRun` and `Product.importRunId` exist
 * for: the rows a run created can be named, rather than guessed at from a
 * timestamp that would also catch anything typed by hand in the same minute.
 */

/** The board's own number. Long enough to notice a bad import, short enough to be safe. */
export const REVERSIBLE_FOR_MS = 24 * 60 * 60 * 1000;

export interface ImportPreview {
  headers: string[];
  suggestions: ColumnSuggestion[];
  rowCount: number;
  raggedRows: number[];
  /**
   * Rows past the 5,000 ceiling that were not read.
   *
   * Surfaced because it used to be a silent slice: a seller uploading six
   * thousand products got five thousand and no indication which thousand were
   * missing. An importer that quietly drops data looks exactly like one that
   * worked.
   */
  truncated: number;
  /** First few rows, for showing the seller what they are about to import. */
  sample: string[][];
}

/**
 * Read the file and guess. Writes nothing.
 *
 * The seller confirms or changes every column before anything is created —
 * a mapper that imported on upload would be a mapper nobody could correct.
 */
export function previewImport(text: string, specFields: readonly SpecFieldOption[]): ImportPreview {
  const parsed = parseCsv(text);
  return {
    headers: parsed.headers,
    suggestions: parsed.headers.map((header, i) =>
      suggestColumn(header, columnValues(parsed, i), specFields),
    ),
    rowCount: parsed.rows.length,
    raggedRows: parsed.raggedRows,
    truncated: parsed.truncated,
    sample: parsed.rows.slice(0, 5),
  };
}

export type ImportResult =
  | { ok: true; importRunId: string; created: number; skipped: { row: number; why: string }[] }
  | { ok: false; error: string };

type Availability = "in_stock" | "made_to_order" | "indent" | "out_of_stock";

/** "Made to Order", "MTO", "made_to_order" all mean the same thing on an export. */
function readAvailability(raw: string): Availability {
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (key.includes("madetoorder") || key === "mto") return "made_to_order";
  if (key.includes("indent")) return "indent";
  if (key.includes("out") || key.includes("nostock") || key === "no") return "out_of_stock";
  return "in_stock";
}

function readInt(raw: string): number | null {
  const digits = raw.replace(/[^0-9-]/g, "");
  if (digits === "" || digits === "-") return null;
  const value = Number(digits);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export interface ApplyImportInput {
  businessId: string;
  categoryId: string;
  filename: string;
  text: string;
  plan: ColumnPlan;
  /** Save the mapping under this name for next month. */
  saveAs?: string;
}

export async function applyImport(actor: Actor, input: ApplyImportInput): Promise<ImportResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== input.businessId) {
    return { ok: false, error: "You can only import into your own catalogue." };
  }

  /*
   * Before anything is read, let alone written. The mapper will not offer a
   * money column any target but `blocked`, but the plan travels through a form
   * and through a saved mapping, and both are strings the seller could edit.
   * This throws rather than warning — there is no partial success worth having.
   */
  assertNoPriceEscapes(input.plan);

  if (!planIsUsable(input.plan)) {
    return {
      ok: false,
      error: "Choose which column holds the product name. Everything else is optional.",
    };
  }

  let parsed: ParsedCsv;
  try {
    parsed = parseCsv(input.text);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "That file could not be read." };
  }

  const byHeader = new Map(input.plan.columns.map((c) => [c.header, c.target]));
  const indexOf = (kind: string) =>
    parsed.headers.findIndex((h) => byHeader.get(h)?.kind === kind);

  const nameAt = indexOf("name");
  const skuAt = indexOf("sku");
  const descriptionAt = indexOf("description");
  const availabilityAt = indexOf("availability");
  const stockAt = indexOf("stock_qty");
  const leadAt = indexOf("lead_time_days");
  const moqAt = indexOf("min_order_qty");

  const specColumns = parsed.headers
    .map((header, index) => ({ index, target: byHeader.get(header) }))
    .filter((c) => c.target?.kind === "spec" && c.target.specFieldId)
    .map((c) => ({ index: c.index, specFieldId: c.target!.specFieldId! }));

  const existing = new Set(
    (
      await prisma.product.findMany({
        where: { businessId: input.businessId },
        select: { slug: true },
      })
    ).map((p) => p.slug),
  );

  const skipped: { row: number; why: string }[] = [];
  const toCreate: {
    name: string;
    slug: string;
    sku: string | null;
    description: string | null;
    availability: Availability;
    stockQty: number | null;
    leadTimeDays: number | null;
    minOrderQty: number | null;
    specValues: Record<string, string>;
  }[] = [];

  for (const [i, row] of parsed.rows.entries()) {
    const rowNumber = i + 2; // 1-based, and the header is row 1.
    const name = (row[nameAt] ?? "").trim();
    if (name === "") {
      skipped.push({ row: rowNumber, why: "No product name in that row." });
      continue;
    }

    let slug = slugify(name);
    if (slug === "") slug = `product-${rowNumber}`;
    if (existing.has(slug)) {
      // A repeat upload of the same export is the normal case, not an error.
      skipped.push({ row: rowNumber, why: `You already have a product called "${name}".` });
      continue;
    }
    existing.add(slug);

    const specValues: Record<string, string> = {};
    for (const column of specColumns) {
      const value = (row[column.index] ?? "").trim();
      if (value !== "") specValues[column.specFieldId] = value;
    }

    toCreate.push({
      name,
      slug,
      sku: skuAt >= 0 ? (row[skuAt] ?? "").trim() || null : null,
      description: descriptionAt >= 0 ? (row[descriptionAt] ?? "").trim() || null : null,
      availability: availabilityAt >= 0 ? readAvailability(row[availabilityAt] ?? "") : "in_stock",
      stockQty: stockAt >= 0 ? readInt(row[stockAt] ?? "") : null,
      leadTimeDays: leadAt >= 0 ? readInt(row[leadAt] ?? "") : null,
      minOrderQty: moqAt >= 0 ? readInt(row[moqAt] ?? "") : null,
      specValues,
    });
  }

  if (toCreate.length === 0) {
    return { ok: false, error: "No rows in that file could be imported. Nothing has changed." };
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.importRun.create({
      data: {
        businessId: input.businessId,
        actorId: actor.id,
        filename: input.filename,
        rowCount: parsed.rows.length,
        createdCount: toCreate.length,
        // The plan as applied, not as offered: a mapping overridden at the last
        // moment must not come back different when it is reused next month.
        columnPlan: input.plan as unknown as object,
      },
      select: { id: true },
    });

    await tx.product.createMany({
      data: toCreate.map((product) => ({
        businessId: input.businessId,
        categoryId: input.categoryId,
        importRunId: created.id,
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        description: product.description,
        availability: product.availability,
        stockQty: product.stockQty,
        leadTimeDays: product.leadTimeDays,
        minOrderQty: product.minOrderQty,
        specValues: product.specValues,
        // Imported products land as drafts. A seller who mapped a column wrong
        // should find out on their own catalogue screen, not from a buyer.
        status: "draft",
      })),
    });

    if (input.saveAs) {
      await tx.importMapping.upsert({
        where: { businessId_name: { businessId: input.businessId, name: input.saveAs } },
        create: {
          businessId: input.businessId,
          name: input.saveAs,
          categoryId: input.categoryId,
          columnPlan: input.plan as unknown as object,
        },
        update: { columnPlan: input.plan as unknown as object, usedAt: new Date() },
      });
    }

    return created;
  });

  return { ok: true, importRunId: run.id, created: toCreate.length, skipped };
}

export type RevertResult = { ok: true; deleted: number } | { ok: false; error: string };

/**
 * Undo a run, within the window.
 *
 * Deletes only the products that run created — which is why provenance is on
 * the row. Products the seller has since edited are still deleted: the run is
 * what created them, and a half-undo that leaves some behind is worse than
 * either outcome. Anything the seller wants to keep, they can un-map and
 * re-import.
 */
export async function revertImport(
  actor: Actor,
  importRunId: string,
  now = new Date(),
): Promise<RevertResult> {
  assertCanEditProduct(actor);

  const run = await prisma.importRun.findUnique({
    where: { id: importRunId },
    select: { id: true, businessId: true, createdAt: true, revertedAt: true },
  });

  // A run belonging to someone else and a run that does not exist give the same
  // answer, so the endpoint cannot be used to find out which runs exist.
  if (!run || run.businessId !== actor.businessId) {
    return { ok: false, error: "That import cannot be found." };
  }
  if (run.revertedAt) {
    return { ok: false, error: "That import has already been undone." };
  }

  const age = now.getTime() - run.createdAt.getTime();
  if (age > REVERSIBLE_FOR_MS) {
    return {
      ok: false,
      error:
        "An import can be undone for 24 hours. This one is older than that, so the products " +
        "are now part of your catalogue — delete them from the catalogue screen instead.",
    };
  }

  const deleted = await prisma.$transaction(async (tx) => {
    const { count } = await tx.product.deleteMany({ where: { importRunId: run.id } });
    // Marked, not deleted. The record of what was imported and undone survives.
    await tx.importRun.update({ where: { id: run.id }, data: { revertedAt: now } });
    return count;
  });

  return { ok: true, deleted };
}

/** Runs still inside their window, for the "undo this" banner. */
export async function revertableRuns(businessId: string, now = new Date()) {
  return prisma.importRun.findMany({
    where: {
      businessId,
      revertedAt: null,
      createdAt: { gte: new Date(now.getTime() - REVERSIBLE_FOR_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, createdCount: true, createdAt: true },
  });
}
