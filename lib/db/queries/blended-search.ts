import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import type { Emirate } from "@/lib/db/generated/enums";
import { prisma } from "@/lib/db/client";
import { CHECKED_CREDENTIAL, CREDENTIAL_KINDS } from "@/lib/credentials/kinds";
import { BRIEF_MAX_RECIPIENTS } from "@/lib/enquiry/service-brief";
import { nearestKm } from "@/lib/geo/distance";
import { t } from "@/lib/i18n";
import { measurable } from "@/lib/locations/branch";
import type { CoverageScope } from "@/lib/locations/coverage";
import { liveBoosts } from "@/lib/search/boosts";
import {
  activeTab,
  appliedGroups,
  applyFilters,
  dropLadder,
  facetRail,
  filtersOf,
  FACET_ROW,
  kindBreakdown,
  majorityCategory,
  narrow,
  SERVICE_RAIL_ORDER,
  SHARED_RAIL_ORDER,
  splitSectors,
  tabCounts,
  tabsWithResults,
  type BlendedFilters,
  type FacetScope,
  type FacetVocabulary,
  type PlaceValues,
  type ProductFacetValues,
  type RailKey,
  type ResultKind,
  type SearchDoc,
  type ServiceFacetValues,
} from "@/lib/search/blended";
import {
  BLENDED_PAGE_SIZE,
  BUSINESS_SERVICES_NAMED,
  PRODUCT_CHIPS_SHOWN,
  pagerFor,
  type BlendedSearchResult,
  type RfqEscapeFacts,
  type RfqPromptFacts,
  type BlendedResultView,
  type SupplierResultView,
  type ProductResultView,
  type ServiceResultView,
  type ZeroState,
} from "@/lib/search/blended-views";
import { resolveOrigin, shapeOf, weightsForShape } from "@/lib/search/origin";
import {
  SERVICE_FACET_KEYS,
  facetText,
  sortInScope,
  type SearchQuery,
  type SearchSort,
  type ServiceFacetKey,
} from "@/lib/search/query";
import { rankResultSet, type RankSignals, type RankingKind, type VectorSet } from "@/lib/search/ranking";
import { coverageMatch, scopeCompleteness, type CoverageTarget } from "@/lib/search/service-signals";
import { liveVectors } from "@/lib/search/settings";
import { ENGAGEMENT_TYPES, DELIVERED_WHERE } from "@/lib/services/scope-sheet";
import { familyResolver } from "@/lib/services/service";
import { resolveTemplateIds } from "@/lib/spec/resolve";
import { toSpecRows, type TemplateField } from "@/lib/spec";
import { sellsWork, type SellsKindValue } from "@/lib/storefront/tabs";
import { getTradeKinds } from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";
import {
  PUBLIC_BUSINESS,
  businessWhere,
  listingKind,
  productWhere,
  relevanceOf,
  serviceWhere,
} from "./search";

/**
 * Boards `1c-s`, `10c` and `10c-s` — the blended result set, from the database
 * to the page.
 *
 * Three queries find what the **words** match — services, firms, products — as
 * ids. Everything a facet, a count or a ranking needs is then read once for the
 * firms behind them, the documents are built, and `lib/search/blended.ts`
 * decides every number from them. Only the twenty rows on the page are read in
 * full.
 *
 * ## Why the words, and only the words
 *
 * `1c-s` put the place and the tier in the `where` and the scope sheet on the
 * document, which worked while the rail held nothing but scope-sheet rows. The
 * three-part rail of `10c-s` breaks it: *Dubai 198* is a count **within the
 * current results**, and a filter applied in SQL has already removed the rows
 * it would have to count. So the candidate queries carry the words and nothing
 * else, and every filter — shared, product and service alike — is one predicate
 * over the documents. One definition of the query, which is the property the
 * module was built for.
 *
 * ## The cap, and what it says when reached
 *
 * Each kind is read up to `CANDIDATE_CAP` ids, ordered by id so the set is the
 * same set on every request. Production holds 122 listings, 226 products and
 * no live service, so nothing reaches it; a query that does is told so on the
 * page rather than shown counts that quietly describe the first thousand.
 */

export const CANDIDATE_CAP = 1000;

export { BLENDED_PAGE_SIZE, type BlendedSearchResult, type RfqPromptFacts };

/* ── What the words find ─────────────────────────────────────────────────── */

async function areaFor(query: SearchQuery): Promise<{ id: string; emirate: Emirate } | null> {
  if (!query.area) return null;
  return prisma.area.findUnique({ where: { slug: query.area }, select: { id: true, emirate: true } });
}

/**
 * The query with every filter taken off — the candidate set the rail counts
 * against.
 *
 * `bounds` goes too: a viewport sends the whole page to goods search
 * (`compositionFor` rule 1), so a blended query carrying one is a URL nobody
 * drew, and a box applied in SQL here would narrow a set the rail then reports
 * counts over.
 */
function wordsOnly(query: SearchQuery): SearchQuery {
  return {
    ...query,
    emirate: undefined,
    area: undefined,
    tier: undefined,
    freeZone: false,
    availability: [],
    replyWithinHours: undefined,
    yearsTrading: undefined,
    spec: {},
    services: undefined,
    kind: undefined,
    bounds: undefined,
    page: 1,
  };
}

const FIRM_SELECT = {
  id: true,
  displayName: true,
  searchText: true,
  sellsKind: true,
  scopeSheetFamilyId: true,
  verificationTier: true,
  responseTimeMedianMs: true,
  specCompleteness: true,
  establishedYear: true,
  ratingOverall: true,
  reviewCount: true,
  claimStatus: true,
  primaryCategoryId: true,
  publishedAt: true,
  categories: { select: { categoryId: true }, take: 5 },
  plan: { select: { rankingMultiplier: true } },
  /*
     Every published branch, not the nearest five.

     The five were enough while this list only fed `nearestKm`. The shared scope
     of the rail counts emirates off it, and a firm whose sixth branch is its
     only Ajman one would be missing from an Ajman count that the same rail then
     offers — a filter that returns a row the count did not include. Twenty-five
     is past the largest branch list in the directory and still one row per
     branch rather than a join per option.
  */
  locations: {
    where: { published: true },
    select: {
      lat: true,
      lng: true,
      geocodePrecision: true,
      emirate: true,
      areaId: true,
      area: { select: { isFreeZone: true } },
    },
    orderBy: [{ type: "asc" }, { id: "asc" }] as Prisma.LocationOrderByWithRelationInput[],
    take: 25,
  },
  freeZoneRegistrations: {
    select: { areaId: true, area: { select: { emirate: true, isFreeZone: true } } },
    take: 25,
  },
} as const;

