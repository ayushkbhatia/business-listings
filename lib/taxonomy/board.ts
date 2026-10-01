import "server-only";
import { prisma } from "@/lib/db/client";
import type { Prisma, PrismaClient } from "@/lib/db/generated/client";
import type { TradeKind } from "@/lib/db/generated/enums";
import { PAYING_WHERE } from "@/lib/accounts/health-where";
import { readHomeSectors } from "@/lib/db/queries/home";
import { resolveTemplateId } from "@/lib/spec/resolve";
import { loadTradeKinds } from "./service";
import { tradeKindOrigin } from "./trade-kind";
import { buildTree, sectorOf, type TaxonomyTree, type TreeNode } from "./tree-model";
import { LISTED } from "./listed";

/**
 * Board 4d — what `/admin/categories` reads.
 *
 * Two loaders: the tree, which is the whole taxonomy with a count on every row,
 * and the editor, which is one category with the figures that say whether it
 * earns its page. The editor's listing figure is read off the tree rather than
 * counted again, so the row a person clicked and the panel beside it cannot
 * disagree about the same number.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Who counts as a listing on this screen: published and not suspended.
 *
 * The population `1a`'s hero counts (`readHomeStats`) and `6c` counts
 * (`categoryIndex`). Q1 on this board is that two public surfaces published
 * totals that did not add up — the defence is that every surface counts one
 * population, and `tests/integration/taxonomy-board.test.ts` holds this total
 * equal to the hero's. Defined in `./listed.ts` since board `4a` and `4f`'s
 * `status=live` filter read it too.
 */
export { LISTED };

