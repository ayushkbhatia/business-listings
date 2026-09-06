import "server-only";
import { prisma } from "@/lib/db/client";
import { resolveTemplateId } from "@/lib/spec/resolve";
import { assertCanEditProduct } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import {
  assertNoPriceEscapes,
  planIsUsable,
  resolveConflicts,
  statusOf,
  suggestColumn,
  tallyOf,
  type ColumnPlan,
  type ColumnStatus,
  type ColumnSuggestion,
  type ColumnTally,
  type SpecFieldOption,
} from "./columns";
import { columnValues, parseCsv, type ParsedCsv } from "./csv";
import { FilenameIndex, splitFilenames, type LibraryFile } from "./filenames";
import {
  analyseRows,
  categoryKey,
  listableCount,
  type Analysis,
  type RowContext,
  type RowVerdict,
} from "./rows";
import { looksLikeExport, roundTripPlan, ROUND_TRIP_MAPPING_NAME } from "./round-trip";
import { missingFrom } from "@/lib/catalogue/overlay";
import { buildProductSearchText, type IndexableField } from "@/lib/search/index-text";
import { reindexBusiness } from "@/lib/search/reindex";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { hideOverPlanCap } from "@/lib/billing/plan-caps";
import { t } from "@/lib/i18n";

/**
 * Board 11d — reading a spreadsheet, and what happens when it is applied.
 *
 * Four things here are the board's corrections rather than plumbing, and all
 * four were the same mistake in different clothing: a screen that decided
 * something on behalf of the seller and did not say so.
 *
 *   1. **The template is per row.** A single `Template: Valves v3` chip over a
 *      412-row file spanning three subcategories drops every value the wrong
 *      template has no field for. `lib/import/rows.ts` resolves it per row and
 *      errors a row whose category matches nothing.
 *   2. **The cap never refuses.** This service used to reject an over-cap file
 *      whole — *"Nothing has been imported"* — which on a Free plan meant a
 *      412-row catalogue could not be imported at all. §4: every row imports,
 *      the plan's worth are listed, the rest are stored unlisted, exactly as
 *      `3f` §6's downgrade path. A plan limit never destroys a record and never
 *      refuses one either.
 *   3. **An existing SKU updates.** It used to be skipped as a duplicate, which
 *      made the export/edit/re-import loop §5 describes impossible.
 *   4. **Undo restores rather than deletes.** It used to `deleteMany` the
 *      products a run created and say nothing about the ones it overwrote. §4
 *      is explicit: new products are **unlisted**, updated ones **return to
 *      their previous values**.
 *
 * One thing here is not in the board and belongs to `3h` §5. `saveProduct`
 * refuses to write a product whose template has an unfilled required field —
 * *"holds a new one at its first"* — and this path writes with `createMany` and
 * checked nothing. Rather than refusing the row, which would contradict
 * correction 2, an incomplete row **imports and does not list**: the record
 * exists, `3f`'s `blocked on save` chip already counts it, and no incomplete
 * product is published. Import is the widest path into this table and it must
 * not be the one that is exempt from the platform's own rules.
 */

/** The board's own number. Long enough to notice a bad import, short enough to be safe. */
export const REVERSIBLE_FOR_MS = 24 * 60 * 60 * 1000;

/* ── Reading the file ─────────────────────────────────────────────────────── */

export interface ColumnView {
  header: string;
  sample: string;
  suggestion: ColumnSuggestion;
  status: ColumnStatus;
  /** Values in this column that resolved to nothing. */
  unresolved: number;
}

export interface ImportPreview {
  headers: string[];
  columns: ColumnView[];
  tally: ColumnTally & { total: number };
  rowCount: number;
  raggedRows: number[];
  truncated: number;
  sample: string[][];
  headerRow: boolean;
  /** The plan as it stands, so the client can post it back unchanged. */
  plan: ColumnPlan;
  /** Present when the file came from `Export ▾`. §5's `MAPS 1:1`. */
  roundTrip: { name: string; matched: number; unknown: string[] } | null;
  /** §2's `3 subcategories · 3 templates apply`. */
  subcategories: { matched: number; templates: number; unknown: string[] };
  photos: { matched: number; unmatched: number; ambiguous: number };
  outcome: ImportOutcome;
  /** Every field the seller can map a column to, across the templates in play. */
  fields: SpecFieldOption[];
  /** Nothing here can be imported — §States. */
  importable: boolean;
}

