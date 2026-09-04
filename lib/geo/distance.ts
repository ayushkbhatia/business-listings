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

/**
 * A circle of `km` around a point, as GeoJSON polygon coordinates.
 *
 * Drawn as a polygon rather than as a map library's `circle` layer, because a
 * circle layer's radius is in screen pixels and would grow and shrink with the
 * zoom — a 40 km promise that changes size as the reader zooms is not a promise
 * about distance at all.
 *
 * The latitude correction matters at this one: a degree of longitude in the UAE
 * is about 0.9 of a degree of latitude, and skipping it draws an ellipse that
 * overstates the reach east and west. 64 points is enough that the edge reads as
 * curved at any zoom a map here reaches.
 *
 * Shared by the storefront's coverage rings and board 2d's radius editor, so the
 * shape a seller sets is the same shape a buyer is shown.
 */
export function circlePolygon(
  centre: Point,
  km: number,
  points = 64,
): [number, number][] {
  const ring: [number, number][] = [];
  const latDegrees = km / 110.574;
  const lngDegrees = km / (111.32 * Math.cos(toRadians(centre.lat)));
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * 2 * Math.PI;
    ring.push([
      centre.lng + lngDegrees * Math.cos(angle),
      centre.lat + latDegrees * Math.sin(angle),
    ]);
  }
  return ring;
}

/**
 * The bounding box of a circle, for fitting a map to it.
 *
 * Board 2d, criterion 12: the radius editor zooms the map out to fit the circle
 * and draws it there, because at street zoom a 40 km circle is several screens
 * wide and would be a shape with no visible edge. The corners come off the same
 * degree conversion the polygon uses, so what is drawn is what is framed.
 */
export function circleBounds(
  centre: Point,
  km: number,
): { west: number; south: number; east: number; north: number } {
  const latDegrees = km / 110.574;
  const lngDegrees = km / (111.32 * Math.cos(toRadians(centre.lat)));
  return {
    west: centre.lng - lngDegrees,
    south: centre.lat - latDegrees,
    east: centre.lng + lngDegrees,
    north: centre.lat + latDegrees,
  };
}
