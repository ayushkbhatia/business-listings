import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { buildProductSearchText } from "@/lib/search/index-text";
import { PAGE_SIZE, businessWhere } from "@/lib/db/queries/search";
import { BLENDED_PAGE_SIZE, blendedSearch } from "@/lib/db/queries/blended-search";
import { compositionFor, TAB_KIND } from "@/lib/search/blended";
import { BLENDED_TABS, SERVICE_FACET_KEYS, parseSearchQuery } from "@/lib/search/query";
import { countMatches, newMatchesSince, tabOf } from "@/lib/saved-search/match";

/**
 * Boards `1c-s`, `10c` and `10c-s` — search results, against a database.
 *
 * `lib/search/blended.test.ts` proves the counting rules on plain documents.
 * What only a database can show is that the documents are the right ones: that
 * a service reaches a place through its own coverage before its firm's, that a
 * firm is found by the work it lists, that a claimed credential never reaches
 * the rail, that a spec field reaches the rail from the trade a majority of the
 * products are in, that the private fee never leaves the database — and, end to
 * end, that every count on the page is the number of rows choosing it would
 * leave.
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
let template: string;
let sizeField: string;
let materialField: string;
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
let shop: string;
let nameOnlyFirm: string;

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

  /*
     A live template on the goods trade, so `10c`'s spec half has something to
     read: a filterable field reaches the products scope of the rail, and the
     values reach the chips on a product row.
  */
  const made = await prisma.specTemplate.create({
    data: {
      name: `${WORD} kit template`,
      status: "live",
      version: 1,
      categories: { create: [{ categoryId: goodsCategory }] },
      fields: {
        create: [
          { key: "size", label: "Nominal size", type: "select", options: ["DN50", "DN100"], isFilterable: true, sortOrder: 0 },
          { key: "material", label: "Body material", type: "select", options: ["Brass"], isFilterable: true, sortOrder: 1 },
        ],
      },
    },
    select: { id: true, fields: { select: { id: true, key: true } } },
  });
  template = made.id;
  sizeField = made.fields.find((field) => field.key === "size")!.id;
  materialField = made.fields.find((field) => field.key === "material")!.id;
  await prisma.category.update({ where: { id: goodsCategory }, data: { defaultTemplateId: template } });

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

  // A goods seller with two products carrying the word, one of them in stock.
  shop = await firm({ name: "Kit Traders", covers: [], sellsKind: "goods" });
  await prisma.product.create({
    data: {
      businessId: shop,
      name: `${WORD} return filing software licence`,
      slug: `${WORD}-licence`,
      searchText: buildProductSearchText({ name: `${WORD} return filing software licence` }),
      categoryId: goodsCategory,
      availability: "in_stock",
      status: "live",
      specValues: { [sizeField]: "DN100", [materialField]: "Brass" },
    },
  });
  await prisma.product.create({
    data: {
      businessId: shop,
      name: `${WORD} return filing bundle`,
      slug: `${WORD}-bundle`,
      searchText: buildProductSearchText({ name: `${WORD} return filing bundle` }),
      categoryId: goodsCategory,
      availability: "made_to_order",
      status: "live",
      specValues: { [sizeField]: "DN50" },
    },
  });

  /*
     `Q2` — a firm the words find by its own name, that has listed nothing
     matching. It is the row that would be invisible if Everything were only the
     things, and the reason the Suppliers tab has a shape.
  */
  nameOnlyFirm = await firm({ name: `${WORD} Holdings`, covers: ["dubai"] });
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.specTemplate.deleteMany({ where: { id: template } });
  await prisma.category.deleteMany({ where: { id: { in: [category, goodsCategory] } } });
  await prisma.$disconnect();
});

const query = (params: Record<string, string>) => parseSearchQuery({ q: WORD, ...params });