export interface ImportOutcome {
  created: number;
  updated: number;
  errors: number;
  rowCount: number;
  /** Of the new products, how many the plan has room to list. §4. */
  listed: number;
  /** New products held back because a required field is empty. `3h` §5. */
  incomplete: number;
  cap: number | null;
  planName: string;
  roomRemaining: number | null;
  errorRows: { row: number; reason: string; detail?: string }[];
}

/**
 * Everything the file is measured against, read once.
 *
 * A 412-row file resolving its own subcategory, template and photo per row
 * would be twelve hundred queries. This is four, and `lib/import/rows.ts` is
 * pure because of it.
 */
async function contextFor(businessId: string, fallbackCategoryId: string): Promise<
  RowContext & { fields: SpecFieldOption[]; templateCount: number }
> {
  const [categories, products, media, documents] = await Promise.all([
    prisma.category.findMany({ select: { id: true, name: true, slug: true } }),
    prisma.product.findMany({
      where: { businessId },
      select: { id: true, slug: true, sku: true },
    }),
    prisma.media.findMany({
      where: { businessId },
      select: { id: true, filename: true, storagePath: true },
    }),
    prisma.document.findMany({
      where: { businessId },
      select: { id: true, filename: true, storagePath: true },
    }),
  ]);

  const categoryByKey = new Map<string, string>();
  for (const category of categories) {
    // Name **and** slug. The export writes the slug; a seller's own stock file
    // writes whatever they call it, which is usually the name.
    categoryByKey.set(categoryKey(category.name), category.id);
    categoryByKey.set(categoryKey(category.slug), category.id);
  }

  const productBySku = new Map<string, { id: string; slug: string }>();
  for (const product of products) {
    if (product.sku && product.sku.trim() !== "") {
      productBySku.set(product.sku.trim().toLowerCase(), { id: product.id, slug: product.slug });
    }
  }

  /*
     Photos and documents share one index.

     `3i` made them one library with one set of naming rules, and the mapper has
     no way to tell which a filename means before it has resolved it — nor any
     reason to. A datasheet named in a `Photo File` column attaches as the
     datasheet it is.
  */
  const library: LibraryFile[] = [
    ...media.map((row) => ({ id: `media:${row.id}`, filename: row.filename, storagePath: row.storagePath })),
    ...documents.map((row) => ({ id: `document:${row.id}`, filename: row.filename, storagePath: row.storagePath })),
  ];

  return {
    categoryByKey,
    fieldIdsByCategory: new Map(),
    productBySku,
    takenSlugs: new Set(products.map((product) => product.slug)),
    photos: new FilenameIndex(library),
    keyById: new Map(),
    fallbackCategoryId,
    fields: [],
    templateCount: 0,
  };
}

/**
 * The templates every category in the file resolves to, and their fields.
 *
 * Resolved from the categories the file actually names rather than from the
 * seller's primary one — which is the whole of §"One template badge". Called
 * after the categories are known, so a file naming three subcategories loads
 * three templates and a file naming none loads one.
 */
async function templatesFor(categoryIds: readonly string[]): Promise<{
  fieldIdsByCategory: Map<string, Map<string, string>>;
  requirementsByCategory: Map<string, { fieldId: string; label: string; requiredNow: boolean }[]>;
  /** The same fields in the shape `buildProductSearchText` indexes by label. */
  indexFieldsByCategory: Map<string, IndexableField[]>;
  fields: SpecFieldOption[];
  keyById: Map<string, string>;
  templateCount: number;
}> {
  const resolved = await Promise.all(
    categoryIds.map(async (categoryId) => ({
      categoryId,
      templateId: await resolveTemplateId(prisma, categoryId),
    })),
  );
  const templateIds = [
    ...new Set(resolved.map((r) => r.templateId).filter((id): id is string => id !== null)),
  ];

  const fields = templateIds.length
    ? await prisma.specField.findMany({
        where: { templateId: { in: templateIds } },
        orderBy: [{ sortOrder: "asc" }, { key: "asc" }],
        select: {
          id: true,
          key: true,
          label: true,
          templateId: true,
          isFilterable: true,
          required: true,
          requiredFrom: true,
        },
      })
    : [];

  const now = new Date();
  const byTemplate = new Map<string, typeof fields>();
  for (const field of fields) {
    const list = byTemplate.get(field.templateId) ?? [];
    list.push(field);
    byTemplate.set(field.templateId, list);
  }

  const fieldIdsByCategory = new Map<string, Map<string, string>>();
  const indexFieldsByCategory = new Map<string, IndexableField[]>();
  const requirementsByCategory = new Map<
    string,
    { fieldId: string; label: string; requiredNow: boolean }[]
  >();
  for (const { categoryId, templateId } of resolved) {
    const list = templateId ? (byTemplate.get(templateId) ?? []) : [];
    fieldIdsByCategory.set(categoryId, new Map(list.map((field) => [field.key, field.id])));
    indexFieldsByCategory.set(
      categoryId,
      list.map((field) => ({ id: field.id, label: field.label })),
    );
    requirementsByCategory.set(
      categoryId,
      list.map((field) => ({
        fieldId: field.id,
        label: field.label,
        requiredNow:
          field.required && (field.requiredFrom === null || field.requiredFrom.getTime() <= now.getTime()),
      })),
    );
  }

  /*
     One entry per key for the MAPS TO select, not one per SpecField row.

     Three templates each carrying `nominal_size` is one thing the seller can
     map a column to, and offering it three times — indistinguishably, because
     the labels are the same — would be three ways to make the same choice with
     no way to tell which was right.
  */
  const options: SpecFieldOption[] = [];
  for (const field of fields) {
    if (options.some((option) => option.key === field.key)) continue;
    options.push({ id: field.id, key: field.key, label: field.label, isFilterable: field.isFilterable });
  }

  return {
    fieldIdsByCategory,
    requirementsByCategory,
    indexFieldsByCategory,
    fields: options,
    keyById: new Map(fields.map((field) => [field.id, field.key])),
    templateCount: templateIds.length,
  };
}

