import "server-only";
import { prisma } from "@/lib/db/client";
import { readingMinutes } from "@/lib/guides/blocks";
import type { LandingScope } from "./scope";

/**
 * Board 6a §5, the second rail card — READ NEXT.
 *
 * *"3 items: title, mono kicker below (`CURATED LIST`, `GUIDE · 6 MIN`). `6b`
 * lists and `6d` guides that name this scope."*
 *
 * Derived, not curated, and that is the difference between this card and the
 * one above it. RELATED SEARCHES is five links somebody chose because they know
 * what a buyer on this page asks next; this is the editorial we have already
 * written **about this scope**, and "names this scope" is a fact about the
 * record rather than a judgement — a curated list carries its trade and
 * optionally its area, and a guide carries the trade it sends the reader to.
 *
 * Published only. Every other link block on this template refuses to point at
 * an unpublished page and this one is a recommendation, which makes it the
 * worst place to make an exception.
 */

export type ReadNextKind = "curated_list" | "guide";

export interface ReadNextItem {
  kind: ReadNextKind;
  href: string;
  title: string;
  /** Minutes, for the `GUIDE · 6 MIN` kicker. Absent on a list. */
  minutes?: number;
}

const LIMIT = 3;

export async function readNext(scope: LandingScope): Promise<ReadNextItem[]> {
  const sectorId = scope.category.parentId ?? scope.category.id;

  const [lists, guides] = await Promise.all([
    prisma.curatedList.findMany({
      where: {
        publishedAt: { not: null },
        categoryId: { in: scope.categoryIds },
        /*
           A list about this area first, then a list about the trade anywhere.
           A list scoped to a *different* area is about somewhere else and is
           not what a reader of this page wants next.
        */
        ...(scope.area ? { OR: [{ areaId: scope.area.id }, { areaId: null }] } : { areaId: null }),
      },
      orderBy: [{ areaId: { sort: "desc", nulls: "last" } }, { publishedAt: "desc" }],
      take: LIMIT,
      select: { slug: true, title: true },
    }),
    prisma.guide.findMany({
      where: {
        publishedAt: { not: null },
        // The trade the article sends the reader to. A guide with no trade is
        // about the platform rather than about this page's subject.
        ctaCategoryId: { in: [...scope.categoryIds, sectorId] },
      },
      orderBy: { publishedAt: "desc" },
      take: LIMIT,
      select: { slug: true, title: true, body: true },
    }),
  ]);

  const items: ReadNextItem[] = [
    ...lists.map((list) => ({
      kind: "curated_list" as const,
      href: `/best/${list.slug}`,
      title: list.title,
    })),
    ...guides.map((guide) => ({
      kind: "guide" as const,
      href: `/guides/${guide.slug}`,
      title: guide.title,
      minutes: readingMinutes(guide.body),
    })),
  ];

  /*
     Three, and fewer where there are fewer. The card is not padded out with a
     guide about something else to make it look full — a rail card with one
     honest item is the cold-start state, and it is a designed one.
  */
  return items.slice(0, LIMIT);
}
