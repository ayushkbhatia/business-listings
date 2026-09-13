import { describe, expect, it } from "vitest";
import {
  EMIRATE_ORDER,
  coverageDiffers,
  coversEveryEmirate,
  emirateOptions,
  fanoutOffer,
  filterRowsByEmirate,
  offerService,
  rowQualifiers,
  showsEmirateFilter,
  uncoveredEmirates,
  type PlaceView,
} from "./coverage-page";

/** Board `1f-s` — the public coverage page, without a database. */

const whole = (emirate: string): PlaceView => ({ emirate, areaId: null, label: emirate });
const alAin: PlaceView = { emirate: "abu_dhabi", areaId: "area_al_ain", label: "Al Ain" };

const vat = { serviceId: "vat", places: [whole("dubai"), whole("sharjah"), whole("abu_dhabi")] };
const books = { serviceId: "books", places: [whole("dubai"), whole("sharjah")] };
const ct = { serviceId: "ct", places: EMIRATE_ORDER.map(whole) };
const audit = { serviceId: "audit", places: [whole("dubai")] };
const rows = [vat, books, ct, audit];

describe("where", () => {
  it("says all seven only for seven emirate-wide claims", () => {
    expect(coversEveryEmirate(ct.places)).toBe(true);
    expect(coversEveryEmirate([...EMIRATE_ORDER.slice(1).map(whole), alAin])).toBe(false);
  });

  it("qualifies a row with the free zones in emirates it reaches, and no others — B4", () => {
    const zones = [
      { emirate: "dubai", name: "DMCC" },
      { emirate: "dubai", name: "JAFZA" },
      { emirate: "ras_al_khaimah", name: "RAKEZ" },
    ];
    expect(rowQualifiers(audit.places, zones)).toEqual(["DMCC", "JAFZA"]);
    expect(rowQualifiers([whole("sharjah")], zones)).toEqual([]);
  });

  it("suppresses the lead-in when every service reaches the same places", () => {
    expect(coverageDiffers(rows)).toBe(true);
    expect(coverageDiffers([books, { serviceId: "x", places: [whole("sharjah"), whole("dubai")] }])).toBe(false);
    expect(coverageDiffers([books])).toBe(false);
  });
});

describe("the emirate filter — Q2", () => {
  it("appears only past the count 1e-s's filters do", () => {
    expect(showsEmirateFilter(4)).toBe(false);
    expect(showsEmirateFilter(30)).toBe(true);
  });

  it("keeps a row reaching the emirate through an area, and offers only reached emirates", () => {
    const withAlAin = { serviceId: "survey", places: [alAin] };
    expect(filterRowsByEmirate([...rows, withAlAin], "abu_dhabi").map((r) => r.serviceId)).toEqual([
      "vat",
      "ct",
      "survey",
    ]);
    expect(filterRowsByEmirate(rows, null)).toHaveLength(4);
    expect(emirateOptions([books, audit])).toEqual(["dubai", "sharjah"]);
  });
});

describe("the miss — B6", () => {
  it("names the service with the narrowest reach, and an emirate it does not reach", () => {
    expect(offerService(rows)?.serviceId).toBe("audit");
    expect(offerService([ct])).toBeNull();
    expect(uncoveredEmirates(books.places)).toEqual(["abu_dhabi", "ajman", "umm_al_quwain", "ras_al_khaimah", "fujairah"]);
  });

  it("picks the uncovered emirate where the most other firms work, and never offers zero", () => {
    const counts = new Map([["ajman", 34], ["abu_dhabi", 12], ["dubai", 90]]);
    expect(fanoutOffer(uncoveredEmirates(books.places), counts)).toEqual({ emirate: "ajman", firms: 34 });
    expect(fanoutOffer(["fujairah"], counts)).toBeNull();
  });
});