export interface AnalyseInput {
  businessId: string;
  fallbackCategoryId: string;
  text: string;
  /** Absent on the first read: the suggestions become the plan. */
  plan?: ColumnPlan;
  headerRow?: boolean;
}

/**
 * Read the file, guess or apply a mapping, and say what would happen. Writes
 * nothing.
 *
 * Called again every time the seller changes a column, because §4's rail is a
 * consequence of the mapping rather than of the file — `Listed immediately 386`
 * is a different number once a category column is mapped, and a rail that only
 * updated on upload would be stating the outcome of a mapping nobody chose.
 */
export async function analyseImport(input: AnalyseInput): Promise<ImportPreview> {
  const headerRow = input.headerRow ?? true;
  const parsed: ParsedCsv = parseCsv(input.text, { headerRow });

  const base = await contextFor(input.businessId, input.fallbackCategoryId);

  const roundTrip = looksLikeExport(parsed.headers) ? roundTripPlan(parsed.headers) : null;

  // Pass one: work out which column is the subcategory, so the right templates
  // are loaded before the columns are suggested against them.
  const firstPass = input.plan ?? roundTrip?.plan ?? guessSubcategoryOnly(parsed);
  const categoryIds = categoriesNamedBy(parsed, firstPass, base.categoryByKey, input.fallbackCategoryId);
  const templates = await templatesFor(categoryIds);

  const context: RowContext = {
    ...base,
    fieldIdsByCategory: templates.fieldIdsByCategory,
    keyById: templates.keyById,
  };

  /*
     Suggested once, then reconciled across the whole file.

     `resolveConflicts` is why this is one pass rather than a guess per column:
     whether `Supplier Ref` is the reference column depends on whether some
     other column is a better one, which no single column can know.
  */
  const suggestions = resolveConflicts(
    parsed.headers.map((header, i) =>
      suggestColumn(header, columnValues(parsed, i), templates.fields),
    ),
  );

  const plan: ColumnPlan =
    input.plan ??
    roundTrip?.plan ??
    ({
      columns: suggestions.map((suggestion) =>
        suggestion.reason === undefined
          ? { header: suggestion.header, target: suggestion.target }
          : { header: suggestion.header, target: suggestion.target, reason: suggestion.reason },
      ),
    } satisfies ColumnPlan);

  const analysis = analyseRows(parsed.headers, parsed.rows, plan, context);

  /* Per-column detail, for the table and the tally. */
  const byHeader = new Map(plan.columns.map((column) => [column.header, column.target]));
  // The mapping was chosen — by the seller, or by the file being one of ours —
  // rather than guessed at.
  const decided = input.plan !== undefined || roundTrip !== null;
  const columns: ColumnView[] = parsed.headers.map((header, i) => {
    const values = columnValues(parsed, i);
    const suggestion = suggestions[i]!;
    const target = byHeader.get(header) ?? suggestion.target;
    const unresolved = unresolvedIn(target.kind, values, context);
    return {
      header,
      sample: values.find((value) => value.trim() !== "")?.trim() ?? "",
      suggestion: { ...suggestion, target },
      status: statusOf({
        /*
           Confidence is what the *matcher* is unsure about, so it only applies
           to a mapping the matcher produced.

           A round-trip file was reading `11 matched · 16 need you` — every
           column of our own export asking the seller to confirm a mapping the
           file itself carries. §States is explicit that a file from `Export ▾`
           opens with all columns matched and nothing to map.
        */
        target,
        confidence: decided ? undefined : suggestion.confidence,
        ...(suggestion.splittable && target.kind !== "ignore" && target.kind !== "blocked"
          ? { splitPending: true }
          : {}),
        unresolved,
      }),
      unresolved,
    };
  });

  const caps = await effectiveFor(input.businessId);
  /*
     Counted against what is **listed**, not against how many records exist.

     `3f`'s header says so in as many words — *"the cap is on reach rather than
     on records: nothing is deleted or refused storage for a billing reason"* —
     and this path counted `prisma.product.count`, every draft included. The two
     screens therefore disagreed about the same seller: a catalogue of 118
     products with 63 live reads `63 OF 100 LISTED` on `3f` and read *no room*
     here, over 37 free listing slots. One definition of the cap, and it is the
     one the seller has already been shown.
  */
  const listedNow = await prisma.product.count({
    where: { businessId: input.businessId, status: "live" },
  });
  const room = caps ? allowance(caps, "products", listedNow) : null;

  const incomplete = countIncomplete(analysis.verdicts, templates.requirementsByCategory);
  const listed = listableCount(analysis.created - incomplete, room?.remaining ?? null);

  return {
    headers: parsed.headers,
    columns,
    tally: tallyOf(columns.map((column) => column.status)),
    rowCount: parsed.rows.length,
    raggedRows: parsed.raggedRows,
    truncated: parsed.truncated,
    sample: parsed.rows.slice(0, 5),
    headerRow,
    plan,
    roundTrip: roundTrip
      ? { name: ROUND_TRIP_MAPPING_NAME, matched: roundTrip.matched, unknown: roundTrip.unknown }
      : null,
    subcategories: {
      matched: categoryIds.length,
      templates: templates.templateCount,
      unknown: analysis.unknownCategories,
    },
    photos: {
      matched: analysis.photosMatched,
      unmatched: analysis.photosUnmatched,
      ambiguous: analysis.photosAmbiguous,
    },
    outcome: {
      created: analysis.created,
      updated: analysis.updated,
      errors: analysis.errors,
      rowCount: analysis.rowCount,
      listed,
      incomplete,
      cap: room?.cap ?? null,
      planName: caps?.name ?? "",
      roomRemaining: room?.remaining ?? null,
      errorRows: analysis.verdicts
        .filter((verdict): verdict is Extract<RowVerdict, { kind: "error" }> => verdict.kind === "error")
        .slice(0, 50)
        .map((verdict) => describeError(verdict)),
    },
    fields: templates.fields,
    /*
       §States: *"A file that is all price and no spec — every column blocked or
       ignored; `Preview` is disabled with `Nothing in this file can be
       imported` rather than a preview of nothing."*
    */
    importable: planIsUsable(plan) && analysis.created + analysis.updated > 0,
  };
}