const LIVE_SERVICE_SELECT = {
  id: true,
  businessId: true,
  name: true,
  categoryId: true,
  engagementType: true,
  feeBasis: true,
  turnaround: true,
  deliveredWhere: true,
  deliverable: true,
  scope: true,
  position: true,
  publishedAt: true,
  category: { select: { name: true } },
  coverage: { select: { emirate: true, areaId: true } },
  values: { where: { fieldKey: "sectors" }, select: { value: true } },
} as const;

/** One document with what ranking, sorting and hydration need beside it. */
interface LoadedDoc extends SearchDoc {
  signals: RankSignals;
  vector: RankingKind;
  /** When a buyer could first have found it — for a saved search's *new matches*. */
  listedAt: Date | null;
  /** The four single-signal orders a buyer can ask for, per row. */
  rating: number | null;
  claimed: boolean;
  /** Filled spec fields out of the template's, for `Sort: most complete specs`. */
  specFilled: number | null;
}

export interface BlendedSet {
  /** Every document the words found, before any filter. */
  docs: LoadedDoc[];
  vocabulary: FacetVocabulary;
  vectors: VectorSet;
  /** Kinds whose candidates reached `CANDIDATE_CAP`. */
  overflow: ResultKind[];
  /** Fee-basis labels, per service id, for the rows. */
  feeLabel: ReadonlyMap<string, string | null>;
  /** Live service names per firm, matched first — for supplier rows. */
  firmServices: ReadonlyMap<string, { names: string[]; total: number; matched: boolean }>;
  /** Checked credential kinds per firm. */
  credentials: ReadonlyMap<string, string[]>;
  /** The trade most of the matched services sit in — where the RFQ prompt sends a brief. */
  briefCategory: { slug: string } | null;
  /** The trade the words mostly found, whichever kind — where a zero-result escape goes. */
  escapeCategory: { slug: string } | null;
  /** A product's category's template fields, for the rail and the row chips. */
  specFields: ReadonlyMap<string, RailField[]>;
  /** The trade the products scope offers spec fields from, and its name. */
  specTrade: { categoryId: string; name: string } | null;
  /** The area `?area=` named, resolved. */
  area: { id: string; emirate: string } | null;
}

/**
 * Every document the query's words match, with its facets on it.
 *
 * Exported so the saved-search sweep counts a blended search with this and not
 * with a second reading of it.
 */
