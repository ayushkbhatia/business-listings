import "server-only";
import { prisma } from "@/lib/db/client";
import { sectorLabel, sectorSlug } from "./service-profile";

/**
 * Board `2c-s` B2 — the sector suggestion index.
 *
 * The chips on the profile step are **the most-picked sectors within the
 * seller's own categories**, not a global top twelve and not a curated list. A
 * tax practice is offered free-zone entities and family offices; a valve trader
 * is offered contracting and marine. No single list does both, which is why
 * there is an index rather than a constant.
 *
 * A sector a seller types joins the index on the next run and may become a chip
 * for the next seller. The list writes itself from what sellers say.
 *
 * ## The cold start is a designed state
 *
 * On a directory where nobody has filled this in, the index is **empty** — and
 * that is the honest answer, not a bug. The screen renders no chip row and says
 * why, rather than padding with a list we invented. Seeding it with a plausible
 * twelve would be exactly the curated list the board rejects, and it would look
 * like data.
 */

/** How many chips the profile step offers. Twelve, per the board. */
export const SECTOR_CHIPS = 12;

export interface SectorChip {
  label: string;
  pickedBy: number;
}

/**
 * The chips for one seller, from the categories they actually hold.
 *
 * Ordered by how many sellers picked each, then alphabetically so two sectors
 * on the same count do not swap places between loads.
 */
export async function sectorChipsFor(categoryIds: readonly string[]): Promise<SectorChip[]> {
  if (categoryIds.length === 0) return [];

  const rows = await prisma.sectorSuggestion.findMany({
    where: { categoryId: { in: [...categoryIds] } },
    select: { slug: true, label: true, pickedBy: true },
  });

  /*
     Summed across the seller's categories rather than taken from one.

     A business in three categories should be offered what sellers in all three
     picked, and a sector common to two of them should outrank one that is
     strong in a single category. Keyed on the slug so two spellings of one
     sector are one chip.
  */
  const merged = new Map<string, SectorChip>();
  for (const row of rows) {
    const held = merged.get(row.slug);
    if (held) held.pickedBy += row.pickedBy;
    else merged.set(row.slug, { label: row.label, pickedBy: row.pickedBy });
  }

  return [...merged.values()]
    .sort((a, b) => b.pickedBy - a.pickedBy || a.label.localeCompare(b.label))
    .slice(0, SECTOR_CHIPS);
}

/**
 * Search the index, plus whatever the seller is typing.
 *
 * Returns matches ordered by popularity. The caller offers the raw query as a
 * new sector when nothing matches it exactly — the board's rule that a sector
 * we have never listed can be added, with the exact string echoed back.
 */
export async function searchSectors(query: string, limit = 20): Promise<SectorChip[]> {
  const term = sectorSlug(query);
  if (term.length === 0) return [];

  const rows = await prisma.sectorSuggestion.findMany({
    where: { slug: { contains: term } },
    orderBy: [{ pickedBy: "desc" }, { slug: "asc" }],
    take: limit * 3,
    select: { slug: true, label: true, pickedBy: true },
  });

  const merged = new Map<string, SectorChip>();
  for (const row of rows) {
    const held = merged.get(row.slug);
    if (held) held.pickedBy += row.pickedBy;
    else merged.set(row.slug, { label: row.label, pickedBy: row.pickedBy });
  }

  return [...merged.values()]
    .sort((a, b) => b.pickedBy - a.pickedBy || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export interface RebuildResult {
  /** Rows written. */
  rows: number;
  /** Distinct sectors seen across the directory. */
  sectors: number;
  /** Businesses that had anything to contribute. */
  businesses: number;
}

/**
 * Recompute the whole index — B2's nightly job.
 *
 * Whole rather than incremental, and deliberately: it is a few thousand rows of
 * arithmetic over a table the directory already fits in memory, and an
 * incremental version would need to know when a seller *removed* a sector,
 * which is a second thing to get wrong. Replaced inside one transaction, so a
 * reader never sees a half-built index.
 *
 * The label kept for a sector is the spelling **most sellers used**, not the
 * first or the newest — the chip should read the way the trade writes it.
 */
export async function rebuildSectorIndex(): Promise<RebuildResult> {
  const businesses = await prisma.business.findMany({
    where: {
      sectorsServed: { isEmpty: false },
      publishedAt: { not: null },
      suspendedAt: null,
    },
    select: {
      sectorsServed: true,
      primaryCategoryId: true,
      categories: { select: { categoryId: true } },
    },
  });

  // categoryId -> slug -> { labels seen, how many sellers }
  const index = new Map<string, Map<string, { labels: Map<string, number>; pickedBy: number }>>();

  for (const business of businesses) {
    const categoryIds = [
      ...new Set([business.primaryCategoryId, ...business.categories.map((c) => c.categoryId)]),
    ];
    for (const categoryId of categoryIds) {
      const perCategory = index.get(categoryId) ?? new Map();
      index.set(categoryId, perCategory);

      // Deduplicated per business, so one seller listing a sector twice does
      // not count twice — the figure is "how many sellers", not "how many rows".
      for (const slug of new Set(business.sectorsServed.map(sectorSlug))) {
        if (!slug) continue;
        const entry = perCategory.get(slug) ?? { labels: new Map<string, number>(), pickedBy: 0 };
        entry.pickedBy += 1;

        const typed = business.sectorsServed.find((value) => sectorSlug(value) === slug);
        if (typed) {
          const label = sectorLabel(typed);
          entry.labels.set(label, (entry.labels.get(label) ?? 0) + 1);
        }
        perCategory.set(slug, entry);
      }
    }
  }

  const rows: { categoryId: string; slug: string; label: string; pickedBy: number }[] = [];
  const distinct = new Set<string>();
  for (const [categoryId, perCategory] of index) {
    for (const [slug, entry] of perCategory) {
      distinct.add(slug);
      // The spelling most sellers used; the slug itself if somehow none.
      const label =
        [...entry.labels.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
        slug;
      rows.push({ categoryId, slug, label, pickedBy: entry.pickedBy });
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.sectorSuggestion.deleteMany({});
    if (rows.length > 0) await tx.sectorSuggestion.createMany({ data: rows });
  });

  return { rows: rows.length, sectors: distinct.size, businesses: businesses.length };
}