/** Enough of a plan to find the category column, before templates are known. */
function guessSubcategoryOnly(parsed: ParsedCsv): ColumnPlan {
  return {
    columns: parsed.headers.map((header, i) => ({
      header,
      target: suggestColumn(header, columnValues(parsed, i), []).target,
    })),
  };
}

function categoriesNamedBy(
  parsed: ParsedCsv,
  plan: ColumnPlan,
  categoryByKey: ReadonlyMap<string, string>,
  fallbackCategoryId: string,
): string[] {
  const index = parsed.headers.findIndex(
    (header) => plan.columns.find((column) => column.header === header)?.target.kind === "subcategory",
  );
  if (index < 0) return [fallbackCategoryId];

  const ids = new Set<string>();
  for (const row of parsed.rows) {
    const value = (row[index] ?? "").trim();
    if (value === "") {
      ids.add(fallbackCategoryId);
      continue;
    }
    const found = categoryByKey.get(categoryKey(value));
    if (found) ids.add(found);
  }
  // A file whose every category is unknown still needs one template loaded, or
  // the MAPS TO select would be empty and the seller could not fix the mapping
  // that would fix the rows.
  if (ids.size === 0) ids.add(fallbackCategoryId);
  return [...ids];
}

/** How many values in a column resolved to nothing, for the STATUS cell. */
function unresolvedIn(kind: string, values: readonly string[], context: RowContext): number {
  if (kind === "photo") {
    let unresolved = 0;
    for (const value of values) {
      for (const filename of splitFilenames(value)) {
        if (context.photos.match(filename).kind !== "matched") unresolved += 1;
      }
    }
    return unresolved;
  }
  if (kind === "subcategory") {
    let unresolved = 0;
    for (const value of values) {
      const trimmed = value.trim();
      if (trimmed === "") continue;
      if (!context.categoryByKey.has(categoryKey(trimmed))) unresolved += 1;
    }
    return unresolved;
  }
  return 0;
}

