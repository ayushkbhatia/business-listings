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
  applyFacets,
  dropSuggestion,
  facetRail,
  FACET_ROW,
  narrow,
  splitSectors,
  tabCounts,
  type FacetVocabulary,
  type ResultKind,
  type SearchDoc,
  type ServiceFacetValues,
} from "@/lib/search/blended";
import {
  BLENDED_PAGE_SIZE,
  BUSINESS_SERVICES_NAMED,
  type BlendedSearchResult,
  type RfqPromptFacts,
  type BlendedResultView,
  type BusinessResultView,
  type ProductResultView,
  type ServiceResultView,
} from "@/lib/search/blended-views";
import { resolveOrigin, shapeOf, weightsForShape } from "@/lib/search/origin";
import {
  SERVICE_FACET_KEYS,
  facetText,
  serviceFacetsOf,
  type SearchQuery,
  type ServiceFacetKey,
} from "@/lib/search/query";
import { rankResultSet, type RankSignals, type RankingKind, type VectorSet } from "@/lib/search/ranking";
import { coverageMatch, scopeCompleteness, type CoverageTarget } from "@/lib/search/service-signals";
import { liveVectors } from "@/lib/search/settings";
import { ENGAGEMENT_TYPES, DELIVERED_WHERE } from "@/lib/services/scope-sheet";
import { familyResolver } from "@/lib/services/service";
import { sellsWork, type SellsKindValue } from "@/lib/storefront/tabs";
import { getTradeKinds } from "@/lib/taxonomy/service";
import {
  PUBLIC_BUSINESS,
  businessWhere,
  listingKind,
  productWhere,
  relevanceOf,
  serviceWhere,
} from "./search";

/**
 * Board `1c-s` — the blended result set, from the database to the page.
 *
 * Three queries find what the words and the place match — services, firms,
 * products — as ids. Everything a facet, a count or a ranking needs is then
 * read once for the firms behind them, the documents are built, and
 * `lib/search/blended.ts` decides every number from them. Only the twenty rows
 * on the page are read in full.
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
 * How many live services the words and the place find — the number that
 * decides which composition `/search` renders (`compositionFor`, rule 3).
 */
