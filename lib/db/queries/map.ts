import "server-only";
import { prisma } from "@/lib/db/client";
import { businessWhere } from "./search";
import type { MapBounds, SearchQuery } from "@/lib/search/query";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * The pins, as their own query.
 *
 * Board 1c is explicit that this is separate from the list: *"map query is
 * bounds-scoped and separate from the list query, so panning does not re-rank
 * the list unless 'Search this area' is pressed."* One query serving both would
 * make every pan a re-rank, which is the behaviour that makes a map feel like
 * it is fighting the reader.
 *
 * ## The rule this file exists to keep
 *
 * Criterion 4: **a location with `lat = null` is excluded from the map
 * entirely.** Never approximated to an area centroid, never dropped at the
 * emirate centre. It is filtered out in the `where`, not in the render, so
 * there is no code path that could place one.
 *
 * It is still counted. `excluded` is how many published locations matched the
 * search and had no coordinates, and the surface above says so — a map quietly
 * showing eleven of nineteen suppliers is a map that is lying by omission, and
 * board 3c already surfaces the gap to the seller so they can fix it.
 */

export interface MapPinRow {
  /** The business, not the location: clicking a pin selects a result row. */
  id: string;
  locationId: string;
  lat: number;
  lng: number;
  label: string;
  kind: "head_office" | "verified" | "unverified";
  slug: string;
}

export interface MapPins {
  pins: MapPinRow[];
  /** Published locations in the result set with no coordinates. */
  excluded: number;
  /** True when the cap trimmed the set, so the surface can say so. */
  capped: boolean;
}

/**
 * The board's number. Past this the map is a smear of overlapping pins and the
 * payload is measured in hundreds of kilobytes; clustering handles the display,
 * the cap handles the transfer.
 */
export const MAX_PINS = 200;

function withinBounds(bounds: MapBounds) {
  return {
    lat: { gte: bounds.south, lte: bounds.north },
    lng: { gte: bounds.west, lte: bounds.east },
  };
}

export async function getMapPins(
  query: SearchQuery,
  categoryIds?: string[],
): Promise<MapPins> {
  const where = businessWhere(query, categoryIds);

  /*
     Coordinates are required here and nowhere else in the search.

     `lat: { not: null }` is criterion 4 expressed as a predicate. A row without
     one cannot reach the client, so no later refactor can accidentally place it
     — which is the failure mode this rule exists to prevent, and the reason it
     is not a `.filter()` in the component.
  */
  const pinned = {
    published: true,
    lat: { not: null },
    lng: { not: null },
    ...(query.bounds ? withinBounds(query.bounds) : {}),
  } as const;

  const [businesses, excluded] = await Promise.all([
    prisma.business.findMany({
      where: { AND: [where, { locations: { some: pinned } }] },
      select: {
        id: true,
        slug: true,
        displayName: true,
        verificationTier: true,
        claimStatus: true,
        locations: {
          where: pinned,
          select: { id: true, lat: true, lng: true, type: true },
        },
      },
      take: MAX_PINS,
    }),
    /*
       The gap, counted rather than hidden. Bounds are deliberately not applied:
       a location with no coordinates cannot be inside or outside a box, and
       excluding it from the count on that basis would make the number drop as
       the buyer zoomed in, which reads as pins disappearing.
    */
    prisma.location.count({
      where: { published: true, lat: null, business: where },
    }),
  ]);

  const pins: MapPinRow[] = [];
  for (const business of businesses) {
    for (const location of business.locations) {
      // Narrowing only. The `where` already guarantees both are present.
      if (location.lat === null || location.lng === null) continue;
      pins.push({
        id: business.id,
        locationId: location.id,
        lat: location.lat,
        lng: location.lng,
        label: business.displayName,
        slug: business.slug,
        kind:
          location.type === "head_office" && business.verificationTier >= VERIFIED_TIER
            ? "head_office"
            : business.verificationTier >= VERIFIED_TIER
              ? "verified"
              : "unverified",
      });
    }
  }

  return { pins, excluded, capped: businesses.length >= MAX_PINS };
}

/**
 * Free-zone areas, for the overlay.
 *
 * Points, not polygons, because points are what the database holds. `Area` has
 * a centroid and an `isFreeZone` flag; there is no boundary geometry anywhere
 * in the schema, and inventing one would draw a shape that claims to say where
 * Jebel Ali Free Zone ends. The overlay is therefore a shaded mark per zone
 * rather than a filled boundary, and the legend says "areas" rather than
 * implying an outline. Real boundaries are a data acquisition, not a render.
 */
export async function getFreeZoneMarks(): Promise<
  { id: string; name: string; lat: number; lng: number }[]
> {
  const areas = await prisma.area.findMany({
    where: { isFreeZone: true, lat: { not: null }, lng: { not: null } },
    select: { id: true, name: true, lat: true, lng: true },
  });
  return areas.map((area) => ({
    id: area.id,
    name: area.name,
    lat: area.lat!,
    lng: area.lng!,
  }));
}