export async function loadBlendedSet(query: SearchQuery): Promise<BlendedSet> {
  const words = wordsOnly(query);

  const [area, serviceIds, businessIds, productRows, stored, boosts, origin, shape, kinds, resolveFamily] =
    await Promise.all([
      areaFor(query),
      prisma.service.findMany({
        where: serviceWhere(words),
        select: { id: true, businessId: true },
        orderBy: { id: "asc" },
        take: CANDIDATE_CAP + 1,
      }),
      prisma.business.findMany({
        where: businessWhere(words),
        select: { id: true },
        orderBy: { id: "asc" },
        take: CANDIDATE_CAP + 1,
      }),
      prisma.product.findMany({
        where: productWhere(words),
        select: {
          id: true,
          businessId: true,
          name: true,
          sku: true,
          searchText: true,
          createdAt: true,
          categoryId: true,
          availability: true,
          specValues: true,
        },
        orderBy: { id: "asc" },
        take: CANDIDATE_CAP + 1,
      }),
      liveVectors(),
      liveBoosts(),
      resolveOrigin(query),
      shapeOf(query),
      getTradeKinds(),
      familyResolver(),
    ]);

  const overflow: ResultKind[] = [];
  if (serviceIds.length > CANDIDATE_CAP) overflow.push("service");
  if (businessIds.length > CANDIDATE_CAP) overflow.push("supplier");
  if (productRows.length > CANDIDATE_CAP) overflow.push("product");
  const matchedServices = serviceIds.slice(0, CANDIDATE_CAP);
  const matchedFirms = businessIds.slice(0, CANDIDATE_CAP);
  const products = productRows.slice(0, CANDIDATE_CAP);

  const firmIds = [
    ...new Set([
      ...matchedFirms.map((row) => row.id),
      ...matchedServices.map((row) => row.businessId),
      ...products.map((row) => row.businessId),
    ]),
  ];

  const [firms, liveServices, defaults, checked, specFields] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: firmIds }, ...PUBLIC_BUSINESS }, select: FIRM_SELECT }),
    prisma.service.findMany({
      where: { businessId: { in: firmIds }, status: "live" },
      select: LIVE_SERVICE_SELECT,
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
    prisma.serviceCoverage.findMany({
      where: { businessId: { in: firmIds }, serviceId: null },
      select: { businessId: true, emirate: true, areaId: true },
    }),
    prisma.credential.findMany({
      where: { businessId: { in: firmIds }, ...CHECKED_CREDENTIAL },
      select: { businessId: true, kind: true },
    }),
    loadSpecFields(products.map((product) => product.categoryId)),
  ]);

  const firmById = new Map(firms.map((firm) => [firm.id, firm]));
  const credentials = new Map<string, string[]>();
  for (const row of checked) {
    const held = credentials.get(row.businessId) ?? [];
    if (!held.includes(row.kind)) held.push(row.kind);
    credentials.set(row.businessId, held);
  }
  const defaultsOf = new Map<string, CoverageScope[]>();
  for (const row of defaults) {
    defaultsOf.set(row.businessId, [...(defaultsOf.get(row.businessId) ?? []), { emirate: row.emirate, areaId: row.areaId }]);
  }
  const servicesOf = new Map<string, (typeof liveServices)[number][]>();
  for (const service of liveServices) {
    servicesOf.set(service.businessId, [...(servicesOf.get(service.businessId) ?? []), service]);
  }
  const matchedIds = new Set(matchedServices.map((row) => row.id));
  const liveById = new Map(liveServices.map((service) => [service.id, service]));
  const matchedByName = new Set(matchedFirms.map((row) => row.id));

  /* ── The vocabulary, gathered while the documents are built ───────────── */

  const vocab = new VocabularyBuilder();
  const facetsOf = new Map<string, ServiceFacetValues>();
  const feeLabel = new Map<string, string | null>();

  for (const service of liveServices) {
    const firm = firmById.get(service.businessId);
    if (!firm) continue;
    const family = resolveFamily(service.categoryId, firm.scopeSheetFamilyId);
    const filterable = new Set(
      family.rows.filter((row) => row.filterable && row.key !== "regulator").map((row) => row.key),
    );
    const fee = family.feeBases.find((basis) => basis.key === service.feeBasis);
    feeLabel.set(service.id, fee?.label ?? null);

    const turnaround = service.turnaround?.trim() ? service.turnaround.trim().replace(/\s+/g, " ") : null;
    const sectors = splitSectors(service.values[0]?.value);

    facetsOf.set(service.id, {
      engagement: service.engagementType,
      turnaround: turnaround ? facetText(turnaround) : null,
      fee: service.feeBasis,
      delivered: service.deliveredWhere,
      sectors: sectors.map((sector) => sector.key),
      filterable,
    });

    if (filterable.has(FACET_ROW.fee) && service.feeBasis && fee) {
      vocab.option("fee", service.feeBasis, fee.label, family.feeBases.indexOf(fee));
    }
    if (filterable.has(FACET_ROW.turnaround) && turnaround) {
      vocab.option("turnaround", facetText(turnaround), turnaround, 0);
    }
    if (filterable.has(FACET_ROW.sector)) {
      for (const sector of sectors) vocab.option("sector", sector.key, sector.label, 0);
    }
  }

  /* ── Places ────────────────────────────────────────────────────────────── */

  const coverageOf = (service: (typeof liveServices)[number], firmId: string): CoverageScope[] =>
    service.coverage.length > 0 ? service.coverage : (defaultsOf.get(firmId) ?? []);

  const placeOfCoverage = (rows: readonly CoverageScope[]): PlaceValues => ({
    emirates: [...new Set(rows.map((row) => String(row.emirate)))],
    areaIds: [...new Set(rows.map((row) => row.areaId).filter((id): id is string => id !== null))],
    wideEmirates: [
      ...new Set(rows.filter((row) => row.areaId === null).map((row) => String(row.emirate))),
    ],
  });

  const mergePlaces = (...places: PlaceValues[]): PlaceValues => ({
    emirates: [...new Set(places.flatMap((place) => place.emirates))],
    areaIds: [...new Set(places.flatMap((place) => place.areaIds))],
    wideEmirates: [...new Set(places.flatMap((place) => place.wideEmirates))],
  });

  const branchPlaceOf = (firm: (typeof firms)[number]): PlaceValues => ({
    emirates: [...new Set(firm.locations.map((location) => String(location.emirate)))],
    areaIds: [...new Set(firm.locations.map((location) => location.areaId))],
    /* A branch address names one area. It never reaches the emirate whole. */
    wideEmirates: [],
  });

  const freeZonePlaceOf = (firm: (typeof firms)[number]): PlaceValues => {
    const zones = firm.locations.filter((location) => location.area?.isFreeZone);
    const registered = firm.freeZoneRegistrations.filter((row) => row.area.isFreeZone);
    return {
      emirates: [
        ...new Set([
          ...zones.map((location) => String(location.emirate)),
          ...registered.map((row) => String(row.area.emirate)),
        ]),
      ],
      areaIds: [...new Set([...zones.map((location) => location.areaId), ...registered.map((row) => row.areaId)])],
      wideEmirates: [],
    };
  };

  /* ── The documents ─────────────────────────────────────────────────────── */

  const servicesLive = stored.services !== null;
  const vectors: VectorSet = { goods: weightsForShape(stored.goods, shape), services: stored.services };
  const kindOf = listingKind(kinds, undefined);
  const target: CoverageTarget | null = area
    ? { emirate: area.emirate, areaId: area.id }
    : query.emirate
      ? { emirate: query.emirate as Emirate, areaId: null }
      : null;

  const firmSignals = (firm: (typeof firms)[number]) => ({
    verificationTier: firm.verificationTier,
    responseTimeMedianMs: firm.responseTimeMedianMs,
    specCompleteness: firm.specCompleteness,
    planMultiplier: firm.plan?.rankingMultiplier ?? 1,
  });

  const firmFacts = (firm: (typeof firms)[number]) => ({
    verificationTier: firm.verificationTier,
    responseTimeMedianMs: firm.responseTimeMedianMs,
    establishedYear: firm.establishedYear,
    rating: firm.reviewCount > 0 ? firm.ratingOverall : null,
    claimed: firm.claimStatus === "claimed",
    credentials: credentials.get(firm.id) ?? [],
    freeZone: freeZonePlaceOf(firm),
  });

  const productValues = new Map<string, ProductFacetValues>();
  for (const product of products) {
    productValues.set(product.id, {
      availability: product.availability,
      spec: specValuesOf(product.specValues),
      categoryId: product.categoryId,
    });
  }

  const docs: LoadedDoc[] = [];
  const firmServices = new Map<string, { names: string[]; total: number; matched: boolean }>();
  /** Relevance of the best row each firm returned, for its own supplier document. */
  const bestRowRelevance = new Map<string, number>();
  const note = (firmId: string, relevance: number) => {
    bestRowRelevance.set(firmId, Math.max(bestRowRelevance.get(firmId) ?? 0, relevance));
  };

  for (const row of matchedServices) {
    const firm = firmById.get(row.businessId);
    const service = liveById.get(row.id);
    const values = facetsOf.get(row.id);
    if (!firm || !service || !values) continue;
    const own = servicesOf.get(firm.id) ?? [];
    const relevance = relevanceOf(
      `${service.name} ${service.scope ?? ""} ${service.deliverable ?? ""} ${service.category.name} ${firm.displayName}`,
      query.q,
    );
    note(firm.id, relevance);
    docs.push({
      id: `service:${service.id}`,
      kind: "service",
      rowId: service.id,
      businessId: firm.id,
      place: placeOfCoverage(coverageOf(service, firm.id)),
      services: [values],
      products: [],
      ...firmFacts(firm),
      vector: "services",
      listedAt: service.publishedAt,
      specFilled: null,
      signals: {
        ...firmSignals(firm),
        relevance,
        distanceKm: null,
        boostPoints: boosts.get(firm.id) ?? 0,
        scopeCompleteness: scopeCompleteness(own),
        coverageMatch: servicesLive
          ? coverageMatch({ target, businessDefault: defaultsOf.get(firm.id) ?? [], matched: [service] })
          : null,
      },
    });
  }

  for (const product of products) {
    const firm = firmById.get(product.businessId);
    const values = productValues.get(product.id);
    if (!firm || !values) continue;
    const relevance = relevanceOf(`${product.name} ${product.sku ?? ""} ${product.searchText ?? ""}`, query.q);
    note(firm.id, relevance);
    docs.push({
      id: `product:${product.id}`,
      kind: "product",
      rowId: product.id,
      businessId: firm.id,
      place: branchPlaceOf(firm),
      services: [],
      products: [values],
      ...firmFacts(firm),
      vector: "goods",
      listedAt: product.createdAt,
      specFilled: filledRatio(specFields.get(product.categoryId) ?? [], product.specValues),
      signals: {
        ...firmSignals(firm),
        relevance,
        distanceKm: nearestKm(origin, measurable(firm.locations)),
        boostPoints: boosts.get(firm.id) ?? 0,
      },
    });
  }

  /*
     A supplier document for **every** firm in the set, not only the ones the
     words found by name — `B2`. *Suppliers 96* is a count of distinct
     businesses, and the 44 behind the products belong in it as much as the 71
     behind the services. Which of them also gets a row in Everything is
     `narrow`'s decision, not this one.
  */
  const productsOfFirm = new Map<string, ProductFacetValues[]>();
  for (const product of products) {
    const values = productValues.get(product.id);
    if (!values) continue;
    productsOfFirm.set(product.businessId, [...(productsOfFirm.get(product.businessId) ?? []), values]);
  }

  for (const firmId of firmIds) {
    const firm = firmById.get(firmId);
    if (!firm) continue;
    const own = servicesOf.get(firm.id) ?? [];
    const matched = own.filter((service) => matchedIds.has(service.id));
    /*
       The services a facet asks about: the ones the words found, or — where the
       firm matched on its own name, or there were no words — every one it
       offers. Never a service the words passed over when some did match: a firm
       found for *vat* is not a fixed-fee result because its audit is fixed fee.
    */
    const answering = matched.length > 0 ? matched : own;
    firmServices.set(firm.id, {
      names: [...matched, ...own.filter((service) => !matchedIds.has(service.id))].map((service) => service.name),
      total: own.length,
      matched: matched.length > 0,
    });
    const vector = kindOf(firm);
    const coverage = mergePlaces(
      ...(answering.length > 0
        ? answering.map((service) => placeOfCoverage(coverageOf(service, firm.id)))
        : [placeOfCoverage(defaultsOf.get(firm.id) ?? [])]),
    );
    docs.push({
      id: `supplier:${firm.id}`,
      kind: "supplier",
      rowId: firm.id,
      businessId: firm.id,
      /* A firm is where its branches are **and** where it works — `1c-s`'s reading. */
      place: mergePlaces(branchPlaceOf(firm), coverage),
      services: answering
        .map((service) => facetsOf.get(service.id))
        .filter((value): value is ServiceFacetValues => Boolean(value)),
      products: productsOfFirm.get(firm.id) ?? [],
      ...firmFacts(firm),
      vector,
      listedAt: firm.publishedAt,
      specFilled: null,
      signals: {
        ...firmSignals(firm),
        /*
           The better of the two readings: how well the firm's own record answers
           the words, and how well the best thing it returned does. A firm reached
           only through a product never matched by name, and scoring it on a name
           it does not carry would rank every such supplier last by construction.
        */
        relevance: Math.max(
          matchedByName.has(firm.id)
            ? relevanceOf(
                `${firm.displayName} ${matched.map((service) => service.name).join(" ")} ${firm.searchText ?? ""}`,
                query.q,
              )
            : 0,
          bestRowRelevance.get(firm.id) ?? 0,
        ),
        distanceKm: nearestKm(origin, measurable(firm.locations)),
        boostPoints: boosts.get(firm.id) ?? 0,
        scopeCompleteness: scopeCompleteness(own),
        coverageMatch:
          servicesLive && vector === "services"
            ? coverageMatch({ target, businessDefault: defaultsOf.get(firm.id) ?? [], matched })
            : null,
      },
    });
  }

  /* ── The rail's vocabulary, from the values present ────────────────────── */

  for (const doc of docs) for (const kind of doc.credentials) vocab.credential(kind);
  for (const doc of docs) for (const emirate of doc.place.emirates) vocab.emirate(emirate);
  for (const product of products) vocab.availability(product.availability);

  /*
     The trade the products scope may offer spec fields from, and its name — see
     `majorityCategory` for why a majority and not the plurality.
  */
  const specTradeId = majorityCategory([...productValues.values()]);
  const specTrade = specTradeId
    ? await prisma.category
        .findUnique({ where: { id: specTradeId }, select: { name: true } })
        .then((row) => (row ? { categoryId: specTradeId, name: row.name } : null))
    : null;
  const specGroups: RailKey[] = [];
  if (specTrade) {
    for (const field of specFields.get(specTrade.categoryId) ?? []) {
      if (!field.isFilterable) continue;
      specGroups.push(field.id);
      vocab.specField(field);
      for (const values of productValues.values()) {
        for (const value of values.spec[field.id] ?? []) {
          /*
             The template's own order, where the field declares one: `DN15,
             DN25, DN50, DN80, DN100` is the order the trade reads sizes in, and
             sorting the strings instead puts DN100 above DN15. A value a seller
             typed that the template does not list sorts after the declared ones.
          */
          const declared = field.options.indexOf(value);
          vocab.option(field.id, value, value, declared === -1 ? field.options.length : declared);
        }
      }
    }
  }

  /* The trade most matched services sit in, first-found breaking a tie. */
  const serviceTally = new Map<string, number>();
  for (const row of matchedServices) {
    const service = liveById.get(row.id);
    if (service) serviceTally.set(service.categoryId, (serviceTally.get(service.categoryId) ?? 0) + 1);
  }
  const topServiceCategory = [...serviceTally].sort((a, b) => b[1] - a[1])[0]?.[0];

  /* And the trade the words found at all, whichever kind — the escape's destination. */
  const anyTally = new Map(serviceTally);
  for (const product of products) {
    anyTally.set(product.categoryId, (anyTally.get(product.categoryId) ?? 0) + 1);
  }
  for (const firmId of matchedByName) {
    const firm = firmById.get(firmId);
    if (firm) anyTally.set(firm.primaryCategoryId, (anyTally.get(firm.primaryCategoryId) ?? 0) + 1);
  }
  const topAnyCategory = [...anyTally].sort((a, b) => b[1] - a[1])[0]?.[0];

  const slugs = await prisma.category.findMany({
    where: { id: { in: [topServiceCategory, topAnyCategory].filter((id): id is string => Boolean(id)) } },
    select: { id: true, slug: true },
  });
  const slugOf = new Map(slugs.map((row) => [row.id, row.slug]));

  return {
    docs,
    vocabulary: vocab.build(specGroups),
    vectors,
    overflow,
    feeLabel,
    firmServices,
    credentials,
    briefCategory: topServiceCategory && slugOf.has(topServiceCategory)
      ? { slug: slugOf.get(topServiceCategory)! }
      : null,
    escapeCategory: topAnyCategory && slugOf.has(topAnyCategory) ? { slug: slugOf.get(topAnyCategory)! } : null,
    specFields,
    specTrade,
    area: area ? { id: area.id, emirate: String(area.emirate) } : null,
  };
}