export async function serviceMatchCount(query: SearchQuery): Promise<number> {
  const area = await areaFor(query);
  return prisma.service.count({ where: serviceWhere(query, area?.emirate) });
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
  primaryCategoryId: true,
  publishedAt: true,
  categories: { select: { categoryId: true }, take: 5 },
  plan: { select: { rankingMultiplier: true } },
  locations: {
    where: { published: true },
    select: { lat: true, lng: true, geocodePrecision: true },
    orderBy: [{ type: "asc" }, { id: "asc" }] as Prisma.LocationOrderByWithRelationInput[],
    take: 5,
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

/** One document with what ranking and hydration need beside it. */
interface LoadedDoc extends SearchDoc {
  signals: RankSignals;
  vector: RankingKind;
  /** When a buyer could first have found it — for a saved search's *new matches*. */
  listedAt: Date | null;
}

export interface BlendedSet {
  /** Every document the words and the place found, before any facet. */
  docs: LoadedDoc[];
  vocabulary: FacetVocabulary;
  vectors: VectorSet;
  /** Kinds whose candidates reached `CANDIDATE_CAP`. */
  overflow: ResultKind[];
  /** Fee-basis labels, per service id, for the rows. */
  feeLabel: ReadonlyMap<string, string | null>;
  /** Live service names per firm, matched first — for business rows. */
  firmServices: ReadonlyMap<string, { names: string[]; total: number; matched: boolean }>;
  /** Checked credential kinds per firm. */
  credentials: ReadonlyMap<string, string[]>;
  /** The trade most of the matched services sit in — where the RFQ prompt sends a brief. */
  briefCategory: { slug: string } | null;
}

/**
 * Every document the query's words and place match, with its facets on it.
 *
 * Exported so the saved-search sweep counts a blended search with this and not
 * with a second reading of it.
 */
export async function loadBlendedSet(query: SearchQuery): Promise<BlendedSet> {
  const area = await areaFor(query);
  const areaEmirate = area?.emirate;

  const [serviceIds, businessIds, productRows, stored, boosts, origin, shape, kinds, resolveFamily] =
    await Promise.all([
      prisma.service.findMany({
        where: serviceWhere(query, areaEmirate),
        select: { id: true, businessId: true },
        orderBy: { id: "asc" },
        take: CANDIDATE_CAP + 1,
      }),
      prisma.business.findMany({
        where: businessWhere(query, undefined, { coverage: true, ...(areaEmirate ? { areaEmirate } : {}) }),
        select: { id: true },
        orderBy: { id: "asc" },
        take: CANDIDATE_CAP + 1,
      }),
      prisma.product.findMany({
        where: productWhere(query),
        select: { id: true, businessId: true, name: true, sku: true, searchText: true, createdAt: true },
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
  if (businessIds.length > CANDIDATE_CAP) overflow.push("business");
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

  const [firms, liveServices, defaults, checked] = await Promise.all([
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

  const docs: LoadedDoc[] = [];
  const firmServices = new Map<string, { names: string[]; total: number; matched: boolean }>();

  for (const row of matchedServices) {
    const firm = firmById.get(row.businessId);
    const service = liveById.get(row.id);
    const values = facetsOf.get(row.id);
    if (!firm || !service || !values) continue;
    const own = servicesOf.get(firm.id) ?? [];
    docs.push({
      id: `service:${service.id}`,
      kind: "service",
      rowId: service.id,
      businessId: firm.id,
      services: [values],
      credentials: credentials.get(firm.id) ?? [],
      vector: "services",
      listedAt: service.publishedAt,
      signals: {
        ...firmSignals(firm),
        relevance: relevanceOf(
          `${service.name} ${service.scope ?? ""} ${service.deliverable ?? ""} ${service.category.name} ${firm.displayName}`,
          query.q,
        ),
        distanceKm: null,
        boostPoints: boosts.get(firm.id) ?? 0,
        scopeCompleteness: scopeCompleteness(own),
        coverageMatch: servicesLive
          ? coverageMatch({ target, businessDefault: defaultsOf.get(firm.id) ?? [], matched: [service] })
          : null,
      },
    });
  }

  for (const row of matchedFirms) {
    const firm = firmById.get(row.id);
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
    docs.push({
      id: `business:${firm.id}`,
      kind: "business",
      rowId: firm.id,
      businessId: firm.id,
      services: answering.map((service) => facetsOf.get(service.id)).filter((value): value is ServiceFacetValues => Boolean(value)),
      credentials: credentials.get(firm.id) ?? [],
      vector,
      listedAt: firm.publishedAt,
      signals: {
        ...firmSignals(firm),
        relevance: relevanceOf(
          `${firm.displayName} ${matched.map((service) => service.name).join(" ")} ${firm.searchText ?? ""}`,
          query.q,
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

  for (const product of products) {
    const firm = firmById.get(product.businessId);
    if (!firm) continue;
    docs.push({
      id: `product:${product.id}`,
      kind: "product",
      rowId: product.id,
      businessId: firm.id,
      services: [],
      credentials: credentials.get(firm.id) ?? [],
      vector: "goods",
      listedAt: product.createdAt,
      signals: {
        ...firmSignals(firm),
        relevance: relevanceOf(`${product.name} ${product.sku ?? ""} ${product.searchText ?? ""}`, query.q),
        distanceKm: nearestKm(origin, measurable(firm.locations)),
      },
    });
  }

  for (const doc of docs) for (const kind of doc.credentials) vocab.credential(kind);

  /* The trade most matched services sit in, first-found breaking a tie. */
  const tally = new Map<string, number>();
  for (const row of matchedServices) {
    const service = liveById.get(row.id);
    if (service) tally.set(service.categoryId, (tally.get(service.categoryId) ?? 0) + 1);
  }
  const topCategory = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0];
  const briefCategory = topCategory
    ? await prisma.category.findUnique({ where: { id: topCategory }, select: { slug: true } })
    : null;

  return {
    docs,
    vocabulary: vocab.build(),
    vectors,
    overflow,
    feeLabel,
    firmServices,
    credentials,
    briefCategory,
  };
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
 */
class VocabularyBuilder {
  private options = Object.fromEntries(
    SERVICE_FACET_KEYS.map((key) => [key, new Map<string, { label: string; order: number; votes: Map<string, number> }>()]),
  ) as Record<ServiceFacetKey, Map<string, { label: string; order: number; votes: Map<string, number> }>>;

  option(key: ServiceFacetKey, value: string, label: string, order: number) {
    const entry = this.options[key].get(value) ?? { label, order, votes: new Map<string, number>() };
    entry.order = Math.min(entry.order, order);
    entry.votes.set(label, (entry.votes.get(label) ?? 0) + 1);
    this.options[key].set(value, entry);
  }

  credential(kind: string) {
    const order = (CREDENTIAL_KINDS as readonly string[]).indexOf(kind);
    this.option("credential", kind, t(`credentials_public.kind.${kind}` as "credentials_public.kind.fta_tax_agent"), order);
  }

  build(): FacetVocabulary {
    const groupLabel = Object.fromEntries(
      SERVICE_FACET_KEYS.map((key) => [key, t(`search_blended.facet.${key}` as "search_blended.facet.fee")]),
    ) as Record<ServiceFacetKey, string>;

    const option = Object.fromEntries(
      SERVICE_FACET_KEYS.map((key) => [
        key,
        new Map(
          [...this.options[key]].map(([value, entry]) => {
            const label = [...entry.votes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? entry.label;
            return [value, { label, order: entry.order }];
          }),
        ),
      ]),
    ) as Record<ServiceFacetKey, Map<string, { label: string; order: number }>>;

    for (const [index, value] of ENGAGEMENT_TYPES.entries()) {
      option.engagement.set(value, { label: t(`engagement.${value}` as "engagement.ongoing_contract"), order: index });
    }
    for (const [index, value] of DELIVERED_WHERE.entries()) {
      option.delivered.set(value, { label: t(`search_blended.delivered.${value}` as "search_blended.delivered.remote"), order: index });
    }
    for (const [index, value] of CREDENTIAL_KINDS.entries()) {
      option.credential.set(value, {
        label: t(`credentials_public.kind.${value}` as "credentials_public.kind.fta_tax_agent"),
        order: index,
      });
    }

    return { groupLabel, option };
  }
}

/* ── The page ───────────────────────────────────────────────────────────── */

const DAY_MS = 24 * 3_600_000;

/** Everything board `1c-s` renders for one query. */
export async function blendedSearch(query: SearchQuery): Promise<BlendedSearchResult> {
  const set = await loadBlendedSet(query);
  const facets = serviceFacetsOf(query);

  const matching = applyFacets(set.docs, facets) as LoadedDoc[];
  const counts = tabCounts(matching);
  const rail = facetRail(set.docs, facets, set.vocabulary);

  const ranked = rankResultSet(
    matching,
    (doc) => doc.kind,
    (doc) => doc.signals,
    (doc) => doc.vector,
    set.vectors,
  );
  const narrowed = narrow(ranked, query.kind);
  const from = (query.page - 1) * BLENDED_PAGE_SIZE;
  const page = narrowed.slice(from, from + BLENDED_PAGE_SIZE);

  const rows = await hydrate(page, set);

  return {
    counts,
    rail,
    rows,
    narrowedTotal: narrowed.length,
    unfilteredTotal: set.docs.length,
    suggestion: counts.all === 0 && set.docs.length > 0 ? dropSuggestion(set.docs, facets) : null,
    overflow: set.overflow,
    rfq: rfqFacts(query, matching, set),
  };
}

/**
 * B9 — the brief prompt, and the one sentence under it that is a number.
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
    if (doc.kind === "service") firms.set(doc.businessId, doc.signals.responseTimeMedianMs);
  }
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
 * The twenty rows, read in full, in the ranked order.
 *
 * Three narrow reads by id. `indicativeFee` is not selected — the one field on
 * a service whose leak is a commercial problem is never fetched on a public
 * path, which is `3g-s` B5's rule and the reason there is no `include` here.
 */
async function hydrate(page: readonly LoadedDoc[], set: BlendedSet): Promise<BlendedResultView[]> {
  const ids = (kind: ResultKind) => page.filter((doc) => doc.kind === kind).map((doc) => doc.rowId);
  const firmPlace = {
    select: { area: { select: { name: true } }, emirate: true },
    where: { published: true },
    orderBy: [{ type: "asc" }, { id: "asc" }] as Prisma.LocationOrderByWithRelationInput[],
    take: 1,
  };
  const firmFacts = {
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
        business: { select: firmFacts },
      },
    }),
    prisma.business.findMany({
      where: { id: { in: ids("business") } },
      select: {
        id: true,
        ...firmFacts,
        description: true,
        headline: true,
        teamSize: true,
        sellsKind: true,
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
        business: { select: { slug: true, displayName: true, locations: firmPlace } },
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
    } else if (doc.kind === "business") {
      const row = firmById.get(doc.rowId);
      if (!row) continue;
      out.push(businessView(row, set));
    } else {
      const row = productById.get(doc.rowId);
      if (!row) continue;
      out.push(productView(row));
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

function firmFacts(
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
    business: Parameters<typeof firmFacts>[0];
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
    ...firmFacts(row.business, set.credentials.get(row.businessId) ?? []),
  };
}

function businessView(
  row: Parameters<typeof firmFacts>[0] & {
    id: string;
    description: string | null;
    headline: string | null;
    teamSize: string | null;
    sellsKind: string;
    _count: { products: number };
  },
  set: BlendedSet,
): BusinessResultView {
  const offered = set.firmServices.get(row.id);
  return {
    kind: "business",
    id: row.id,
    summary: row.description?.trim() || row.headline?.trim() || null,
    sellsWork: sellsWork(row.sellsKind as SellsKindValue),
    teamLabel: row.teamSize
      ? t("search_blended.team", { band: t(`storefront.team_band.${row.teamSize}` as "storefront.team_band.b1_10") })
      : null,
    services:
      offered && offered.total > 0
        ? { names: offered.names.slice(0, BUSINESS_SERVICES_NAMED), total: offered.total }
        : null,
    matchedOnService: offered?.matched ?? false,
    productCount: row._count.products,
    ...firmFacts(row, set.credentials.get(row.id) ?? []),
  };
}

function productView(row: {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  availability: string;
  business: { slug: string; displayName: string; locations: Place[] };
}): ProductResultView {
  return {
    kind: "product",
    id: row.id,
    slug: row.slug,
    name: row.name,
    businessSlug: row.business.slug,
    businessName: row.business.displayName,
    summary: row.description?.trim() || null,
    availability: t(`availability.${row.availability}` as "availability.in_stock"),
    place: placeLabel(row.business.locations),
  };
}

/* ── Saved searches ─────────────────────────────────────────────────────── */

/** How many results a blended search holds now, narrowed as the saved URL is. */
export async function countBlended(query: SearchQuery): Promise<number> {
  const set = await loadBlendedSet(query);
  return narrow(applyFacets(set.docs, serviceFacetsOf(query)), query.kind).length;
}

/** Results listed after `since`, and when the newest was listed. */
export async function blendedMatchesSince(
  query: SearchQuery,
  since: Date,
): Promise<{ count: number; newestAt: Date | null }> {
  const set = await loadBlendedSet(query);
  const fresh = narrow(applyFacets(set.docs, serviceFacetsOf(query)) as LoadedDoc[], query.kind).filter(
    (doc) => doc.listedAt !== null && doc.listedAt > since,
  );
  const newestAt = fresh.reduce<Date | null>(
    (latest, doc) => (latest === null || doc.listedAt! > latest ? doc.listedAt : latest),
    null,
  );
  return { count: fresh.length, newestAt };
}
