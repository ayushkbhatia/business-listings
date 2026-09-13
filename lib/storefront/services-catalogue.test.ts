import { describe, expect, it } from "vitest";
import { isCrawlable } from "@/lib/seo/crawl-policy";
import {
  FILTERS_EARN_THEIR_PLACE,
  SERVICES_PAGE_SIZE,
  applyServicesFilters,
  filterNoteKind,
  isServicesFiltered,
  mostEnquired,
  paginate,
  parseServicesQuery,
  servicesFacets,
  servicesQueryString,
  showsFilterGroups,
  sortByVolume,
  sortedByVolume,
  type CatalogueService,
} from "./services-catalogue";

/** Board `1e-s` — the public services list, without a database. */

const audit: CatalogueService = { id: "audit", position: 2, engagementType: "ongoing_contract", feeBasis: "fixed_fee", feeBasisLabel: "Fixed fee" };
const vat: CatalogueService = { id: "vat", position: 0, engagementType: "ongoing_contract", feeBasis: "per_return", feeBasisLabel: "Per return" };
const ct: CatalogueService = { id: "ct", position: 1, engagementType: "one_off_job", feeBasis: null, feeBasisLabel: null };
const books: CatalogueService = { id: "books", position: 3, engagementType: "ongoing_contract", feeBasis: "retainer", feeBasisLabel: "Retainer" };
const all = [audit, vat, ct, books];

const query = parseServicesQuery({});

describe("sortByVolume — B5, Q3", () => {
  it("puts the most enquired first and breaks ties by the seller's own order", () => {
    const volume = new Map([["audit", 17], ["books", 2], ["vat", 2]]);
    expect(sortByVolume(all, volume).map((s) => s.id)).toEqual(["audit", "vat", "books", "ct"]);
  });

  it("is exactly the seller's order when nothing has been enquired about", () => {
    expect(sortByVolume(all, new Map()).map((s) => s.id)).toEqual(["vat", "ct", "audit", "books"]);
    expect(sortedByVolume(all, new Map())).toBe(false);
    expect(sortedByVolume(all, new Map([["ct", 1]]))).toBe(true);
  });
});

describe("mostEnquired — B5", () => {
  it("awards the clear leader, with its count", () => {
    expect(mostEnquired(all, new Map([["audit", 17], ["vat", 3]]))).toEqual({ id: "audit", enquiries: 17 });
  });

  it("awards nothing at a tie, at zero, or with one service", () => {
    expect(mostEnquired(all, new Map([["audit", 4], ["vat", 4]]))).toBeNull();
    expect(mostEnquired(all, new Map())).toBeNull();
    expect(mostEnquired([audit], new Map([["audit", 9]]))).toBeNull();
  });
});

describe("filters", () => {
  it("ANDs across groups and ORs within one", () => {
    const q = parseServicesQuery({ engagement: "ongoing_contract", fee: ["fixed_fee", "retainer"] });
    expect(applyServicesFilters(all, q).map((s) => s.id)).toEqual(["audit", "books"]);
  });

  it("counts every option over the whole list, and offers only values in use", () => {
    const facets = servicesFacets(all, parseServicesQuery({ engagement: "one_off_job" }));
    expect(facets.engagement).toEqual([
      { value: "ongoing_contract", label: null, count: 3, selected: false },
      { value: "one_off_job", label: null, count: 1, selected: true },
    ]);
    expect(facets.fee.map((f) => [f.value, f.label, f.count])).toEqual([
      ["fixed_fee", "Fixed fee", 1],
      ["per_return", "Per return", 1],
      ["retainer", "Retainer", 1],
    ]);
  });

  it("has no availability group at all — D11 closed as no", () => {
    expect(Object.keys(servicesFacets(all, query))).toEqual(["engagement", "fee"]);
  });

  it("omits the groups for one service and keeps the note's wording honest past eight", () => {
    expect(showsFilterGroups(1)).toBe(false);
    expect(showsFilterGroups(2)).toBe(true);
    expect(filterNoteKind(4)).toBe("few");
    expect(filterNoteKind(FILTERS_EARN_THEIR_PLACE + 1)).toBe("many");
  });
});

describe("the query", () => {
  it("parses repeated and comma-joined values, and ignores a bad page", () => {
    expect(parseServicesQuery({ engagement: ["a", "b,a"], fee: "x", page: "0" })).toEqual({
      engagement: ["a", "b"],
      fee: ["x"],
      page: 1,
    });
    expect(isServicesFiltered(query)).toBe(false);
    expect(isServicesFiltered(parseServicesQuery({ fee: "x" }))).toBe(true);
  });

  it("writes page last and alone, so only an unfiltered page stays crawlable", () => {
    expect(servicesQueryString(query, { page: 2 })).toBe("page=2");
    expect(isCrawlable(`/b/x/services?${servicesQueryString(query, { page: 2 })}`)).toBe(true);
    const filtered = servicesQueryString(parseServicesQuery({ fee: "retainer" }), { page: 2 });
    expect(filtered).toBe("fee=retainer&page=2");
    expect(isCrawlable(`/b/x/services?${filtered}`)).toBe(false);
  });
});

describe("paginate — Q4", () => {
  it("cuts at thirty and clamps a page past the end", () => {
    const rows = Array.from({ length: SERVICES_PAGE_SIZE + 5 }, (_, i) => i);
    expect(paginate(rows, 1).rows).toHaveLength(30);
    expect(paginate(rows, 2)).toEqual({ rows: [30, 31, 32, 33, 34], page: 2, pages: 2 });
    expect(paginate(rows, 9).page).toBe(2);
    expect(paginate([], 1)).toEqual({ rows: [], page: 1, pages: 1 });
  });
});
