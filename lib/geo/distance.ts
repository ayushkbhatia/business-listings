/**
 * Distance between two points, and the seven places a UAE search starts from.
 *
 * Board 1c's sort strip names its own origin — `SORTED BY DISTANCE FROM AL
 * QUOZ` — which means the origin has to be a thing the page can name, not an
 * implicit centre. That rules out the obvious shortcut of scoring distance from
 * wherever the first result happens to be.
 *
 * ## Where the origin comes from, and where it does not
 *
 * From the buyer's own filters: the area they narrowed to, or failing that the
 * centre of the emirate. Never from the browser's geolocation API. That is a
 * decision rather than an omission — a public directory that asks for a
 * device's position on first search is asking for a permission it has not
 * earned, and the answer would be a client-only signal that neither a crawler
 * nor a buyer with JavaScript off would produce. A buyer who wants distance
 * from where they are standing narrows to their area, which they were going to
 * do anyway.
 *
 * The consequence is honest and worth stating: with no area and no emirate
 * filter there is no origin, distance scores as unknown, and the sort strip
 * says something else. That is `scoreDistance`'s existing half-credit path, and
 * it is why the weight was designed to tolerate a null in the first place.
 */

export interface Point {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * Haversine rather than a projected approximation: the UAE spans about four
 * degrees, where the flat-earth shortcut is fine, but this is also what a
 * service-radius check would use and that one crosses borders. One formula,
 * correct everywhere, is cheaper than two and a note about when each applies.
 */
export function haversineKm(from: Point, to: Point): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The centre of each emirate, for when a buyer has named one but no area.
 *
 * These are the main population centres rather than the geometric centroids of
 * the territories. Abu Dhabi's landmass reaches most of the way to Saudi
 * Arabia and its geometric middle is empty desert; sorting "distance from Abu
 * Dhabi" against that point would rank a Mussafah supplier as far away, which
 * is the opposite of what a buyer means by the word.
 */
export const EMIRATE_CENTRES: Readonly<Record<string, Point>> = {
  dubai: { lat: 25.2048, lng: 55.2708 },
  abu_dhabi: { lat: 24.4539, lng: 54.3773 },
  sharjah: { lat: 25.3463, lng: 55.4209 },
  ajman: { lat: 25.4052, lng: 55.5136 },
  ras_al_khaimah: { lat: 25.7895, lng: 55.9432 },
  fujairah: { lat: 25.1288, lng: 56.3265 },
  umm_al_quwain: { lat: 25.5647, lng: 55.5532 },
};

/**
 * The nearest of a supplier's pinned locations to the origin.
 *
 * A location with no coordinates is skipped rather than approximated, which is
 * the same rule the map runs on and for the same reason — board 1c criterion 4.
 * A supplier whose every branch is unpinned has no distance at all, and scores
 * as unknown rather than as far away: not knowing where somebody is must never
 * read as evidence that they are inconvenient.
 */
export function nearestKm(
  origin: Point | null,
  locations: readonly { lat: number | null; lng: number | null }[],
): number | null {
  if (!origin) return null;

  let nearest: number | null = null;
  for (const location of locations) {
    if (location.lat === null || location.lng === null) continue;
    const km = haversineKm(origin, { lat: location.lat, lng: location.lng });
    if (nearest === null || km < nearest) nearest = km;
  }
  return nearest;
}
