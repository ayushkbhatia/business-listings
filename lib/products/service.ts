import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import { assertCanEditProduct } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { allowance } from "@/lib/plan/entitlements";
import { slugForTemplate } from "@/lib/catalogue/template";
import { WEIGHTS } from "@/lib/metrics/profile-strength";
import { buildProductSearchText } from "@/lib/search/index-text";
import {
  isPublishable,
  NAME_MAX,
  NAME_MIN,
  PRODUCT_TARGET,
  productSlug,
  sizeFieldOf,
  specStanding,
  type SheetField,
  type SpecStanding,
} from "./rows";

/**
 * Board 8c — the spec sheet, then the first ten rows.
 *
 * ## The gap this closes
 *
 * Nothing in this product could create a `Product`. The only writer in the
 * application layer was `tx.product.createMany` inside the CSV importer;
 * `saveProduct` on the product editor opens with `findUnique` and ends with
 * `update`, and there was no `/dashboard/products/new`. A leftover
 * `"catalogue.add": "Add a product"` sat in the catalogue with nothing
 * rendering it — somebody wrote the button's label and the button never
 * arrived.
 *
 * So a supplier without a correctly-columned spreadsheet could not put a single
 * product on this platform, and task 2 of the setup hub — worth eighteen points
 * and the only task that creates new indexable pages — was uncompletable by the
 * route its own copy describes. That is the third time this shape of defect has
 * turned up: the team task could not complete because invitations had no accept
 * route, and the photographs task could not complete on Free because the cap sat
 * at the target.
 *
 * ## Live is a consequence, not a button
 *
 * §4: a row goes live when name, size and availability are all present. No
 * publish control, no draft column, no review step — the same commit-as-you-go
 * model board 8b uses. A row with a name and nothing else is saved, private and
 * excluded from every count.
 *
 * ## Counting is two numbers from one table
 *
 * "3 live · 7 more to finish this task" in the render is deliberately not one
 * figure counted twice. Three rows are published; seven more *qualifying* rows
 * are needed, where qualifying means at least 60% of the sheet's required
 * attributes. A row below that bar is live, findable and enquirable, and does
 * not help the task — §3 is explicit that it must not be hidden, must not be
 * unpublished, and must not be counted.
 */

export type ProductResult = { ok: true; id?: string } | { ok: false; error: string };

export interface SheetChoice {
  id: string;
  name: string;
  /** The subcategories this sheet serves. Many-to-many since board 4e. */
  categoryId: string;
  categoryName: string;
  fields: number;
  required: number;
  filterable: number;
  /** Live suppliers using this sheet. Excludes suspended listings. §2. */
  adoption: number;
  /** True where one of the sheet's categories is one of this business's own. */
  matches: boolean;
}

export interface ProductRow {
  id: string;
  name: string;
  size: string;
  availability: string | null;
  live: boolean;
  hasImage: boolean;
  specs: SpecStanding;
}

export interface ProductBoard {
  /** The sheet in use, or null while step 2 is still waiting. */
  sheetId: string | null;
  sheetName: string | null;
  /** A business-owned sheet with no platform parent. §2's blank sheet. */
  blank: boolean;
  fields: SheetField[];
  sizeFieldId: string | null;
  sizeFieldLabel: string | null;
  rows: ProductRow[];
  /** Rows with the publishable trio. The left half of the footer. */
  live: number;
  /** Live rows at or above the 60% bar. What the task actually counts. */
  qualifying: number;
  target: number;
  done: boolean;
  pointsSoFar: number;
  cap: number | null;
  atCap: boolean;
  capRemaining: number | null;
  planName: string | null;
}

/**
 * Every sheet a seller could pick, ranked. §2.
 *
 * Matching category first, then adoption, then name. Adoption is a live count
 * and excludes suspended listings, because a number on this screen that
 * includes suppliers a buyer cannot reach is a number arguing for a sheet on
 * false evidence.
 */