function describeError(verdict: Extract<RowVerdict, { kind: "error" }>): {
  row: number;
  reason: string;
  detail?: string;
} {
  switch (verdict.error.reason) {
    case "no_name":
      return { row: verdict.rowNumber, reason: t("import.error.no_name") };
    case "unknown_category":
      return {
        row: verdict.rowNumber,
        reason: t("import.error.unknown_category"),
        detail: verdict.error.value,
      };
    case "duplicate_name":
      return {
        row: verdict.rowNumber,
        reason: t("import.error.duplicate_name"),
        detail: verdict.error.name,
      };
  }
}

/** New products whose template has an unfilled required field. `3h` §5. */
function countIncomplete(
  verdicts: readonly RowVerdict[],
  requirements: ReadonlyMap<string, { fieldId: string; label: string; requiredNow: boolean }[]>,
): number {
  let incomplete = 0;
  for (const verdict of verdicts) {
    if (verdict.kind !== "create") continue;
    const fields = requirements.get(verdict.categoryId) ?? [];
    if (!missingFrom(fields, verdict.specValues).ok) incomplete += 1;
  }
  return incomplete;
}

/* ── Applying it ──────────────────────────────────────────────────────────── */

export type ImportResult =
  | {
      ok: true;
      importRunId: string;
      created: number;
      updated: number;
      listed: number;
      errors: { row: number; reason: string; detail?: string }[];
    }
  | { ok: false; error: string };

export interface ApplyImportInput {
  businessId: string;
  fallbackCategoryId: string;
  filename: string;
  text: string;
  plan: ColumnPlan;
  headerRow?: boolean;
  /** Save the mapping under this name for next month. */
  saveAs?: string;
}

/** `media:<id>` / `document:<id>`, the prefixed ids board 3i's library uses. */
function splitLibraryIds(ids: readonly string[]): { media: string[]; documents: string[] } {
  const media: string[] = [];
  const documents: string[] = [];
  for (const id of ids) {
    if (id.startsWith("media:")) media.push(id.slice("media:".length));
    else if (id.startsWith("document:")) documents.push(id.slice("document:".length));
  }
  return { media, documents };
}