describe("which rows the words find", () => {
  it("finds a firm by the work it lists, when its name says nothing", async () => {
    const found = await prisma.business.findMany({ where: businessWhere(query({})), select: { id: true } });
    expect(found.map((row) => row.id)).toEqual(expect.arrayContaining([dubaiFirm, narrowedFirm, claimFirm]));
  });

  it("keeps the branch rule in the `where`, so snapshots and landing pages agree", async () => {
    const goods = await prisma.business.findMany({
      where: businessWhere(query({ emirate: "dubai" })),
      select: { id: true },
    });
    // None of these firms has a branch, and `businessWhere` reads branches only.
    expect(goods.map((row) => row.id)).not.toContain(dubaiFirm);
  });

  it("reaches a place through a service's own coverage before its firm's default", async () => {
    const result = await blendedSearch(query({ emirate: "dubai" }));
    const firmsShown = new Set(result.rows.map((row) => ("businessSlug" in row ? row.businessSlug : "")));
    const slugOf = async (id: string) =>
      (await prisma.business.findUniqueOrThrow({ where: { id }, select: { slug: true } })).slug;

    expect(firmsShown.has(await slugOf(dubaiFirm))).toBe(true);
    // Its only service does not go to Dubai, so neither it nor its firm is here.
    expect(firmsShown.has(await slugOf(narrowedFirm))).toBe(false);

    const sharjah = await blendedSearch(query({ emirate: "sharjah" }));
    const inSharjah = new Set(sharjah.rows.map((row) => ("businessSlug" in row ? row.businessSlug : "")));
    expect(inSharjah.has(await slugOf(narrowedFirm))).toBe(true);
  });

  it("takes every query with words to the blended screen — D1", () => {
    expect(compositionFor(query({}))).toBe("blended");
    expect(compositionFor(parseSearchQuery({ q: `${WORD}nothing` }))).toBe("blended");
    expect(compositionFor(parseSearchQuery({}))).toBe("goods");
  });
});

describe("every count on the page is the query", () => {
  it("makes Everything the things plus the firms nothing else represents", async () => {
    const all = await blendedSearch(query({}));
    /* One firm matched on its own name and listed nothing that matched. */
    expect(all.counts.all).toBe(all.counts.products + all.counts.services + 1);
    expect(all.counts.products).toBe(2);
    expect(all.breakdown.products).toBe(all.counts.products);
    expect(all.breakdown.services).toBe(all.counts.services);
  });

  it("counts Suppliers as distinct businesses, never as the sum of the kinds", async () => {
    const all = await blendedSearch(query({}));
    expect(all.counts.suppliers).toBe(businesses.length);
    expect(all.breakdown.productSuppliers + all.breakdown.serviceSuppliers).toBeLessThan(all.counts.suppliers);
  });

  it("keeps the counts the same on every tab, and narrows to that kind alone", async () => {
    const all = await blendedSearch(query({}));
    for (const kind of BLENDED_TABS) {
      const narrowed = await blendedSearch(query({ kind }));
      expect(narrowed.counts).toEqual(all.counts);
      expect(narrowed.narrowedTotal).toBe(all.counts[kind]);
      if (kind !== "all") {
        expect(narrowed.rows.every((row) => row.kind === TAB_KIND[kind])).toBe(true);
      }
    }
  });

  it("gives every rail option the count that choosing it leaves", async () => {
    const filtered = query({ emirate: "dubai", credential: "fta_tax_agent" });
    const result = await blendedSearch(filtered);
    expect(result.rail.length).toBeGreaterThan(0);

    for (const scope of result.rail) {
      for (const group of scope.groups) {
        for (const option of group.options) {
          const chosen =
            group.key === "credential"
              ? [...new Set([...(filtered.services?.credential ?? []), option.value])]
              : [option.value];
          const params: Record<string, string> = { emirate: "dubai", credential: "fta_tax_agent" };
          params[String(group.key)] = chosen.join(",");
          const applied = await blendedSearch(query(params));
          /*
             A kind-specific option counts inside its own kind, because that is
             the tab `B3` switches to. A shared one counts inside the tab in view.
          */
          const expected = scope.scope === "shared" ? applied.counts.all : applied.narrowedTotal;
          expect(expected, `${String(group.key)}=${option.value}`).toBe(option.count);
        }
      }
    }
  });

  it("keeps a product in the blend, and narrows only the kinds a facet asks about", async () => {
    const all = await blendedSearch(query({}));
    expect(all.rows.some((row) => row.kind === "product")).toBe(true);

    /*
       `B3` — a fee basis narrows services and the firms behind them, and says
       nothing about a product. The Products badge is what it was, which is why
       switching to it is an offer rather than an empty page.
    */
    const faceted = await blendedSearch(query({ fee: "retainer" }));
    expect(faceted.counts.services).toBeLessThan(all.counts.services);
    expect(faceted.counts.products).toBe(all.counts.products);

    /* And in reverse: a stock state narrows products and leaves services alone. */
    const stock = await blendedSearch(query({ availability: "made_to_order" }));
    expect(stock.counts.products).toBeLessThan(all.counts.products);
    expect(stock.counts.services).toBe(all.counts.services);
  });
});