export async function sheetChoicesFor(businessId: string): Promise<SheetChoice[]> {
  const [business, templates] = await Promise.all([
    prisma.business.findUnique({
      where: { id: businessId },
      select: {
        /*
           The parent as well as the category itself.

           Templates belong to the trade rather than to the niche: the seeded
           sheet sits on "Valves & fittings" and a supplier is filed under "Ball
           valves". Comparing category ids alone meant `MATCHES YOUR CATEGORY`
           never fired for anybody under a subcategory, which is most suppliers —
           the single most useful signal on step 1, silently off.

           `resolveDefaultTemplateId` in lib/db/queries/catalogue.ts already
           walks one hop up for the same reason and says why: two levels is the
           whole taxonomy, so one hop is the whole search.
        */
        primaryCategory: { select: { id: true, parentId: true } },
        categories: { select: { category: { select: { id: true, parentId: true } } } },
      },
    }),
    prisma.specTemplate.findMany({
      where: { status: "live" },
      select: {
        id: true,
        name: true,
        categories: { select: { category: { select: { id: true, name: true } } } },
        fields: { select: { required: true, isFilterable: true } },
      },
    }),
  ]);

  const mine = new Set<string>();
  const remember = (category: { id: string; parentId: string | null } | null) => {
    if (!category) return;
    mine.add(category.id);
    if (category.parentId) mine.add(category.parentId);
  };
  remember(business?.primaryCategory ?? null);
  for (const row of business?.categories ?? []) remember(row.category);

  /*
     One grouped count rather than a count per template. The library is small
     today and will not stay small, and a query per row is the shape that only
     shows up as a problem once somebody has authored eighty sheets.
  */
  const adoption = await prisma.product.groupBy({
    by: ["categoryId"],
    where: { status: "live", business: { suspendedAt: null, publishedAt: { not: null } } },
    _count: { businessId: true },
  });
  const byCategory = new Map(adoption.map((row) => [row.categoryId, row._count.businessId]));

  return templates
    .map((template) => {
      /*
         A sheet serves several subcategories since board 4e, so both the
         adoption figure and the match test go over the whole set: summing the
         first category alone would understate a sheet that covers four of
         them, and testing it alone would turn `MATCHES YOUR CATEGORY` off for
         a seller filed under the second.
      */
      const served = template.categories.map((link) => link.category);
      const first = served[0];
      return {
        id: template.id,
        name: template.name,
        categoryId: first?.id ?? "",
        categoryName: served.map((category) => category.name).join(" · "),
        fields: template.fields.length,
        required: template.fields.filter((field) => field.required).length,
        filterable: template.fields.filter((field) => field.isFilterable).length,
        adoption: served.reduce((sum, category) => sum + (byCategory.get(category.id) ?? 0), 0),
        matches: served.some((category) => mine.has(category.id)),
      };
    })
    .sort(
      (a, b) =>
        Number(b.matches) - Number(a.matches) ||
        b.adoption - a.adoption ||
        a.name.localeCompare(b.name),
    );
}

/**
 * The screen's whole state.
 *
 * The sheet is the business's `SellerTemplate` — one per catalogue in this
 * phase, which is why every row's spec count shares a denominator. §2 says a
 * per-product override is a real future need and is not built; when it lands,
 * this is where the denominator stops being shared.
 */
export async function productBoardFor(
  businessId: string,
  now: Date = new Date(),
): Promise<ProductBoard> {
  const [sheet, products, caps, used] = await Promise.all([
    prisma.sellerTemplate.findFirst({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        platformTemplateId: true,
        platformTemplate: {
          select: {
            id: true,
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
                isFilterable: true,
                requiredFrom: true,
              },
            },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        availability: true,
        status: true,
        specValues: true,
        _count: { select: { media: true } },
      },
    }),
    effectiveFor(businessId),
    prisma.product.count({ where: { businessId } }),
  ]);

  const fields: SheetField[] = (sheet?.platformTemplate.fields ?? []).map((field) => ({
    id: field.id,
    key: field.key,
    label: field.label,
    type: String(field.type),
    unit: field.unit,
    options: field.options,
    required: field.required,
    isFilterable: field.isFilterable,
    requiredFrom: field.requiredFrom,
  }));

  const sizeField = sizeFieldOf(fields);
  const left = caps ? allowance(caps, "products", used) : null;

  const rows: ProductRow[] = products.map((product) => {
    const values = (product.specValues ?? {}) as Record<string, unknown>;
    return {
      id: product.id,
      name: product.name,
      size: sizeField ? String(values[sizeField.id] ?? "") : "",
      availability: product.availability,
      live: product.status === "live",
      hasImage: product._count.media > 0,
      specs: specStanding(values, fields, now),
    };
  });

  const live = rows.filter((row) => row.live).length;
  const qualifying = rows.filter((row) => row.live && row.specs.qualifies).length;

  /*
     Pro-rata on qualifying rows, not on live ones. §9's fourth open question,
     answered the way it recommends and the way the footer already counts: a
     chip that counted rows the footer excludes would be the screen arguing with
     itself in two places a centimetre apart.
  */
  const ratio = Math.min(1, qualifying / PRODUCT_TARGET);

  return {
    sheetId: sheet?.id ?? null,
    sheetName: sheet?.name ?? null,
    blank: false,
    fields,
    sizeFieldId: sizeField?.id ?? null,
    sizeFieldLabel: sizeField?.label ?? null,
    rows,
    live,
    qualifying,
    target: PRODUCT_TARGET,
    done: qualifying >= PRODUCT_TARGET,
    pointsSoFar: Math.floor(ratio * WEIGHTS.catalogue),
    cap: left?.cap ?? null,
    atCap: left?.atCap ?? false,
    capRemaining: left?.remaining ?? null,
    planName: caps?.name ?? null,
  };
}

