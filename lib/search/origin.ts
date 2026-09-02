import "server-only";
import { prisma } from "@/lib/db/client";
import { EMIRATE_CENTRES, type Point } from "@/lib/geo/distance";
import { isCode } from "./index-text";
import type { SearchQuery } from "./query";
import type { RankingWeights } from "./ranking";

/**
 * Where a search measures distance from, and how much distance should matter.
 *
 * Two things the board treats as one, because they answer together: the sort
 * strip says `SORTED BY DISTANCE FROM AL QUOZ`, and it is only allowed to say
 * that when distance actually moved the order.
 */

export interface SortOrigin extends Point {
  /** What the strip prints. Already the buyer's own words for the place. */
  label: string;
}

/**
 * The origin, from the buyer's filters alone.
 *
 * Area first — it is the more specific thing they said — then the emirate's
 * centre. An area with no coordinates falls through to its emirate rather than
 * returning nothing, because the buyer did narrow to somewhere and the emirate
 * is a true if blunter answer.
 */
export async function resolveOrigin(query: SearchQuery): Promise<SortOrigin | null> {
  if (query.area) {
    const area = await prisma.area.findUnique({
      where: { slug: query.area },
      select: { name: true, lat: true, lng: true, emirate: true },
    });
    if (area?.lat != null && area.lng != null) {
      return { lat: area.lat, lng: area.lng, label: area.name };
    }
    // Unpinned area, known emirate. Fall through to it below.
    if (area) {
      const centre = EMIRATE_CENTRES[area.emirate as string];
      if (centre) return { ...centre, label: emirateLabel(area.emirate as string) };
    }
  }

  if (query.emirate) {
    const centre = EMIRATE_CENTRES[query.emirate];
    if (centre) return { ...centre, label: emirateLabel(query.emirate) };
  }

  // No area, no emirate, no origin. Distance scores as unknown, which is the
  // honest reading of "we have not been told where the buyer is".
  return null;
}

/** `abu_dhabi` → `Abu Dhabi`. The strip prints a place, not an enum. */
function emirateLabel(emirate: string): string {
  return emirate
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * What kind of question the query is asking.
 *
 * The board is explicit that these should not weigh distance equally:
 *
 *   - `sku` — an exact part number. The buyer wants *that part*, and the
 *     supplier who has it is worth a drive. Distance drops to 4.
 *   - `spec` — a specification or product term. The default balance.
 *   - `service` — no product signal at all, `AMC contractor` being the board's
 *     own example. Somebody who will come to the site, so being nearby is much
 *     of the point. Distance rises to 14.
 */
export type QueryShape = "sku" | "spec" | "service";

export interface ShapedRanking {
  shape: QueryShape;
  weights: RankingWeights;
}

/**
 * Read the shape of a query against the catalogue.
 *
 * An exact SKU is checked first and short-circuits: it is the cheapest query
 * here and the most decisive answer. Only the code-shaped tokens are tried,
 * because `isCode` is what tells a part number from a word and asking the
 * database whether `contractor` is somebody's SKU is a round trip to learn
 * nothing.
 */
export async function shapeOf(query: SearchQuery): Promise<QueryShape> {
  const words = query.q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  if (words.length === 0) return "spec";

  const codes = words.filter(isCode);
  if (codes.length > 0) {
    const exact = await prisma.product.count({
      where: { sku: { in: codes, mode: "insensitive" }, status: { not: "draft" } },
    });
    if (exact > 0) return "sku";
  }

  /*
     Does anything in the catalogue answer this at all?

     A query that no product matches is a query about a service — `AMC
     contractor`, `PRO services` — and those are the searches where being in the
     same emirate is most of the answer. Counting rather than fetching: the
     shape needs a yes or no, not the rows.
  */
  const productHits = await prisma.product.count({
    where: {
      status: { not: "draft" },
      AND: words.map((word) => ({
        searchText: { contains: isCode(word) ? ` ${word} ` : word, mode: "insensitive" as const },
      })),
    },
  });

  return productHits > 0 ? "spec" : "service";
}

/**
 * The stored weights with distance moved to suit the query.
 *
 * Only distance moves. The other five are what staff set in the admin editor,
 * and a search that quietly rewrote three of them would make that screen a
 * suggestion rather than a setting.
 */
export function weightsForShape(weights: RankingWeights, shape: QueryShape): RankingWeights {
  if (shape === "sku") return { ...weights, distance: 4 };
  if (shape === "service") return { ...weights, distance: 14 };
  return weights;
}