describe("the three-part rail, and the switch that keeps it honest", () => {
  it("puts a place in the shared scope, stock in products and the scope sheet in services", async () => {
    const result = await blendedSearch(query({}));
    const keys = (scope: string) =>
      result.rail.find((view) => view.scope === scope)?.groups.map((group) => String(group.key)) ?? [];

    expect(keys("shared")).toContain("emirate");
    expect(keys("products")).toContain("availability");
    expect(keys("services")).toEqual(expect.arrayContaining(["fee", "delivered"]));
    /* Never the other way round: a service has no stock and a product no fee basis. */
    expect(keys("services")).not.toContain("availability");
    for (const scope of ["shared", "products"]) {
      for (const key of SERVICE_FACET_KEYS) expect(keys(scope)).not.toContain(key);
    }
  });

  it("offers a spec field from the trade a majority of the products are in", async () => {
    const result = await blendedSearch(query({}));
    const products = result.rail.find((view) => view.scope === "products");
    expect(products?.groups.map((group) => String(group.key))).toContain(sizeField);
    expect(result.specTrade).toBe(`${WORD} kit trade`);
    const size = products?.groups.find((group) => String(group.key) === sizeField);
    expect(size?.options.map((option) => option.value).sort()).toEqual(["DN100", "DN50"]);
  });

  it("switches the tab for a kind-specific facet rather than returning nothing — B3", async () => {
    const onServices = await blendedSearch(query({ kind: "services", availability: "in_stock" }));
    expect(onServices.active).toBe("products");
    expect(onServices.narrowedTotal).toBeGreaterThan(0);
    expect(onServices.zero).toBe("none");

    const specOnAll = await blendedSearch(parseSearchQuery({ q: WORD, [sizeField]: "DN100" }));
    expect(specOnAll.active).toBe("products");
    expect(specOnAll.rows.every((row) => row.kind === "product")).toBe(true);
  });

  it("draws an option that leads nowhere with its nought, and not as a link", async () => {
    const result = await blendedSearch(parseSearchQuery({ q: WORD, [sizeField]: "DN100", [materialField]: "Brass" }));
    const options = result.rail.flatMap((scope) => scope.groups).flatMap((group) => group.options);
    const dead = options.filter((option) => option.count === 0 && !option.selected);
    expect(dead.length).toBeGreaterThan(0);
    expect(dead.every((option) => option.disabled)).toBe(true);
  });
});

describe("B9 — three zero states, and only one of them gets the ladder", () => {
  it("shows the ladder when the filters closed it, priced by what dropping each buys", async () => {
    const result = await blendedSearch(query({ credential: "fta_tax_agent", delivered: "on_site" }));
    expect(result.counts.all).toBe(0);
    expect(result.zero).toBe("nothing");
    expect(result.ladder.length).toBeGreaterThan(0);
    for (const rung of result.ladder) expect(rung.yields).toBeGreaterThan(0);
    /* B10 — the escape counts the words, not the filters that returned nothing. */
    expect(result.escape?.suppliers).toBeGreaterThan(0);
  });

  it("offers no ladder when the words found nothing to drop a filter from", async () => {
    const result = await blendedSearch(parseSearchQuery({ q: `${WORD}nothing` }));
    expect(result.zero).toBe("nothing");
    expect(result.ladder).toEqual([]);
    expect(result.appliedGroups).toBe(0);
    /*
       The escape stands on the query most worth asking the market about, and
       states no number — the composer asks for the trade the search could not
       supply.
    */
    expect(result.escape).toMatchObject({ suppliers: 0, href: "/rfq/new" });
  });

  it("names the other kinds instead of the ladder when only this tab is empty", async () => {
    /*
       Words that reach a service and no product, on the Products tab. The
       filters are fine and the words found results — they are of another kind,
       which is the one case where the drawn ladder would be actively wrong.
    */
    const result = await blendedSearch(parseSearchQuery({ q: `${WORD} registration`, kind: "products" }));
    expect(result.counts.services).toBeGreaterThan(0);
    expect(result.counts.products).toBe(0);
    expect(result.zero).toBe("kind");
    expect(result.ladder).toEqual([]);
    expect(result.elsewhere).toContain("services");
  });
});