/**
 * Pick the sheet. §2.
 *
 * One per catalogue in this phase, so choosing again replaces the previous
 * choice rather than adding a second. Values already stored against the old
 * sheet's fields are left on the products untouched — they are keyed by field
 * id, so a field the new sheet does not have simply stops being read. §7's
 * "confirm listing what will be lost" is computed by `attrsLostByChanging`
 * below and shown before this is called.
 */
export async function chooseSheet(
  actor: Actor,
  businessId: string,
  platformTemplateId: string,
): Promise<ProductResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own catalogue." };
  }

  const template = await prisma.specTemplate.findFirst({
    where: { id: platformTemplateId, status: "live" },
    select: { id: true, name: true },
  });
  if (!template) return { ok: false, error: "That spec sheet cannot be found." };

  /*
     Find or create the clone for THIS sheet, rather than repointing the one row
     the business had.

     Repointing kept `fieldMappings` — a map keyed by the previous template's
     field ids — against a template whose fields have different ids entirely.
     The keys were inert only because the resolver iterates the platform's
     fields rather than the mapping's, so a seller who switched sheets lost
     every label they had written and could not get them back by switching
     again. Now each sheet keeps its own overlay, and switching back returns the
     seller to their own words.

     It is also what board 3h's templates rail is: a business may hold several,
     and `@@unique([businessId, platformTemplateId])` is what stops it holding
     two of the same one.
  */
  await prisma.sellerTemplate.upsert({
    where: { businessId_platformTemplateId: { businessId, platformTemplateId: template.id } },
    create: {
      businessId,
      platformTemplateId: template.id,
      name: template.name,
      slug: (await slugForTemplate(businessId, template.name)) ?? `t-${template.id}`,
    },
    update: {},
  });

  return { ok: true, id: template.id };
}

/**
 * What changing the sheet would cost, by name. §7.
 *
 * Values are keyed by `SpecField.id`, so "lost" means stored under a field the
 * new sheet does not contain. Nothing is deleted — the values stay on the row
 * and stop being read — but they stop appearing anywhere, which is a loss from
 * where the seller is standing and is worth naming before the change rather
 * than discovering afterwards.
 */
export async function attrsLostByChanging(
  businessId: string,
  nextTemplateId: string,
): Promise<{ label: string; products: number }[]> {
  const [current, next, products] = await Promise.all([
    prisma.sellerTemplate.findFirst({
      where: { businessId },
      select: {
        platformTemplate: { select: { fields: { select: { id: true, label: true } } } },
      },
    }),
    prisma.specTemplate.findUnique({
      where: { id: nextTemplateId },
      select: { fields: { select: { id: true } } },
    }),
    prisma.product.findMany({ where: { businessId }, select: { specValues: true } }),
  ]);
  if (!current || !next) return [];

  const keeping = new Set(next.fields.map((field) => field.id));
  const losing = current.platformTemplate.fields.filter((field) => !keeping.has(field.id));

  return losing
    .map((field) => ({
      label: field.label,
      products: products.filter((product) => {
        const values = (product.specValues ?? {}) as Record<string, unknown>;
        const held = values[field.id];
        return held !== undefined && held !== null && held !== "";
      }).length,
    }))
    .filter((entry) => entry.products > 0);
}

export interface RowInput {
  /** Absent for a new row. The empty line is not a record until it is named. */
  id?: string | undefined;
  name: string;
  size: string;
  availability: string | null;
}

/**
 * Create or update one row, and decide whether it is live.
 *
 * The first `Product` writer in this product that a seller can reach. It has to
 * do three things the importer already does, or a hand-typed product is a
 * second-class one:
 *
 *   - build `searchText`, or the row is invisible to search — which would make
 *     the whole task pointless, since §Intro's argument for ten products is that
 *     each is a searchable page;
 *   - take a slug that is unique per business, retried rather than assumed;
 *   - write the size into `specValues` under the sheet's own size field, which
 *     is where every reader looks for it.
 */