/* ── Spec fields ────────────────────────────────────────────────────────── */

/**
 * A template field, plus the option list the rail orders its values by.
 *
 * `TemplateField` is what `toSpecRows` reads to render a value; the rail needs
 * one thing more — the sequence the trade declares — so it is added here rather
 * than pushed into a type four other callers share.
 */
interface RailField extends TemplateField {
  options: string[];
}

/** `Product.specValues`, as the predicate reads it: every value a list. */
function specValuesOf(raw: unknown): Record<string, readonly string[]> {
  const out: Record<string, string[]> = {};
  for (const [fieldId, value] of Object.entries((raw ?? {}) as Record<string, unknown>)) {
    if (value === null || value === undefined || value === "") continue;
    out[fieldId] = (Array.isArray(value) ? value : [value])
      .filter((entry) => entry !== null && entry !== undefined && entry !== "")
      .map(String);
  }
  return out;
}

/** Filled fields out of the template's, or null where the trade has no template. */
function filledRatio(fields: readonly RailField[], raw: unknown): number | null {
  if (fields.length === 0) return null;
  const values = specValuesOf(raw);
  return fields.filter((field) => (values[field.id] ?? []).length > 0).length / fields.length;
}

/**
 * The template fields of every trade the matched products sit in.
 *
 * Two reads for the whole candidate set, shared by three readers: the rail's
 * spec groups, the `most complete specs` order and the chips on a product row.
 * Board `1c` left the chips off the search products tab because *"/search spans
 * every category at once — there is no single template to read"*; there is,
 * once you read them all by id rather than guessing one.
 */
