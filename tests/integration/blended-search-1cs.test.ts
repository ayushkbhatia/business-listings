import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { buildProductSearchText } from "@/lib/search/index-text";
import { PAGE_SIZE, businessWhere } from "@/lib/db/queries/search";
import {
  BLENDED_PAGE_SIZE,
  blendedSearch,
  loadBlendedSet,
  serviceMatchCount,
} from "@/lib/db/queries/blended-search";
import { compositionFor } from "@/lib/search/blended";
import { BLENDED_TABS, SERVICE_FACET_KEYS, parseSearchQuery } from "@/lib/search/query";
import { countMatches, newMatchesSince, tabOf } from "@/lib/saved-search/match";

/**
 * Board `1c-s` — blended search, against a database.
 *
 * `lib/search/blended.test.ts` proves the counting rules on plain documents.
 * What only a database can show is that the documents are the right ones: that
 * a service reaches a place through its own coverage before its firm's, that a
 * firm is found by the work it lists, that a claimed credential never reaches
 * the rail, that the private fee never leaves the database — and, end to end,
 * that every count on the page is the number of rows choosing it would leave.
 *
 * Every row here carries one invented word, so the queries find these rows and
 * nothing a sibling worktree seeded into the same database.
 */

/*
   Letters only. A word with a digit in it is a code to the matcher, and codes
   reach a product through its index text rather than its name.
*/
const WORD = `zq${Date.now().toString(36).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!)}`;
const businesses: string[] = [];
let category: string;
let goodsCategory: string;
let seq = 0;