describe("Q2 — the supplier row says what the firm returned on this query", () => {
  it("counts the matched products and services, and says so when neither matched", async () => {
    const result = await blendedSearch(query({ kind: "suppliers" }));
    const rows = result.rows.filter((row) => row.kind === "supplier");
    expect(rows.length).toBe(result.counts.suppliers);

    const shopSlug = (await prisma.business.findUniqueOrThrow({ where: { id: shop }, select: { slug: true } })).slug;
    const nameOnlySlug = (
      await prisma.business.findUniqueOrThrow({ where: { id: nameOnlyFirm }, select: { slug: true } })
    ).slug;

    const goods = rows.find((row) => row.businessSlug === shopSlug)!;
    expect(goods.matched).toEqual({ products: 2, services: 0 });
    expect(goods.trade).toBe(`${WORD} kit trade`);

    const orphan = rows.find((row) => row.businessSlug === nameOnlySlug)!;
    expect(orphan.matched).toEqual({ products: 0, services: 0 });
  });
});

describe("Q3 — one cross-kind order plus the kind-specific one", () => {
  it("orders products by how much of the trade's spec sheet is filled in", async () => {
    const result = await blendedSearch(query({ kind: "products", sort: "specs" }));
    const names = result.rows.map((row) => ("name" in row ? row.name : ""));
    expect(names[0]).toContain("licence");
  });

  it("ignores an order the active tab cannot carry", async () => {
    const services = await blendedSearch(query({ kind: "services", sort: "specs" }));
    const ranked = await blendedSearch(query({ kind: "services" }));
    expect(services.rows.map((row) => row.id)).toEqual(ranked.rows.map((row) => row.id));
  });
});

describe("`10c`'s product row, composed properly at last", () => {
  it("carries its trade's spec values as chips and marks the in-stock one", async () => {
    const result = await blendedSearch(query({ kind: "products" }));
    const licence = result.rows.find((row) => row.kind === "product" && row.name.includes("licence"));
    expect(licence).toBeDefined();
    if (licence?.kind !== "product") throw new Error("expected a product row");
    /*
       `B7` on the chip: the size field renders both units, so a buyer who typed
       DN100 and a buyer who thinks in inches read the same row.
    */
    expect(licence.chips).toHaveLength(2);
    expect(licence.chips[0]).toMatch(/^DN100 · 4\u00a0inch$/);
    expect(licence.chips[1]).toBe("Brass");
    expect(licence.inStock).toBe(true);
    const bundle = result.rows.find((row) => row.kind === "product" && row.name.includes("bundle"));
    if (bundle?.kind !== "product") throw new Error("expected a product row");
    expect(bundle.inStock).toBe(false);
  });
});

describe("B7 — only a checked credential reaches the rail", () => {
  it("offers FTA from the checked firm only, and a claim or a rejection filters nobody in", async () => {
    const result = await blendedSearch(query({ emirate: "dubai" }));
    const fta = result.rail
      .flatMap((scope) => scope.groups)
      .find((group) => group.key === "credential")
      ?.options.find((option) => option.value === "fta_tax_agent");
    const checked = await blendedSearch(query({ emirate: "dubai", credential: "fta_tax_agent" }));

    expect(fta?.count).toBe(checked.narrowedTotal);
    const firmsShown = new Set(checked.rows.map((row) => ("businessSlug" in row ? row.businessSlug : "")));
    const claimSlug = (await prisma.business.findUniqueOrThrow({ where: { id: claimFirm }, select: { slug: true } })).slug;
    expect(firmsShown.has(claimSlug)).toBe(false);
  });

  it("never offers a price group anywhere in the rail", async () => {
    const result = await blendedSearch(query({}));
    const keys = result.rail.flatMap((scope) => scope.groups.map((group) => String(group.key)));
    for (const absent of ["price", "priceRange", "cost", "fee_amount"]) expect(keys).not.toContain(absent);
  });
});

describe("what leaves the database", () => {
  it("never carries the private indicative fee", async () => {
    const result = await blendedSearch(query({}));
    expect(JSON.stringify(result)).not.toContain(SECRET_FEE);
  });

  it("pages at the size goods search pages at, and states the window", async () => {
    expect(BLENDED_PAGE_SIZE).toBe(PAGE_SIZE);
    const result = await blendedSearch(query({}));
    expect(result.pager.from).toBe(1);
    expect(result.pager.to).toBe(result.rows.length);
    expect(result.pager.total).toBe(result.narrowedTotal);
  });

  it("shows the last page rather than an empty column for a page past the end", async () => {
    const result = await blendedSearch(query({ page: "99" }));
    expect(result.pager.page).toBe(result.pager.pages);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.zero).toBe("none");
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