/** Every category and every public listing, as one tree. */
export async function loadTaxonomyTree(db: Db = prisma): Promise<TaxonomyTree> {
  const [rows, counts] = await Promise.all([
    db.category.findMany({
      select: {
        id: true,
        parentId: true,
        name: true,
        nameAr: true,
        slug: true,
        code: true,
        sortOrder: true,
        synonyms: true,
        showInIndex: true,
        acceptsRfq: true,
        requiresExtraCheck: true,
      },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    db.business.groupBy({
      by: ["primaryCategoryId"],
      where: LISTED,
      _count: { _all: true },
      orderBy: { primaryCategoryId: "asc" },
    }),
  ]);
  return buildTree(rows, new Map(counts.map((row) => [row.primaryCategoryId, row._count._all])));
}

/** A node and every id beneath it. */
export function subtreeIds(node: TreeNode): string[] {
  const out: string[] = [];
  const walk = (current: TreeNode) => {
    out.push(current.id);
    current.children.forEach(walk);
  };
  walk(node);
  return out;
}

export function findNode(tree: TaxonomyTree, id: string): TreeNode | null {
  const stack = [...tree.sectors];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.id === id) return node;
    stack.push(...node.children);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The editor
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateOrigin = "own" | "sector" | "serving" | "none";

export type IndexState =
  /** Listed on `/categories`. */
  | "listed"
  /** Its own switch is off. */
  | "switched_off"
  /** A subcategory whose sector is held out, so it has nowhere to be listed. */
  | "sector_hidden"
  /** A sector with no public listings — computed, never stored. */
  | "no_listings";

export interface CategoryEditor {
  id: string;
  name: string;
  nameAr: string | null;
  slug: string;
  code: string;
  isSector: boolean;
  parent: { id: string; name: string; slug: string; requiresExtraCheck: boolean } | null;
  childCount: number;
  synonyms: string[];
  /** Other categories carrying one of this category's synonyms, by term. */
  sharedSynonyms: { term: string; categories: string[] }[];
  showInIndex: boolean;
  acceptsRfq: boolean;
  requiresExtraCheck: boolean;
  /** What `/categories` does with it, and why. */
  index: IndexState;
  /**
   * Whether the directory home's category rail is showing it right now.
   *
   * Asked of the rail's own reader, never recomputed here: that rail belongs to
   * `6h`, and whatever rule it applies today is the rule this answers with.
   * Null on a subcategory — the rail is sectors.
   */
  onHomeGrid: boolean | null;
  trade: {
    kind: TradeKind;
    from: "own" | "inherited" | "default";
    ancestorName: string | null;
  };
  /** Templates that serve this category, any status. The default is picked from these. */
  templates: { id: string; name: string; version: number; status: string }[];
  defaultTemplateId: string | null;
  /** What a product form in this category actually resolves to, and where that came from. */
  resolvedTemplate: { id: string; name: string; version: number; origin: TemplateOrigin } | null;
  demand: {
    listings: number;
    /** Published products — or live services, where the trade is sold by the job. */
    offerings: number;
    rfqsPerMonth: number;
    paidSellers: number;
  };
  lastChange: { by: string; at: Date; action: string } | null;
  synonymsChanged: { by: string; at: Date } | null;
}

const DAY_MS = 86_400_000;
/** "RFQs / month" is the last thirty days, not the calendar month so far. */
export const RFQ_WINDOW_DAYS = 30;

/**
 * The RFQs that belong to a set of categories, over a window.
 *
 * An RFQ belongs to a category when it reached a listing filed there, or when
 * it was a service brief written for the trade. An enquiry carries no category
 * of its own, so this is the measured answer rather than a guess at what the
 * buyer meant — and a buyer who sent one RFQ to six suppliers here sent one
 * RFQ, not six.
 *
 * One predicate for the editor's *RFQs / month* and board `4a`'s category
 * health, which links each sector's figure to this editor: the two are the same
 * count over the same thirty days when the overview is on the month in
 * progress.
 */
export function rfqWhere(categoryIds: readonly string[], since: Date, until: Date): Prisma.EnquiryWhereInput {
  return {
    createdAt: { gte: since, lt: until },
    OR: [
      { recipients: { some: { business: { primaryCategoryId: { in: [...categoryIds] } } } } },
      { serviceBrief: { is: { categoryId: { in: [...categoryIds] } } } },
    ],
  };
}

export function rfqCount(categoryIds: readonly string[], since: Date, until: Date, db: Db = prisma): Promise<number> {
  return db.enquiry.count({ where: rfqWhere(categoryIds, since, until) });
}

/** The thirty days the editor's figure covers, ending at `until`. */
export function rfqWindow(until: Date): { since: Date; until: Date } {
  return { since: new Date(until.getTime() - RFQ_WINDOW_DAYS * DAY_MS), until };
}

/**
 * Listings published in a window — board 4a's *+N published* under *Listings
 * live*, the flow beside this board's stock.
 *
 * Read off `publishedAt`, which a later unpublish clears (a merge or a closure
 * nulls it in the same transaction). So a listing published in a month and
 * merged away since is not counted in that month: the figure is what this
 * month's publications amount to today, and the overview's caption says so.
 */
export function publishedBetween(from: Date, to: Date, db: Db = prisma): Promise<number> {
  return db.business.count({ where: { publishedAt: { gte: from, lt: to } } });
}

// ─────────────────────────────────────────────────────────────────────────────
// Sector health — board 4a reads it
// ─────────────────────────────────────────────────────────────────────────────

export interface SectorHealth {
  id: string;
  name: string;
  /** The tree's rolled-up count — what this board's row shows. */
  listings: number;
  /** Of those, the claimed ones: the supply that can answer an RFQ. */
  claimed: number;
  /** RFQs over the thirty days ending at `until`. */
  rfqs: number;
}

/**
 * Every sector with the three figures board 4a's category table states.
 *
 * Listings come off the tree, so a sector's row there and its row here are one
 * number. Claimed listings roll up by the same rule the tree uses — filed under
 * the sector or anywhere beneath it — so the share is of the same population.
 * B7 on board 4a: sectors only, at one level, and never a subcategory among
 * them.
 */
export async function sectorHealth(tree: TaxonomyTree, until: Date, db: Db = prisma): Promise<SectorHealth[]> {
  const window = rfqWindow(until);
  const stocks = await sectorStocks(tree, db);
  return Promise.all(
    stocks.map(async (stock) => {
      const sector = tree.sectors.find((candidate) => candidate.id === stock.id)!;
      return { ...stock, rfqs: await rfqCount(subtreeIds(sector), window.since, window.until, db) };
    }),
  );
}

/**
 * The two stocks of `sectorHealth` without the RFQs: what a sector holds now.
 * Board 4a reads these live and the RFQs once per month, because the month's
 * demand is a figure for the period and the supply is a figure for today.
 */
export async function sectorStocks(tree: TaxonomyTree, db: Db = prisma): Promise<Omit<SectorHealth, "rfqs">[]> {
  const claimedRows = await db.business.groupBy({
    by: ["primaryCategoryId"],
    where: { ...LISTED, claimStatus: "claimed" },
    _count: { _all: true },
    orderBy: { primaryCategoryId: "asc" },
  });
  const claimedBy = new Map(claimedRows.map((row) => [row.primaryCategoryId, row._count._all]));
  return tree.sectors.map((sector) => ({
    id: sector.id,
    name: sector.name,
    listings: sector.listings,
    claimed: subtreeIds(sector).reduce((sum, id) => sum + (claimedBy.get(id) ?? 0), 0),
  }));
}

export async function loadCategoryEditor(
  tree: TaxonomyTree,
  categoryId: string,
  now: Date = new Date(),
): Promise<CategoryEditor | null> {
  const node = findNode(tree, categoryId);
  if (!node) return null;

  const ids = subtreeIds(node);
  const since = new Date(now.getTime() - RFQ_WINDOW_DAYS * DAY_MS);

  const [row, links, kinds, homeSectors, overlap, audit] = await Promise.all([
    prisma.category.findUnique({
      where: { id: categoryId },
      select: {
        defaultTemplateId: true,
        parent: { select: { id: true, name: true, slug: true, requiresExtraCheck: true, defaultTemplateId: true } },
      },
    }),
    prisma.specTemplateCategory.findMany({
      where: { categoryId },
      select: { template: { select: { id: true, name: true, version: true, status: true } } },
      orderBy: [{ templateId: "asc" }],
    }),
    loadTradeKinds(),
    node.parentId === null ? readHomeSectors() : Promise.resolve(null),
    node.synonyms.length
      ? prisma.category.findMany({
          where: { id: { not: categoryId }, synonyms: { hasSome: [...node.synonyms] } },
          select: { name: true, synonyms: true },
          orderBy: [{ name: "asc" }, { id: "asc" }],
        })
      : Promise.resolve([]),
    prisma.auditEvent.findMany({
      where: { subject: `Category:${categoryId}` },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: { action: true, createdAt: true, after: true, actor: { select: { fullName: true, email: true } } },
    }),
  ]);
  if (!row) return null;

  const trade = tradeKindOrigin(kinds, categoryId);

  const [offerings, rfqsPerMonth, paidSellers, resolvedId] = await Promise.all([
    trade.kind === "services"
      ? prisma.service.count({ where: { categoryId: { in: ids }, status: "live", business: LISTED } })
      : prisma.product.count({ where: { categoryId: { in: ids }, status: { not: "draft" }, business: LISTED } }),
    rfqCount(ids, since, now),
    // `4f`'s paying definition, over the same listings the figure beside it counts.
    prisma.business.count({ where: { AND: [LISTED, PAYING_WHERE, { primaryCategoryId: { in: ids } }] } }),
    resolveTemplateId(prisma, categoryId),
  ]);

  const templates = links.map((link) => link.template);
  const resolvedRow =
    resolvedId === null
      ? null
      : (templates.find((template) => template.id === resolvedId) ??
        (await prisma.specTemplate.findUnique({
          where: { id: resolvedId },
          select: { id: true, name: true, version: true },
        })));
  // The resolver's own three steps, named: this category's default, its
  // sector's, or whichever live template serves either.
  const origin: TemplateOrigin =
    resolvedId === null
      ? "none"
      : row.defaultTemplateId === resolvedId
        ? "own"
        : row.defaultTemplateId === null && row.parent?.defaultTemplateId === resolvedId
          ? "sector"
          : "serving";

  const sector = sectorOf(tree, categoryId);
  const index: IndexState = !node.showInIndex
    ? "switched_off"
    : node.parentId === null
      ? node.listings > 0
        ? "listed"
        : "no_listings"
      : sector && (!sector.showInIndex || sector.listings === 0)
        ? "sector_hidden"
        : "listed";

  const shared = new Map<string, string[]>();
  for (const other of overlap) {
    for (const term of other.synonyms) {
      if (!node.synonyms.includes(term)) continue;
      const names = shared.get(term);
      if (names) names.push(other.name);
      else shared.set(term, [other.name]);
    }
  }

  const who = (actor: { fullName: string | null; email: string | null }) => actor.fullName ?? actor.email ?? "—";
  const latest = audit[0];
  const synonymEvent = audit.find((event) => {
    const after = event.after as Record<string, unknown> | null;
    return after !== null && typeof after === "object" && "synonyms" in after;
  });

  return {
    id: node.id,
    name: node.name,
    nameAr: node.nameAr,
    slug: node.slug,
    code: node.code,
    isSector: node.parentId === null,
    parent: row.parent
      ? { id: row.parent.id, name: row.parent.name, slug: row.parent.slug, requiresExtraCheck: row.parent.requiresExtraCheck }
      : null,
    childCount: node.children.length,
    synonyms: [...node.synonyms],
    sharedSynonyms: node.synonyms
      .filter((term) => shared.has(term))
      .map((term) => ({ term, categories: shared.get(term)! })),
    showInIndex: node.showInIndex,
    acceptsRfq: node.acceptsRfq,
    requiresExtraCheck: node.requiresExtraCheck,
    index,
    onHomeGrid: homeSectors === null ? null : homeSectors.some((entry) => entry.id === categoryId),
    trade: {
      kind: trade.kind,
      from: trade.from,
      ancestorName: trade.from === "inherited" ? (findNode(tree, trade.ancestorId)?.name ?? null) : null,
    },
    templates,
    defaultTemplateId: row.defaultTemplateId,
    resolvedTemplate: resolvedRow
      ? { id: resolvedRow.id, name: resolvedRow.name, version: resolvedRow.version, origin }
      : null,
    demand: { listings: node.listings, offerings, rfqsPerMonth, paidSellers },
    lastChange: latest ? { by: who(latest.actor), at: latest.createdAt, action: latest.action } : null,
    synonymsChanged: synonymEvent ? { by: who(synonymEvent.actor), at: synonymEvent.createdAt } : null,
  };
}

/** The categories a merge or an add can name, as options grouped by sector. */
export function categoryOptions(tree: TaxonomyTree): {
  sectors: { id: string; name: string; listings: number }[];
  groups: { sectorId: string; sector: string; options: { id: string; name: string; listings: number }[] }[];
} {
  return {
    sectors: tree.sectors.map((sector) => ({ id: sector.id, name: sector.name, listings: sector.listings })),
    groups: tree.sectors.map((sector) => ({
      sectorId: sector.id,
      sector: sector.name,
      options: [...sector.children]
        .sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((child) => ({ id: child.id, name: child.name, listings: child.listings })),
    })),
  };
}