async function firm(input: {
  name: string;
  covers: ("dubai" | "sharjah" | "abu_dhabi")[];
  sellsKind?: "services" | "goods";
}): Promise<string> {
  seq += 1;
  const created = await prisma.business.create({
    data: {
      displayName: input.name,
      tradeName: `${input.name} LLC`,
      slug: `${WORD}-firm-${seq}`,
      licenceNumber: `DED-B${seq}${WORD.slice(-5)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: input.sellsKind === "goods" ? goodsCategory : category,
      claimStatus: "claimed",
      sellsKind: input.sellsKind ?? "services",
      verificationTier: 2,
      verifiedAt: new Date(Date.now() - 90 * 86_400_000),
      publishedAt: new Date(Date.now() - 60 * 86_400_000),
    },
    select: { id: true },
  });
  businesses.push(created.id);
  if (input.covers.length > 0) {
    await prisma.serviceCoverage.createMany({
      data: input.covers.map((emirate) => ({ businessId: created.id, emirate, areaId: null })),
    });
  }
  return created.id;
}

async function service(
  businessId: string,
  input: {
    name: string;
    feeBasis?: string;
    deliveredWhere?: "remote" | "at_our_office" | "on_site";
    narrowedTo?: ("dubai" | "sharjah")[];
    indicativeFee?: string;
    publishedAt?: Date;
  },
): Promise<string> {
  seq += 1;
  const created = await prisma.service.create({
    data: {
      businessId,
      categoryId: category,
      name: input.name,
      slug: `${WORD}-svc-${seq}`,
      status: "live",
      engagementType: "ongoing_contract",
      feeBasis: input.feeBasis ?? "fixed_fee",
      turnaround: "5 working days",
      deliveredWhere: input.deliveredWhere ?? "remote",
      deliverable: "Filed return",
      scope: "Return preparation and filing.",
      indicativeFee: input.indicativeFee ?? null,
      publishedAt: input.publishedAt ?? new Date(Date.now() - 30 * 86_400_000),
    },
    select: { id: true },
  });
  if (input.narrowedTo) {
    await prisma.serviceCoverage.createMany({
      data: input.narrowedTo.map((emirate) => ({ businessId, serviceId: created.id, emirate, areaId: null })),
    });
  }
  return created.id;
}

const SECRET_FEE = `AED 99,${WORD}`;
let dubaiFirm: string;
let narrowedFirm: string;
let claimFirm: string;

beforeAll(async () => {
  category = (
    await prisma.category.create({
      data: { slug: `${WORD}-tax`, code: "ZQ", name: `${WORD} tax trade`, tradeKind: "services" },
      select: { id: true },
    })
  ).id;
  goodsCategory = (
    await prisma.category.create({
      data: { slug: `${WORD}-kit`, code: "ZQ", name: `${WORD} kit trade`, tradeKind: "goods" },
      select: { id: true },
    })
  ).id;

  // Found by its service alone: its name does not carry the word.
  dubaiFirm = await firm({ name: "Harbour Tax Practice", covers: ["dubai"] });
  await service(dubaiFirm, { name: `${WORD} return filing`, feeBasis: "retainer", indicativeFee: SECRET_FEE });
  await service(dubaiFirm, { name: `${WORD} registration`, feeBasis: "fixed_fee", deliveredWhere: "at_our_office" });
  await prisma.credential.create({
    data: {
      businessId: dubaiFirm,
      kind: "fta_tax_agent",
      identifier: "100000000000003",
      trust: "register_verified",
      verifiedOn: new Date(),
      verifiedBy: "FTA tax agent register",
      review: "auto_verified",
      reviewOpenedAt: new Date(),
    },
  });

  // Default Dubai, but its only service narrowed to Sharjah.
  narrowedFirm = await firm({ name: "Northern Filing Co", covers: ["dubai", "sharjah"] });
  await service(narrowedFirm, { name: `${WORD} return filing`, narrowedTo: ["sharjah"] });

  // A claimed FTA number and a rejected one: neither is a checked credential.
  claimFirm = await firm({ name: "Claimant Advisory", covers: ["dubai"] });
  await service(claimFirm, { name: `${WORD} return filing`, feeBasis: "fixed_fee" });
  await prisma.credential.create({ data: { businessId: claimFirm, kind: "fta_tax_agent", identifier: "100000000000011" } });
  await prisma.credential.create({
    data: {
      businessId: claimFirm,
      kind: "fta_tax_agent",
      identifier: "100000000000029",
      review: "rejected",
      reviewOpenedAt: new Date(),
      reviewedAt: new Date(),
      reviewNote: "Number resolves to another entity.",
      rejectReason: "different_entity",
    },
  });

  // A goods seller with a product carrying the word.
  const shop = await firm({ name: "Kit Traders", covers: [], sellsKind: "goods" });
  await prisma.product.create({
    data: {
      businessId: shop,
      name: `${WORD} return filing software licence`,
      slug: `${WORD}-licence`,
      searchText: buildProductSearchText({ name: `${WORD} return filing software licence` }),
      categoryId: goodsCategory,
      availability: "in_stock",
      status: "live",
    },
  });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.category.deleteMany({ where: { id: { in: [category, goodsCategory] } } });
  await prisma.$disconnect();
});

const query = (params: Record<string, string>) => parseSearchQuery({ q: WORD, ...params });

describe("which rows the words and the place find", () => {
  it("finds a firm by the work it lists, when its name says nothing", async () => {
    const found = await prisma.business.findMany({ where: businessWhere(query({})), select: { id: true } });
    expect(found.map((row) => row.id)).toEqual(expect.arrayContaining([dubaiFirm, narrowedFirm, claimFirm]));
  });

  it("keeps the branch rule for every other caller, so snapshots and landing pages agree", async () => {
    const goods = await prisma.business.findMany({
      where: businessWhere(query({ emirate: "dubai" })),
      select: { id: true },
    });
    // None of these firms has a branch; only the blended page reads coverage.
    expect(goods.map((row) => row.id)).not.toContain(dubaiFirm);
    const blended = await prisma.business.findMany({
      where: businessWhere(query({ emirate: "dubai" }), undefined, { coverage: true }),
      select: { id: true },
    });
    expect(blended.map((row) => row.id)).toContain(dubaiFirm);
  });

  it("reaches a place through a service's own coverage before its firm's default", async () => {
    const set = await loadBlendedSet(query({ emirate: "dubai" }));
    const serviceFirms = set.docs.filter((doc) => doc.kind === "service").map((doc) => doc.businessId);
    const firms = set.docs.filter((doc) => doc.kind === "business").map((doc) => doc.businessId);

    expect(serviceFirms).toContain(dubaiFirm);
    expect(serviceFirms).not.toContain(narrowedFirm);
    // Its only service does not go to Dubai, so the firm is not a Dubai result either.
    expect(firms).not.toContain(narrowedFirm);

    const sharjah = await loadBlendedSet(query({ emirate: "sharjah" }));
    expect(sharjah.docs.filter((doc) => doc.kind === "service").map((doc) => doc.businessId)).toContain(narrowedFirm);
  });

  it("chooses the blended page for words that find a service", async () => {
    const q = query({});
    expect(compositionFor(q, await serviceMatchCount(q))).toBe("blended");
    const nothing = parseSearchQuery({ q: `${WORD}nothing` });
    expect(compositionFor(nothing, await serviceMatchCount(nothing))).toBe("goods");
  });
});

describe("every count on the page is the query", () => {
  it("sums the tabs to the header and keeps them on every tab", async () => {
    const all = await blendedSearch(query({}));
    expect(all.counts.services + all.counts.businesses + all.counts.products).toBe(all.counts.all);
    expect(all.counts.products).toBe(1);

    for (const kind of BLENDED_TABS) {
      const narrowed = await blendedSearch(query({ kind }));
      expect(narrowed.counts).toEqual(all.counts);
      expect(narrowed.narrowedTotal).toBe(kind === "all" ? all.counts.all : all.counts[kind]);
      if (kind !== "all") {
        const expected = { services: "service", businesses: "business", products: "product" }[kind];
        expect(narrowed.rows.every((row) => row.kind === expected)).toBe(true);
      }
    }
  });

  it("gives every rail option the count that choosing it leaves", async () => {
    const filtered = query({ emirate: "dubai", credential: "fta_tax_agent" });
    const result = await blendedSearch(filtered);
    expect(result.rail.length).toBeGreaterThan(0);

    for (const group of result.rail) {
      for (const option of group.options) {
        const chosen =
          group.key === "credential"
            ? [...new Set([...(filtered.services?.credential ?? []), option.value])]
            : [option.value];
        const params: Record<string, string> = { emirate: "dubai", credential: "fta_tax_agent" };
        params[group.key] = chosen.join(",");
        const applied = await blendedSearch(query(params));
        expect(applied.counts.all, `${group.key}=${option.value}`).toBe(option.count);
      }
    }
  });

  it("keeps a product in the blend, and out of a service facet", async () => {
    const all = await blendedSearch(query({}));
    expect(all.rows.some((row) => row.kind === "product")).toBe(true);
    const faceted = await blendedSearch(query({ fee: "retainer" }));
    expect(faceted.counts.products).toBe(0);
  });
});

describe("B7 — only a checked credential reaches the rail", () => {
  it("offers FTA from the checked firm only, and a claim or a rejection filters nobody in", async () => {
    const result = await blendedSearch(query({ emirate: "dubai" }));
    const fta = result.rail.find((group) => group.key === "credential")?.options.find((o) => o.value === "fta_tax_agent");
    const checked = await blendedSearch(query({ emirate: "dubai", credential: "fta_tax_agent" }));

    expect(fta?.count).toBe(checked.counts.all);
    const firmsShown = new Set(checked.rows.map((row) => ("businessSlug" in row ? row.businessSlug : "")));
    const claimSlug = (await prisma.business.findUniqueOrThrow({ where: { id: claimFirm }, select: { slug: true } })).slug;
    expect(firmsShown.has(claimSlug)).toBe(false);
  });

  it("never offers price, stock or availability as a group", async () => {
    const result = await blendedSearch(query({}));
    for (const group of result.rail) expect(SERVICE_FACET_KEYS as readonly string[]).toContain(group.key);
  });
});

describe("what leaves the database", () => {
  it("never carries the private indicative fee", async () => {
    const result = await blendedSearch(query({}));
    expect(JSON.stringify(result)).not.toContain(SECRET_FEE);
  });

  it("pages at the size goods search pages at", () => {
    expect(BLENDED_PAGE_SIZE).toBe(PAGE_SIZE);
  });
});

describe("a saved blended search counts what the page shows", () => {
  it("is recognised by its kind, and counted by the blended loader", async () => {
    const search = `q=${WORD}&emirate=dubai&kind=all`;
    expect(tabOf(search)).toBe("all");
    expect(tabOf(`q=${WORD}&tab=products`)).toBe("products");

    const page = await blendedSearch(parseSearchQuery(Object.fromEntries(new URLSearchParams(search))));
    expect(await countMatches({ query: search, categoryId: null, tab: "all" })).toBe(page.counts.all);
  });

  it("counts a newly published service as a new match", async () => {
    const since = new Date(Date.now() - 1000);
    await service(dubaiFirm, { name: `${WORD} amendment filing`, publishedAt: new Date() });
    const { count, newestAt } = await newMatchesSince({ query: `q=${WORD}&kind=services`, categoryId: null, tab: "all" }, since);
    expect(count).toBe(1);
    expect(newestAt).not.toBeNull();
  });
});