async function loadSpecFields(categoryIds: readonly string[]): Promise<Map<string, RailField[]>> {
  const out = new Map<string, RailField[]>();
  const wanted = [...new Set(categoryIds)];
  if (wanted.length === 0) return out;

  const templateIds = await resolveTemplateIds(prisma, wanted);
  const ids = [...new Set([...templateIds.values()].filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return out;

  const fields = await prisma.specField.findMany({
    where: { templateId: { in: ids } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: {
      id: true,
      templateId: true,
      key: true,
      label: true,
      unit: true,
      type: true,
      options: true,
      isFilterable: true,
    },
  });
  const byTemplate = new Map<string, RailField[]>();
  for (const field of fields) {
    byTemplate.set(field.templateId, [...(byTemplate.get(field.templateId) ?? []), field]);
  }
  for (const categoryId of wanted) {
    const templateId = templateIds.get(categoryId);
    out.set(categoryId, templateId ? (byTemplate.get(templateId) ?? []) : []);
  }
  return out;
}

/* ── Vocabulary ─────────────────────────────────────────────────────────── */

/**
 * The rail's words, gathered from the values actually present.
 *
 * Group labels are the platform's neutral words, not a family's. A family's
 * row labels are its own table's vocabulary — *Sectors most audited* is right
 * on an audit sheet — and a search crosses families: a group that took the
 * label of whichever firms happened to match would rename itself between two
 * searches. A free-text option's label is its commonest spelling.
 *
 * A spec field is the exception and keeps its own label, because the field *is*
 * one template's — which is why the products scope only offers a trade's fields
 * where a majority of the matched products are in that trade.
 */
class VocabularyBuilder {
  private options = new Map<string, Map<string, { label: string; order: number; votes: Map<string, number> }>>();
  private labels = new Map<string, string>();
  private free = new Set<string>(["turnaround", "sector"]);

  option(key: string, value: string, label: string, order: number) {
    const group = this.options.get(key) ?? new Map<string, { label: string; order: number; votes: Map<string, number> }>();
    const entry = group.get(value) ?? { label, order, votes: new Map<string, number>() };
    entry.order = Math.min(entry.order, order);
    entry.votes.set(label, (entry.votes.get(label) ?? 0) + 1);
    group.set(value, entry);
    this.options.set(key, group);
  }

  credential(kind: string) {
    const order = (CREDENTIAL_KINDS as readonly string[]).indexOf(kind);
    this.option("credential", kind, t(`credentials_public.kind.${kind}` as "credentials_public.kind.fta_tax_agent"), order);
  }

  emirate(value: string) {
    this.option("emirate", value, t(`emirate.${value}` as "emirate.dubai"), EMIRATE_ORDER.indexOf(value));
  }

  availability(value: string) {
    this.option("availability", value, t(`availability.${value}` as "availability.in_stock"), AVAILABILITY_ORDER.indexOf(value));
  }

  specField(field: RailField) {
    this.labels.set(field.id, field.unit ? `${field.label} (${field.unit})` : field.label);
    /*
       A field with no declared options has no order to read, so its values are
       drawn commonest first like any other free text. One with options keeps the
       template's sequence, which is the trade's.
    */
    if (field.options.length === 0) this.free.add(field.id);
  }

  build(specGroups: readonly RailKey[]): FacetVocabulary {
    const groupLabel: Record<string, string> = {
      emirate: t("facet.emirate"),
      tier: t("facet.tier"),
      freeZone: t("facet.free_zone"),
      availability: t("facet.availability"),
      ...Object.fromEntries(
        SERVICE_FACET_KEYS.map((key) => [key, t(`search_blended.facet.${key}` as "search_blended.facet.fee")]),
      ),
      ...Object.fromEntries(this.labels),
    };

    const option: Record<string, ReadonlyMap<string, { label: string; order: number }>> = {};
    for (const [key, group] of this.options) {
      option[key] = new Map(
        [...group].map(([value, entry]) => {
          const label = [...entry.votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? entry.label;
          return [value, { label, order: entry.order }];
        }),
      );
    }

    /* The closed vocabularies, whether or not a matched row happened to use one. */
    const closed = (key: string) => {
      const held = new Map(option[key] ?? new Map());
      option[key] = held;
      return held;
    };
    const engagement = closed("engagement");
    for (const [index, value] of ENGAGEMENT_TYPES.entries()) {
      engagement.set(value, { label: t(`engagement.${value}` as "engagement.ongoing_contract"), order: index });
    }
    const delivered = closed("delivered");
    for (const [index, value] of DELIVERED_WHERE.entries()) {
      delivered.set(value, { label: t(`search_blended.delivered.${value}` as "search_blended.delivered.remote"), order: index });
    }
    const credential = closed("credential");
    for (const [index, value] of CREDENTIAL_KINDS.entries()) {
      credential.set(value, {
        label: t(`credentials_public.kind.${value}` as "credentials_public.kind.fta_tax_agent"),
        order: index,
      });
    }
    closed("tier").set(String(VERIFIED_TIER), { label: t("search_blended.facet_option.verified"), order: 0 });
    closed("freeZone").set("1", { label: t("facet.free_zone_option"), order: 0 });

    const order: Record<FacetScope, readonly RailKey[]> = {
      shared: SHARED_RAIL_ORDER,
      products: ["availability", ...specGroups],
      services: SERVICE_RAIL_ORDER,
    };

    return {
      groupLabel,
      option,
      freeText: this.free,
      order,
      /* Emirate, tier and free zone replace; everything else takes several. */
      multi: new Set<string>(["availability", ...SERVICE_FACET_KEYS, ...specGroups]),
    };
  }
}

const EMIRATE_ORDER = ["dubai", "abu_dhabi", "sharjah", "ajman", "ras_al_khaimah", "fujairah", "umm_al_quwain"];
const AVAILABILITY_ORDER = ["in_stock", "made_to_order", "indent", "out_of_stock"];

/* ── The page ───────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 3_600_000;

/** Everything boards `10c` and `10c-s` render for one query. */
export async function blendedSearch(query: SearchQuery): Promise<BlendedSearchResult> {
  const set = await loadBlendedSet(query);
  const filters = filtersOf(query, set.area);
  const active = activeTab(query);

  const matching = applyFilters(set.docs, filters) as LoadedDoc[];
  const counts = tabCounts(matching);
  const rail = facetRail(set.docs, filters, set.vocabulary, active);

  const ranked = rankResultSet(
    matching,
    (doc) => doc.kind,
    (doc) => doc.signals,
    (doc) => doc.vector,
    set.vectors,
  );
  const narrowed = ordered(narrow(ranked, active), sortInScope(query.sort, active));
  /*
     A page past the end shows the last one, not an empty column.

     `?page=99` on a forty-result list used to render no rows and no state to
     explain them — not a zero result, because the set is not empty, and not a
     list, because the slice is. Clamping keeps the pager's own numbers true and
     costs a buyer with a stale bookmark nothing.
  */
  const pages = Math.max(1, Math.ceil(narrowed.length / BLENDED_PAGE_SIZE));
  const pageNumber = Math.min(Math.max(1, query.page), pages);
  const from = (pageNumber - 1) * BLENDED_PAGE_SIZE;
  const page = narrowed.slice(from, from + BLENDED_PAGE_SIZE);

  const rows = await hydrate(page, set, returnedBy(matching));

  /*
     `B9` — three zero states, and only the first gets the ladder.

     `nothing` is nought in Everything: either the words found nothing at all, or
     the filters closed it. `kind` is nought in the tab the buyer is on while
     another tab still holds results, and showing the ladder there would tell a
     buyer nobody has listed it while 164 services match.
  */
  const zero: ZeroState = counts.all === 0 ? "nothing" : narrowed.length === 0 ? "kind" : "none";
  const applied = appliedGroups(filters, set.vocabulary);

  return {
    counts,
    breakdown: kindBreakdown(matching),
    active,
    rail,
    rows,
    narrowedTotal: narrowed.length,
    unfilteredTotal: set.docs.length,
    zero,
    elsewhere: tabsWithResults(counts, active),
    ladder: zero === "nothing" && applied.length > 0
      ? dropLadder(set.docs, filters, set.vocabulary, active)
      : [],
    appliedGroups: applied.length,
    overflow: set.overflow,
    rfq: rfqFacts(query, matching, set),
    escape: zero === "nothing" ? escapeFacts(query, set) : null,
    pager: pagerFor(pageNumber, rows.length, narrowed.length),
    /*
       `10c` contribution 1 — said only where it is true. Spec matching is what
       puts a product the seller typed as *4 inch* in front of a DN100 query,
       and `product.searchText` carries the synonyms that do it (`B7`).
    */
    specMatched: query.q.trim().length > 0 && counts.products > 0,
    specTrade: set.specTrade?.name ?? null,
  };
}

/**
 * `Q3` — the buyer's chosen order, over the ranked list.
 *
 * `best` is the ranking and is left alone; the other four are single signals,
 * because that is what a buyer picking them is asking for. Unclaimed listings
 * sink in every one of them, the same rule goods search holds — they have no
 * rating, no measured reply and nobody behind them.
 *
 * `specs` reaches here only on the Products tab (`sortInScope`), which is the
 * whole of Q3's answer: one cross-kind order plus kind-specific ones that
 * appear in scope.
 */
function ordered(rows: readonly LoadedDoc[], sort: SearchSort): LoadedDoc[] {
  if (sort === "best") return [...rows];
  const by = (value: number | null | undefined, worst: number) => value ?? worst;
  return [...rows].sort((a, b) => {
    const claim = (a.claimed ? 0 : 1) - (b.claimed ? 0 : 1);
    if (claim !== 0) return claim;
    switch (sort) {
      case "rating":
        return by(b.rating, -1) - by(a.rating, -1);
      case "reply":
        return (
          by(a.responseTimeMedianMs, Number.MAX_SAFE_INTEGER) -
          by(b.responseTimeMedianMs, Number.MAX_SAFE_INTEGER)
        );
      case "specs":
        return by(b.specFilled, -1) - by(a.specFilled, -1);
      default:
        return (b.listedAt?.getTime() ?? 0) - (a.listedAt?.getTime() ?? 0);
    }
  });
}

/**
 * `1c-s` B9 — the brief prompt, and the one sentence under it that is a number.
 *
 * *Most reply within a day* is a claim, and response time is measured, never
 * claimed. So the sentence counts the firms behind these service results that
 * have a measured median and says how many of them answer inside a day; with
 * none measured, it says nothing about speed at all.
 */
function rfqFacts(query: SearchQuery, matching: readonly LoadedDoc[], set: BlendedSet): RfqPromptFacts | null {
  if (!set.briefCategory) return null;
  const firms = new Map<string, number | null>();
  for (const doc of matching) {
    if (doc.kind === "service") firms.set(doc.businessId, doc.responseTimeMedianMs);
  }
  if (firms.size === 0) return null;
  const measured = [...firms.values()].filter((ms): ms is number => ms !== null);

  const params = new URLSearchParams({ category: set.briefCategory.slug, kind: "services" });
  if (query.emirate) params.set("emirate", query.emirate);
  if (query.area) params.set("area", query.area);

  return {
    href: `/rfq/new?${params}`,
    cap: BRIEF_MAX_RECIPIENTS,
    measured: measured.length,
    withinDay: measured.filter((ms) => ms <= DAY_MS).length,
  };
}

/**
 * `B10` — *ask the market instead*, and the count it is allowed to state.
 *
 * The suppliers here match the words, before any filter: they are the firms
 * that could answer a brief, not the firms that answered the four filters which
 * returned nothing. The number is capped at the fan-out's own limit because
 * that is how many will actually be written to, and a page that offers eight
 * and sends to six is the same defect as a header counting a longer list than
 * it draws.
 *
 * **Nought is a real answer here, not an absent one.** A query the words found
 * nobody for is the query most worth asking the market about, so the offer
 * stands and states no number — the composer asks for the trade, which is the
 * one thing the search could not supply.
 */
function escapeFacts(query: SearchQuery, set: BlendedSet): RfqEscapeFacts {
  const firms = new Set(set.docs.map((doc) => doc.businessId));

  const params = new URLSearchParams();
  if (set.escapeCategory) params.set("category", set.escapeCategory.slug);
  if (query.emirate) params.set("emirate", query.emirate);
  if (query.area) params.set("area", query.area);
  const search = params.toString();

  return {
    href: search ? `/rfq/new?${search}` : "/rfq/new",
    suppliers: Math.min(firms.size, BRIEF_MAX_RECIPIENTS),
    cap: BRIEF_MAX_RECIPIENTS,
  };
}

/**
 * `Q2` — what each firm returned on this query, counted over the whole matching
 * set rather than the page.
 *
 * *3 products and 1 service match "chiller"* is the line that makes a supplier
 * row worth a tab. Counted here so a firm on page two states the same numbers
 * it states on page one, which a per-page tally would not.
 */
function returnedBy(matching: readonly LoadedDoc[]): Map<string, { products: number; services: number }> {
  const out = new Map<string, { products: number; services: number }>();
  for (const doc of matching) {
    if (doc.kind === "supplier") continue;
    const held = out.get(doc.businessId) ?? { products: 0, services: 0 };
    if (doc.kind === "product") held.products += 1;
    else held.services += 1;
    out.set(doc.businessId, held);
  }
  return out;
}

/**
 * The twenty rows, read in full, in the ranked order.
 *
 * Three narrow reads by id. `indicativeFee` is not selected — the one field on
 * a service whose leak is a commercial problem is never fetched on a public
 * path, which is `3g-s` B5's rule and the reason there is no `include` here.
 */
async function hydrate(
  page: readonly LoadedDoc[],
  set: BlendedSet,
  /** What each firm returned on this query — the supplier row's own line (`Q2`). */
  returned: ReadonlyMap<string, { products: number; services: number }>,
): Promise<BlendedResultView[]> {
  const ids = (kind: ResultKind) => page.filter((doc) => doc.kind === kind).map((doc) => doc.rowId);
  const firmPlace = {
    select: { area: { select: { name: true } }, emirate: true },
    where: { published: true },
    orderBy: [{ type: "asc" }, { id: "asc" }] as Prisma.LocationOrderByWithRelationInput[],
    take: 1,
  };
  const firmRow = {
    slug: true,
    displayName: true,
    ratingOverall: true,
    reviewCount: true,
    responseTimeMedianMs: true,
    verificationTier: true,
    verifiedAt: true,
    locations: firmPlace,
  } as const;

  const [services, firms, products] = await Promise.all([
    prisma.service.findMany({
      where: { id: { in: ids("service") } },
      select: {
        id: true,
        slug: true,
        name: true,
        scope: true,
        turnaround: true,
        deliveredWhere: true,
        businessId: true,
        values: { where: { fieldKey: "sectors" }, select: { value: true } },
        business: { select: firmRow },
      },
    }),
    prisma.business.findMany({
      where: { id: { in: ids("supplier") } },
      select: {
        id: true,
        ...firmRow,
        description: true,
        headline: true,
        teamSize: true,
        sellsKind: true,
        primaryCategory: { select: { name: true } },
        _count: { select: { products: { where: { status: { not: "draft" } } } } },
      },
    }),
    prisma.product.findMany({
      where: { id: { in: ids("product") } },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        availability: true,
        categoryId: true,
        specValues: true,
        business: { select: { slug: true, displayName: true, responseTimeMedianMs: true, locations: firmPlace } },
      },
    }),
  ]);

  const serviceById = new Map(services.map((row) => [row.id, row]));
  const firmById = new Map(firms.map((row) => [row.id, row]));
  const productById = new Map(products.map((row) => [row.id, row]));

  const out: BlendedResultView[] = [];
  for (const doc of page) {
    if (doc.kind === "service") {
      const row = serviceById.get(doc.rowId);
      if (!row) continue;
      out.push(serviceView(row, set));
    } else if (doc.kind === "supplier") {
      const row = firmById.get(doc.rowId);
      if (!row) continue;
      out.push(supplierView(row, set, returned.get(doc.rowId) ?? { products: 0, services: 0 }));
    } else {
      const row = productById.get(doc.rowId);
      if (!row) continue;
      out.push(productView(row, set));
    }
  }
  return out;
}

type Place = { area: { name: string } | null; emirate: Emirate };

function placeLabel(locations: readonly Place[]): string | null {
  const first = locations[0];
  if (!first) return null;
  const emirate = t(`emirate.${first.emirate}` as never);
  return first.area ? `${first.area.name} · ${emirate}` : emirate;
}

function firmFactsOf(
  firm: {
    slug: string;
    displayName: string;
    ratingOverall: number | null;
    reviewCount: number;
    responseTimeMedianMs: number | null;
    verificationTier: number;
    verifiedAt: Date | null;
    locations: Place[];
  },
  checked: readonly string[],
) {
  return {
    businessSlug: firm.slug,
    businessName: firm.displayName,
    place: placeLabel(firm.locations),
    rating:
      firm.ratingOverall !== null && firm.reviewCount > 0
        ? { value: firm.ratingOverall, count: firm.reviewCount }
        : null,
    replyMs: firm.responseTimeMedianMs,
    verificationTier: firm.verificationTier,
    verifiedAt: firm.verifiedAt ? firm.verifiedAt.toISOString() : null,
    checkedCredentials: checked,
  };
}

function serviceView(
  row: {
    id: string;
    slug: string;
    name: string;
    scope: string | null;
    turnaround: string | null;
    deliveredWhere: string | null;
    businessId: string;
    values: { value: string }[];
    business: Parameters<typeof firmFactsOf>[0];
  },
  set: BlendedSet,
): ServiceResultView {
  const chips = [
    row.turnaround?.trim() || null,
    set.feeLabel.get(row.id) ?? null,
    row.deliveredWhere
      ? t(`search_blended.delivered.${row.deliveredWhere}` as "search_blended.delivered.remote")
      : null,
    splitSectors(row.values[0]?.value).map((sector) => sector.label).join(" · ") || null,
  ].filter((chip): chip is string => chip !== null);

  return {
    kind: "service",
    id: row.id,
    slug: row.slug,
    name: row.name,
    summary: row.scope?.trim() || null,
    chips,
    ...firmFactsOf(row.business, set.credentials.get(row.businessId) ?? []),
  };
}

function supplierView(
  row: Parameters<typeof firmFactsOf>[0] & {
    id: string;
    description: string | null;
    headline: string | null;
    teamSize: string | null;
    sellsKind: string;
    primaryCategory: { name: string } | null;
    _count: { products: number };
  },
  set: BlendedSet,
  matched: { products: number; services: number },
): SupplierResultView {
  const offered = set.firmServices.get(row.id);
  return {
    kind: "supplier",
    id: row.id,
    summary: row.description?.trim() || row.headline?.trim() || null,
    sellsWork: sellsWork(row.sellsKind as SellsKindValue),
    trade: row.primaryCategory?.name ?? null,
    teamLabel: row.teamSize
      ? t("search_blended.team", { band: t(`storefront.team_band.${row.teamSize}` as "storefront.team_band.b1_10") })
      : null,
    services:
      offered && offered.total > 0
        ? { names: offered.names.slice(0, BUSINESS_SERVICES_NAMED), total: offered.total }
        : null,
    matchedOnService: offered?.matched ?? false,
    productCount: row._count.products,
    matched,
    ...firmFactsOf(row, set.credentials.get(row.id) ?? []),
  };
}

function productView(
  row: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    availability: string;
    categoryId: string;
    specValues: unknown;
    business: { slug: string; displayName: string; responseTimeMedianMs: number | null; locations: Place[] };
  },
  set: BlendedSet,
): ProductResultView {
  /*
     The spec chips board `1c` could not draw.

     *"There is no single template to read"* was true of guessing one and false
     of reading them all: `loadSpecFields` resolves a template per trade, so a
     chiller's chips are its own trade's fields and a valve's are its own.
     Filled values only, in template order — an unfilled field is *Not provided*
     on a spec table and nothing at all on a row.
  */
  const chips = toSpecRows(set.specFields.get(row.categoryId) ?? [], row.specValues)
    .filter((spec) => spec.value !== null)
    .slice(0, PRODUCT_CHIPS_SHOWN)
    .map((spec) => (spec.unit ? `${spec.value} ${spec.unit}` : String(spec.value)));

  return {
    kind: "product",
    id: row.id,
    slug: row.slug,
    name: row.name,
    businessSlug: row.business.slug,
    businessName: row.business.displayName,
    summary: row.description?.trim() || null,
    availability: t(`availability.${row.availability}` as "availability.in_stock"),
    inStock: row.availability === "in_stock",
    place: placeLabel(row.business.locations),
    chips,
    replyMs: row.business.responseTimeMedianMs,
  };
}

/* ── Saved searches ─────────────────────────────────────────────────────── */

/** How many results a blended search holds now, narrowed as the saved URL is. */
export async function countBlended(query: SearchQuery): Promise<number> {
  const set = await loadBlendedSet(query);
  return narrow(applyFilters(set.docs, filtersOf(query, set.area)), activeTab(query)).length;
}

/** Results listed after `since`, and when the newest was listed. */
export async function blendedMatchesSince(
  query: SearchQuery,
  since: Date,
): Promise<{ count: number; newestAt: Date | null }> {
  const set = await loadBlendedSet(query);
  const fresh = narrow(
    applyFilters(set.docs, filtersOf(query, set.area)) as LoadedDoc[],
    activeTab(query),
  ).filter((doc) => doc.listedAt !== null && doc.listedAt > since);
  const newestAt = fresh.reduce<Date | null>(
    (latest, doc) => (latest === null || doc.listedAt! > latest ? doc.listedAt : latest),
    null,
  );
  return { count: fresh.length, newestAt };
}