export async function applyImport(actor: Actor, input: ApplyImportInput): Promise<ImportResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== input.businessId) {
    return { ok: false, error: t("import.not_yours") };
  }

  /*
     Before anything is read, let alone written. The mapper will not offer a
     money column any target but `blocked`, but the plan travels through a form
     and through a saved mapping, and both are strings the seller could edit.
     This throws rather than warning — there is no partial success worth having.
  */
  assertNoPriceEscapes(input.plan);

  if (!planIsUsable(input.plan)) {
    return { ok: false, error: t("import.needs_name") };
  }

  let analysis: Analysis;
  try {
    analysis = await reanalyse(input, input.headerRow ?? true);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : t("import.unreadable") };
  }

  const toCreate = analysis.verdicts.filter(
    (verdict): verdict is Extract<RowVerdict, { kind: "create" }> => verdict.kind === "create",
  );
  const toUpdate = analysis.verdicts.filter(
    (verdict): verdict is Extract<RowVerdict, { kind: "update" }> => verdict.kind === "update",
  );

  if (toCreate.length === 0 && toUpdate.length === 0) {
    return { ok: false, error: t("import.nothing_importable") };
  }

  const caps = await effectiveFor(input.businessId);

  /*
     Names and search text, resolved once for the whole file.

     This path created products with `search_text` null — every one of them —
     so a seller's entire imported catalogue was unfindable by size or
     specification, which is the one thing `Product.searchText` exists for.
  */
  const categoryIds = [
    ...new Set([...toCreate, ...toUpdate].map((verdict) => verdict.categoryId)),
  ];
  const [categoryNames, templates] = await Promise.all([
    prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true },
    }),
    templatesFor(categoryIds),
  ]);
  const nameOf = new Map(categoryNames.map((category) => [category.id, category.name]));

  /*
     Which new products may be listed, and why the others may not.

     Two separate reasons, and they are not interchangeable. A product held back
     by the **cap** is complete and the plan has no room — `3f` §6, restored by
     an upgrade. A product held back by an unfilled **required field** is the
     platform's own `3h` §5 rule, which `saveProduct` enforces and this path
     used to bypass entirely. Neither refuses the row: the record exists either
     way, and that is criterion 10.
  */
  const complete = new Set<string>();
  for (const verdict of toCreate) {
    const fields = templates.requirementsByCategory.get(verdict.categoryId) ?? [];
    if (missingFrom(fields, verdict.specValues).ok) complete.add(verdict.fields.slug);
  }

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.importRun.create({
      data: {
        businessId: input.businessId,
        actorId: actor.id,
        filename: input.filename,
        rowCount: analysis.rowCount,
        createdCount: toCreate.length,
        updatedCount: toUpdate.length,
        errorCount: analysis.errors,
        listedCount: 0, // Written below, once the cap has had its say.
        // The plan as applied, not as offered: a mapping overridden at the last
        // moment must not come back different when it is reused next month.
        columnPlan: input.plan as unknown as object,
      },
      select: { id: true },
    });

    if (toCreate.length > 0) {
      await tx.product.createMany({
        data: toCreate.map((verdict) => ({
          businessId: input.businessId,
          categoryId: verdict.categoryId,
          importRunId: created.id,
          name: verdict.fields.name,
          slug: verdict.fields.slug,
          sku: verdict.fields.sku,
          description: verdict.fields.description,
          availability: verdict.fields.availability,
          stockQty: verdict.fields.stockQty,
          leadTimeDays: verdict.fields.leadTimeDays,
          minOrderQty: verdict.fields.minOrderQty,
          specValues: verdict.specValues,
          searchText: buildProductSearchText({
            name: verdict.fields.name,
            sku: verdict.fields.sku,
            description: verdict.fields.description,
            categoryName: nameOf.get(verdict.categoryId) ?? null,
            specValues: verdict.specValues,
            fields: templates.indexFieldsByCategory.get(verdict.categoryId) ?? [],
          }),
          /*
             Listed, unless a required field is empty. The cap is applied after
             this by `hideOverPlanCap`, which keeps the oldest live products and
             hides the newest — so an import fills whatever room is left without
             unlisting anything the seller already had live.
          */
          status: complete.has(verdict.fields.slug) ? "live" : "draft",
        })),
      });
    }

    // `createMany` returns no ids, and the media joins need them. One query
    // rather than a pass per row.
    const newRows = await tx.product.findMany({
      where: { importRunId: created.id },
      select: { id: true, slug: true },
    });
    const idBySlug = new Map(newRows.map((row) => [row.slug, row.id]));

    /* ── The rows that already existed ─────────────────────────────────── */
    for (const verdict of toUpdate) {
      const before = await tx.product.findUnique({
        where: { id: verdict.productId },
        select: {
          name: true,
          sku: true,
          description: true,
          availability: true,
          stockQty: true,
          leadTimeDays: true,
          minOrderQty: true,
          specValues: true,
          categoryId: true,
          status: true,
          media: { orderBy: { sortOrder: "asc" }, select: { mediaId: true } },
        },
      });
      if (!before) continue;

      await tx.importRunChange.create({
        data: {
          importRunId: created.id,
          productId: verdict.productId,
          previous: before as unknown as object,
          previousMedia: before.media.map((row) => row.mediaId),
        },
      });

      /*
         Merged, not replaced.

         A file carrying four columns must not empty the twenty fields it does
         not mention. The export writes every field, so a round trip still
         replaces what it carries; a hand-kept stock file with `Part No` and
         `Qty on hand` updates two things and leaves the rest of the product
         where the seller put it.
      */
      const mergedSpecs = {
        ...((before.specValues ?? {}) as Record<string, unknown>),
        ...verdict.specValues,
      };

      await tx.product.update({
        where: { id: verdict.productId },
        data: {
          name: verdict.fields.name,
          categoryId: verdict.categoryId,
          ...(verdict.fields.description === null ? {} : { description: verdict.fields.description }),
          availability: verdict.fields.availability,
          ...(verdict.fields.stockQty === null
            ? {}
            : { stockQty: verdict.fields.stockQty, stockUpdatedAt: new Date() }),
          ...(verdict.fields.leadTimeDays === null ? {} : { leadTimeDays: verdict.fields.leadTimeDays }),
          ...(verdict.fields.minOrderQty === null ? {} : { minOrderQty: verdict.fields.minOrderQty }),
          specValues: mergedSpecs as object,
          searchText: buildProductSearchText({
            name: verdict.fields.name,
            sku: verdict.fields.sku,
            description: verdict.fields.description ?? before.description,
            categoryName: nameOf.get(verdict.categoryId) ?? null,
            specValues: mergedSpecs,
            fields: templates.indexFieldsByCategory.get(verdict.categoryId) ?? [],
          }),
        },
      });
    }

    /* ── Photographs, as references ────────────────────────────────────── */
    const mediaRows: { productId: string; mediaId: string; sortOrder: number }[] = [];
    const documentRows: { productId: string; documentId: string; sortOrder: number }[] = [];

    const attach = (productId: string, ids: readonly string[]) => {
      const split = splitLibraryIds(ids);
      split.media.forEach((mediaId, i) => mediaRows.push({ productId, mediaId, sortOrder: i }));
      split.documents.forEach((documentId, i) =>
        documentRows.push({ productId, documentId, sortOrder: i }),
      );
    };

    for (const verdict of toCreate) {
      const productId = idBySlug.get(verdict.fields.slug);
      if (productId) attach(productId, verdict.photos.ids);
    }
    for (const verdict of toUpdate) {
      // Only when the file names photographs. A file with no photo column must
      // not silently detach the images a product already has.
      if (verdict.photos.ids.length === 0) continue;
      await tx.productMedia.deleteMany({ where: { productId: verdict.productId } });
      await tx.productDocument.deleteMany({ where: { productId: verdict.productId } });
      attach(verdict.productId, verdict.photos.ids);
    }

    /*
       References, never copies — board 3i's model, and criterion 7. One
       filename on forty rows becomes forty join rows pointing at one file.
       `skipDuplicates` because two photo columns naming the same file in one
       row is a seller's spreadsheet, not an error.
    */
    if (mediaRows.length > 0) {
      await tx.productMedia.createMany({ data: mediaRows, skipDuplicates: true });
    }
    if (documentRows.length > 0) {
      await tx.productDocument.createMany({ data: documentRows, skipDuplicates: true });
    }

    /* ── The cap, applied rather than refused ──────────────────────────── */
    if (caps) {
      await hideOverPlanCap(input.businessId, caps, tx);
    }
    const listed = await tx.product.count({
      where: { importRunId: created.id, status: "live" },
    });
    await tx.importRun.update({ where: { id: created.id }, data: { listedCount: listed } });

    if (input.saveAs) {
      await tx.importMapping.upsert({
        where: { businessId_name: { businessId: input.businessId, name: input.saveAs } },
        create: {
          businessId: input.businessId,
          name: input.saveAs,
          categoryId: input.fallbackCategoryId,
          columnPlan: input.plan as unknown as object,
        },
        update: { columnPlan: input.plan as unknown as object, usedAt: new Date() },
      });
    }

    return { id: created.id, listed };
  });

  /*
     Outside the transaction deliberately: it reads the catalogue back, and
     holding a pooled connection open across that turns one slow import into a
     queue for everybody else.
  */
  await reindexBusiness(input.businessId);

  return {
    ok: true,
    importRunId: run.id,
    created: toCreate.length,
    updated: toUpdate.length,
    listed: run.listed,
    errors: analysis.verdicts
      .filter((verdict): verdict is Extract<RowVerdict, { kind: "error" }> => verdict.kind === "error")
      .map(describeError),
  };
}