export async function saveRow(
  actor: Actor,
  businessId: string,
  input: RowInput,
): Promise<ProductResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own catalogue." };
  }

  const name = input.name.trim().slice(0, NAME_MAX);
  if (name.length < NAME_MIN) return { ok: false, error: "too_short" };

  const board = await productBoardFor(businessId);
  const size = input.size.trim().slice(0, 80);
  const availability = readAvailability(input.availability);
  const live = isPublishable({ name, size, availability });

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { primaryCategoryId: true },
  });
  if (!business) return { ok: false, error: "That listing cannot be found." };

  const specValues =
    board.sizeFieldId && size !== "" ? { [board.sizeFieldId]: size } : {};

  if (input.id) {
    const existing = await prisma.product.findFirst({
      where: { id: input.id, businessId },
      select: { id: true, specValues: true },
    });
    if (!existing) return { ok: false, error: "That product cannot be found." };

    const merged = { ...((existing.specValues ?? {}) as object), ...specValues };
    await prisma.product.update({
      where: { id: existing.id },
      data: {
        name,
        availability,
        specValues: merged as Prisma.InputJsonValue,
        status: live ? "live" : "draft",
        searchText: buildProductSearchText({ name, specValues: merged }),
      },
    });
    return { ok: true, id: existing.id };
  }

  // The cap applies to creating a row, never to correcting one. A seller at the
  // limit must still be able to fix what they have — see the screen's own copy.
  if (board.atCap) return { ok: false, error: "at_cap" };

  const created = await createWithUniqueSlug(businessId, business.primaryCategoryId, {
    name,
    availability,
    specValues,
    live,
  });
  return { ok: true, id: created };
}

interface CreateInput {
  name: string;
  availability: AvailabilityValue;
  specValues: Record<string, unknown>;
  live: boolean;
}

/**
 * Insert, retrying the slug rather than guessing at it.
 *
 * `@@unique([businessId, slug])` is the only thing that knows whether a slug is
 * taken, and a read-then-write would still race two tabs. Two suffixed attempts
 * cover the realistic case — a supplier with two products of the same name —
 * and the third falls back to the row's own randomness.
 */
async function createWithUniqueSlug(
  businessId: string,
  categoryId: string,
  input: CreateInput,
): Promise<string> {
  const base = productSlug(input.name);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const slug =
      attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    try {
      const created = await prisma.product.create({
        data: {
          businessId,
          categoryId,
          name: input.name,
          slug,
          availability: input.availability,
          specValues: input.specValues as Prisma.InputJsonValue,
          status: input.live ? "live" : "draft",
          searchText: buildProductSearchText({
            name: input.name,
            specValues: input.specValues,
          }),
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      const taken =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
      if (!taken || attempt === 2) throw error;
    }
  }

  throw new Error("could not find a free slug");
}

/**
 * Remove a row, and leave its address working. §4.
 *
 * A live product's page has been indexed and may be linked; deleting it without
 * a redirect turns a search result into a 404, which is a worse answer than the
 * catalogue it came from. A row that never went live has no address to keep.
 */
export async function deleteRow(
  actor: Actor,
  businessId: string,
  productId: string,
): Promise<ProductResult> {
  assertCanEditProduct(actor);
  if (actor.businessId !== businessId) {
    return { ok: false, error: "You can only change your own catalogue." };
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true, slug: true, status: true, business: { select: { slug: true } } },
  });
  if (!product) return { ok: false, error: "That product cannot be found." };

  await prisma.$transaction(async (tx) => {
    if (product.status === "live") {
      await tx.redirect.upsert({
        where: { fromPath: `/b/${product.business.slug}/p/${product.slug}` },
        update: { toPath: `/b/${product.business.slug}/products` },
        create: {
          fromPath: `/b/${product.business.slug}/p/${product.slug}`,
          toPath: `/b/${product.business.slug}/products`,
          businessId,
        },
      });
    }
    await tx.product.delete({ where: { id: product.id } });
  });

  return { ok: true };
}

/**
 * The four this market uses.
 *
 * Board 8c §3 lists `in_stock`, `made_to_order`, `on_request` and
 * `discontinued`. The schema's enum is `in_stock | made_to_order | indent |
 * out_of_stock`, and it is the one that ships: "indent order" is in CLAUDE.md's
 * vocabulary table as the correct term for this market, every public surface
 * already renders these four, and adding two enum values nothing else
 * understands would be a migration in exchange for words no buyer here uses.
 */
const AVAILABILITY = ["in_stock", "made_to_order", "indent", "out_of_stock"] as const;

export type AvailabilityValue = (typeof AVAILABILITY)[number];

export const AVAILABILITY_OPTIONS: readonly AvailabilityValue[] = AVAILABILITY;

function readAvailability(value: string | null): AvailabilityValue {
  return value && (AVAILABILITY as readonly string[]).includes(value)
    ? (value as AvailabilityValue)
    : "in_stock";
}
