import { describe, expect, it } from "vitest";
import { EMIRATE_CENTRES, haversineKm, nearestKm } from "./distance";

/**
 * Board 1c's distance signal, at the layer that computes it.
 *
 * The weight it feeds was in the ranking config from the beginning and had
 * never moved a result, because `distanceKm` was hardcoded null at both call
 * sites. These tests exist so that stays fixed.
 */

const AL_QUOZ = { lat: 25.1279, lng: 55.2342 };
const JEBEL_ALI = { lat: 24.9857, lng: 55.0654 };

describe("haversineKm", () => {
  it("is zero from a point to itself", () => {
    expect(haversineKm(AL_QUOZ, AL_QUOZ)).toBe(0);
  });

  it("measures a known UAE hop about right", () => {
    // Al Quoz to Jebel Ali is roughly 24 km by air. A formula that is out by a
    // factor — degrees for radians, diameter for radius — fails this loudly.
    const km = haversineKm(AL_QUOZ, JEBEL_ALI);
    expect(km).toBeGreaterThan(20);
    expect(km).toBeLessThan(30);
  });

  it("is symmetric", () => {
    expect(haversineKm(AL_QUOZ, JEBEL_ALI)).toBeCloseTo(haversineKm(JEBEL_ALI, AL_QUOZ), 9);
  });

  it("puts Dubai and Abu Dhabi a bit over 100 km apart", () => {
    const km = haversineKm(EMIRATE_CENTRES.dubai!, EMIRATE_CENTRES.abu_dhabi!);
    expect(km).toBeGreaterThan(110);
    expect(km).toBeLessThan(150);
  });
});

describe("EMIRATE_CENTRES", () => {
  it("covers all seven", () => {
    expect(Object.keys(EMIRATE_CENTRES)).toHaveLength(7);
  });

  it("puts every one inside the UAE's bounding box", () => {
    // A transposed lat/lng pair is the classic error here and lands in Somalia.
    for (const [name, point] of Object.entries(EMIRATE_CENTRES)) {
      expect(point.lat, name).toBeGreaterThan(22.5);
      expect(point.lat, name).toBeLessThan(26.5);
      expect(point.lng, name).toBeGreaterThan(51);
      expect(point.lng, name).toBeLessThan(56.5);
    }
  });
});

describe("nearestKm", () => {
  it("takes the closest branch, not the first", () => {
    const km = nearestKm(AL_QUOZ, [JEBEL_ALI, AL_QUOZ]);
    expect(km).toBe(0);
  });

  it("skips a branch with no coordinates rather than approximating it", () => {
    // Criterion 4's rule, in the ranking rather than on the map: an unpinned
    // location is not placed at an area centroid to make the maths work.
    const km = nearestKm(AL_QUOZ, [{ lat: null, lng: null }, JEBEL_ALI]);
    expect(km).toBeCloseTo(haversineKm(AL_QUOZ, JEBEL_ALI), 9);
  });

  it("is null when every branch is unpinned", () => {
    // Unknown, which scores half credit. Not "far away", which would penalise a
    // supplier for a gap in our data.
    expect(nearestKm(AL_QUOZ, [{ lat: null, lng: null }])).toBeNull();
  });

  it("is null when there is no origin", () => {
    expect(nearestKm(null, [AL_QUOZ])).toBeNull();
  });

  it("is null for a supplier with no locations at all", () => {
    expect(nearestKm(AL_QUOZ, [])).toBeNull();
  });
});