/**
 * The analysis again, from the same inputs.
 *
 * `analyseImport` returns what the screen needs; applying needs the verdicts
 * themselves. Recomputed rather than carried through the form: the verdicts
 * hold product ids and media ids, and a client that could post those back could
 * post back somebody else's.
 */
async function reanalyse(input: ApplyImportInput, headerRow: boolean): Promise<Analysis> {
  const parsed = parseCsv(input.text, { headerRow });
  const base = await contextFor(input.businessId, input.fallbackCategoryId);
  const categoryIds = categoriesNamedBy(parsed, input.plan, base.categoryByKey, input.fallbackCategoryId);
  const templates = await templatesFor(categoryIds);
  return analyseRows(parsed.headers, parsed.rows, input.plan, {
    ...base,
    fieldIdsByCategory: templates.fieldIdsByCategory,
    keyById: templates.keyById,
  });
}

/* ── Undoing it ───────────────────────────────────────────────────────────── */

export type RevertResult =
  | { ok: true; unlisted: number; restored: number }
  | { ok: false; error: string };

/**
 * Undo a run, within the window — and §4's scope, stated.
 *
 * The board promised *"For 24 hours you can roll the import back"* and said
 * nothing about what that restored, which on an import that overwrote eighteen
 * live products is the only part anyone needs. §4 answers it: **the new
 * products are unlisted and the updated ones return to their previous values.**
 *
 * The previous implementation did neither. It ran `deleteMany` over everything
 * the run created and left everything the run overwrote exactly as the import
 * had left it — so the half of the import that changed existing products was
 * not undone at all, and the half that added them was undone by destroying
 * records. `3f` §6 and `3i` both hold that no billing or import event destroys
 * a record; an undo is not an exception, it is the case that most looks like
 * one.
 *
 * Unlisting rather than deleting also makes the undo itself reversible. A
 * seller who imports four hundred products, rolls it back and then decides they
 * were right the first time has four hundred drafts to publish, not four
 * hundred rows to re-upload.
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
    return { ok: false, error: t("import.undo_not_found") };
  }
  if (run.revertedAt) {
    return { ok: false, error: t("import.undo_already") };
  }

  const age = now.getTime() - run.createdAt.getTime();
  if (age > REVERSIBLE_FOR_MS) {
    return { ok: false, error: t("import.undo_expired") };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    /*
       Unlisted, not deleted, and only the ones still live.

       `updateMany` over the run's products rather than a delete. A product the
       seller has since published by hand is still one this run created, and
       unlisting it is the honest undo — the alternative is deciding on the
       seller's behalf that their later edit does not count.
    */
    const { count: unlisted } = await tx.product.updateMany({
      where: { importRunId: run.id, status: "live" },
      data: { status: "draft" },
    });

    const changes = await tx.importRunChange.findMany({
      where: { importRunId: run.id },
      select: { productId: true, previous: true, previousMedia: true },
    });

    for (const change of changes) {
      const before = change.previous as Record<string, unknown>;
      await tx.product.update({
        where: { id: change.productId },
        data: {
          name: before.name as string,
          sku: (before.sku as string | null) ?? null,
          description: (before.description as string | null) ?? null,
          availability: before.availability as never,
          stockQty: (before.stockQty as number | null) ?? null,
          leadTimeDays: (before.leadTimeDays as number | null) ?? null,
          minOrderQty: (before.minOrderQty as number | null) ?? null,
          specValues: (before.specValues ?? {}) as object,
          categoryId: before.categoryId as string,
          status: before.status as never,
        },
      });

      /*
         The gallery, in the order it was in.

         Board 3i settled that position 0 **is** the primary image and there is
         no separate flag, so restoring the set without the order would restore
         a different primary image — the one part of a product page a buyer sees
         first. Only touched when the import touched it: an empty snapshot from
         a run whose file had no photo column would otherwise detach every image
         the product has.
      */
      if (change.previousMedia.length > 0) {
        await tx.productMedia.deleteMany({ where: { productId: change.productId } });
        await tx.productMedia.createMany({
          data: change.previousMedia.map((mediaId, index) => ({
            productId: change.productId,
            mediaId,
            sortOrder: index,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Marked, not deleted. The record of what was imported and undone survives.
    await tx.importRun.update({ where: { id: run.id }, data: { revertedAt: now } });
    return { unlisted, restored: changes.length };
  });

  /*
     The catalogue shrank back. Without this the business would still be
     findable by products it no longer lists — an undo that leaves the search
     index behind has not undone the import.
  */
  await reindexBusiness(run.businessId);

  return { ok: true, ...outcome };
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
    select: {
      id: true,
      filename: true,
      createdCount: true,
      updatedCount: true,
      listedCount: true,
      createdAt: true,
    },
  });
}

/**
 * The seller's saved mappings, plus the one that is not theirs.
 *
 * §5 lists `Business Listings export · MAPS 1:1` above the seller's own. It is
 * not a row in `import_mapping` — it cannot be renamed or deleted, and it is
 * recognised from the file's headers rather than stored, which is what keeps it
 * correct after a template gains a field.
 */
export async function savedMappings(businessId: string) {
  const rows = await prisma.importMapping.findMany({
    where: { businessId },
    orderBy: [{ usedAt: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, usedAt: true, columnPlan: true },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    usedAt: row.usedAt,
    plan: row.columnPlan as unknown as ColumnPlan,
  }));
}
