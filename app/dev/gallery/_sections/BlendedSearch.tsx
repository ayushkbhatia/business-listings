import { BlendedResultList } from "@/components/domain/BlendedResultRows";
import { Tabs } from "@/components/structure";
import { CODE_COPIES } from "@/lib/i18n/paired";
import { t } from "@/lib/i18n";
import {
  emptyFilters,
  facetRail,
  kindBreakdown,
  tabCounts,
  visibleTabs,
  type BlendedFilters,
  type FacetVocabulary,
  type PlaceValues,
  type SearchDoc,
  type TabCounts,
} from "@/lib/search/blended";
import {
  pagerFor,
  type BlendedSearchResult,
  type SupplierResultView,
  type ProductResultView,
  type ServiceResultView,
} from "@/lib/search/blended-views";
import { SERVICE_FACET_KEYS, emptyServiceFacets, parseSearchQuery } from "@/lib/search/query";
import { Breakdown, Pager, RailGroup, RfqPrompt, SortControl } from "@/app/(public)/search/_blended-view";
import { ZeroInKind, ZeroNothing } from "@/app/(public)/_results/BlendedZero";
import { CompareTick } from "@/app/(public)/_compare/CompareTick";
import { Section, States } from "../_kit";

/**
 * Boards `1c-s`, `10c` and `10c-s` — search results, in every documented state
 * the page can be in.
 *
 * The rows are the page's own components from fixed values; the tabs, the rail
 * groups, the sort strip, the pager, the RFQ prompt and both zero states are
 * the page's own parts. The rail's counts go through `facetRail` over a small
 * document set, the function the page uses, so a specimen cannot show a count
 * the rule would not produce. No `h1` and no filter `aside` here: the gallery
 * has its own, and a second one is a duplicate landmark.
 */

const firm = {
  checkedCredentials: [{ kind: "fta_tax_agent", identifier: "100177120400003" }],
  verificationTier: 2,
  verifiedAt: "2026-04-02T08:00:00.000Z",
  rating: null,
};

const SERVICE: ServiceResultView = {
  kind: "service",
  id: "gallery-service-1",
  slug: "vat-return-filing",
  name: "VAT return filing",
  businessSlug: "ardent-audit-and-advisory",
  businessName: "Ardent Audit & Advisory",
  place: "Deira · Dubai",
  replyMs: 2 * 3_600_000,
  summary:
    "Quarterly VAT computation and filing on the FTA portal, with reverse-charge and designated-zone treatment checked before submission.",
  chips: ["5 working days", "Per return", "Remote", "Trading · Free zone entities"],
  ...firm,
  rating: { value: 4.7, count: 34 },
};

const THIN_SERVICE: ServiceResultView = {
  kind: "service",
  id: "gallery-service-2",
  slug: "vat-return-filing",
  name: "VAT return filing",
  businessSlug: "northstar-accounting",
  businessName: "Northstar Accounting",
  place: null,
  replyMs: null,
  summary: null,
  chips: [],
  checkedCredentials: [],
  verificationTier: 1,
  verifiedAt: "2026-05-11T08:00:00.000Z",
  rating: null,
};

const SUPPLIER: SupplierResultView = {
  kind: "supplier",
  id: "gallery-supplier-1",
  businessSlug: "ardent-audit-and-advisory",
  businessName: "Ardent Audit & Advisory",
  place: "Deira · Dubai",
  replyMs: 4 * 3_600_000,
  summary: "Audit, VAT and corporate tax for trading companies and free zone entities.",
  sellsWork: true,
  trade: "VAT & tax advisory",
  teamLabel: t("search_blended.team", { band: t("storefront.team_band.b11_50") }),
  services: { names: ["VAT return filing", "Statutory audit"], total: 6 },
  matchedOnService: true,
  productCount: 0,
  matched: { products: 0, services: 2 },
  ...firm,
};

/** `Q2`'s other half — the firm the words found by name, that listed nothing matching. */
const NAME_ONLY: SupplierResultView = {
  kind: "supplier",
  id: "gallery-supplier-2",
  businessSlug: "emirates-software-trading",
  businessName: "Emirates Software Trading",
  place: "Deira · Dubai",
  replyMs: null,
  summary: "Accounting and point-of-sale software licences for small businesses.",
  sellsWork: false,
  trade: "Business software",
  teamLabel: null,
  services: null,
  matchedOnService: false,
  productCount: 14,
  matched: { products: 0, services: 0 },
  checkedCredentials: [],
  verificationTier: 2,
  verifiedAt: "2026-03-01T08:00:00.000Z",
  rating: null,
};

const PRODUCT: ProductResultView = {
  kind: "product",
  id: "gallery-product-1",
  slug: "air-cooled-scroll-chiller-120-tr",
  name: "Air-cooled scroll chiller — 120 TR",
  businessSlug: "technopump-trading",
  businessName: "Technopump Trading",
  summary: "R-410A, 380V/3ph/50Hz, microchannel condenser. Two in stock at Jebel Ali.",
  availability: t("availability.in_stock"),
  inStock: true,
  place: "Jebel Ali · Dubai",
  chips: ["120 TR", "R-410A"],
  replyMs: 5 * 3_600_000,
  categoryId: "cgallerychillers0000000000",
};

const MADE_TO_ORDER: ProductResultView = {
  kind: "product",
  id: "gallery-product-2",
  slug: "wafer-butterfly-valve-dn100-cast-iron",
  name: "Wafer butterfly valve DN100, cast iron",
  businessSlug: "technopump-trading",
  businessName: "Technopump Trading",
  summary: null,
  availability: t("availability.made_to_order"),
  inStock: false,
  place: null,
  chips: ["DN100 · 4 inch"],
  replyMs: null,
  categoryId: "cgalleryvalves00000000000",
};

/* A rail from documents, through the page's own counting. */
const rows = new Set(["engagement_type", "turnaround", "fee_basis", "delivered_where", "sectors"]);
const svc = (fee: string, delivered: string, turnaround: string) => ({
  engagement: "ongoing_contract",
  turnaround,
  fee,
  delivered,
  sectors: ["trading"],
  filterable: rows,
});
const DUBAI: PlaceValues = { emirates: ["dubai"], areaIds: ["area-deira"], wideEmirates: [] };
const NOWHERE: PlaceValues = { emirates: [], areaIds: [], wideEmirates: [] };
const base = {
  place: DUBAI,
  freeZone: NOWHERE,
  verificationTier: 2,
  responseTimeMedianMs: 2 * 3_600_000,
  establishedYear: 2012,
  products: [],
};

const DOCS: SearchDoc[] = [
  { ...base, id: "service:1", kind: "service", rowId: "1", businessId: "a", services: [svc("per_return", "remote", "5 working days")], credentials: ["fta_tax_agent"] },
  { ...base, id: "service:2", kind: "service", rowId: "2", businessId: "b", services: [svc("retainer", "at_our_office", "2 weeks")], credentials: ["fta_tax_agent"] },
  { ...base, id: "service:3", kind: "service", rowId: "3", businessId: "c", services: [svc("per_return", "on_site", "2 weeks")], credentials: [] },
  {
    ...base,
    id: "product:1",
    kind: "product",
    rowId: "p",
    businessId: "d",
    services: [],
    products: [{ availability: "in_stock", spec: {}, categoryId: "cat" }],
    credentials: [],
  },
  { ...base, id: "supplier:a", kind: "supplier", rowId: "a", businessId: "a", services: [svc("per_return", "remote", "5 working days")], credentials: ["fta_tax_agent"] },
  { ...base, id: "supplier:b", kind: "supplier", rowId: "b", businessId: "b", services: [svc("retainer", "at_our_office", "2 weeks")], credentials: ["fta_tax_agent"] },
  { ...base, id: "supplier:c", kind: "supplier", rowId: "c", businessId: "c", services: [svc("per_return", "on_site", "2 weeks")], credentials: [] },
  {
    ...base,
    id: "supplier:d",
    kind: "supplier",
    rowId: "d",
    businessId: "d",
    services: [],
    products: [{ availability: "in_stock", spec: {}, categoryId: "cat" }],
    credentials: [],
  },
];

const vocabulary: FacetVocabulary = {
  groupLabel: {
    emirate: t("facet.emirate"),
    tier: t("facet.tier"),
    freeZone: t("facet.free_zone"),
    availability: t("facet.availability"),
    ...Object.fromEntries(
      SERVICE_FACET_KEYS.map((key) => [key, t(`search_blended.facet.${key}` as "search_blended.facet.fee")]),
    ),
  },
  option: {
    emirate: new Map([["dubai", { label: t("emirate.dubai"), order: 0 }]]),
    tier: new Map([["2", { label: t("search_blended.facet_option.verified"), order: 0 }]]),
    availability: new Map([["in_stock", { label: t("availability.in_stock"), order: 0 }]]),
    engagement: new Map([["ongoing_contract", { label: t("engagement.ongoing_contract"), order: 0 }]]),
    turnaround: new Map([
      ["5 working days", { label: "5 working days", order: 0 }],
      ["2 weeks", { label: "2 weeks", order: 0 }],
    ]),
    fee: new Map([
      ["per_return", { label: "Per return", order: 0 }],
      ["retainer", { label: "Retainer", order: 2 }],
    ]),
    delivered: new Map([
      ["remote", { label: t("search_blended.delivered.remote"), order: 0 }],
      ["at_our_office", { label: t("search_blended.delivered.at_our_office"), order: 1 }],
      ["on_site", { label: t("search_blended.delivered.on_site"), order: 2 }],
    ]),
    credential: new Map([["fta_tax_agent", { label: t("credentials_public.kind.fta_tax_agent"), order: 0 }]]),
    sector: new Map([["trading", { label: "Trading", order: 0 }]]),
  },
  freeText: new Set(["turnaround", "sector"]),
  order: {
    shared: ["emirate", "tier", "freeZone"],
    products: ["availability"],
    services: [...SERVICE_FACET_KEYS],
  },
  multi: new Set(["availability", ...SERVICE_FACET_KEYS]),
};

const FILTERED = parseSearchQuery({ q: "vat return filing", emirate: "dubai", credential: "fta_tax_agent" });
const EMPTIED = parseSearchQuery({ q: "vat return filing", credential: "fta_tax_agent", delivered: "on_site" });
const ON_PRODUCTS = parseSearchQuery({ q: "vat return filing", kind: "products" });

const applied: BlendedFilters = {
  ...emptyFilters(),
  services: { ...emptyServiceFacets(), credential: ["fta_tax_agent"] },
};
const emptied: BlendedFilters = {
  ...emptyFilters(),
  services: { ...emptyServiceFacets(), credential: ["fta_tax_agent"], delivered: ["on_site"] },
};

const AS_DRAWN: TabCounts = { all: 312, products: 148, services: 164, suppliers: 96 };
const GOODS_ONLY: TabCounts = { all: 150, products: 148, services: 0, suppliers: 44 };

function TabRow({
  counts,
  current,
  label,
}: {
  counts: TabCounts;
  current?: "services" | "products";
  label: string;
}) {
  return (
    <Tabs
      as="a"
      variant="line"
      label={label}
      active={current ?? "all"}
      items={visibleTabs(counts, current).map((tab) => ({
        key: tab,
        label: t(`search_blended.tab.${tab}` as "search_blended.tab.all"),
        badge: counts[tab],
        href: `/search?q=vat+return+filing${tab === "all" ? "" : `&kind=${tab}`}`,
      }))}
    />
  );
}

/** One result, filled in as far as a specimen needs. */
function result(overrides: Partial<BlendedSearchResult>): BlendedSearchResult {
  return {
    counts: AS_DRAWN,
    breakdown: { products: 148, productSuppliers: 44, services: 164, serviceSuppliers: 71 },
    active: "all",
    rail: facetRail(DOCS, emptyFilters(), vocabulary, "all"),
    rows: [],
    narrowedTotal: 312,
    unfilteredTotal: 312,
    zero: "none",
    elsewhere: [],
    ladder: [],
    appliedGroups: 0,
    overflow: [],
    rfq: null,
    escape: null,
    pager: pagerFor(1, 20, 312),
    specMatched: true,
    specTrade: null,
    ...overrides,
  };
}

const ZERO_NOTHING = result({
  counts: { all: 0, products: 0, services: 0, suppliers: 0 },
  breakdown: { products: 0, productSuppliers: 0, services: 0, serviceSuppliers: 0 },
  rail: facetRail(DOCS, emptied, vocabulary, "all"),
  narrowedTotal: 0,
  unfilteredTotal: DOCS.length,
  zero: "nothing",
  ladder: [
    { key: "delivered", label: t("search_blended.facet.delivered"), yields: 41 },
    { key: "credential", label: t("search_blended.facet.credential"), yields: 12 },
  ],
  appliedGroups: 2,
  escape: { href: "/rfq/new?category=vat-and-tax", suppliers: 8, cap: 8 },
  pager: pagerFor(1, 0, 0),
  specMatched: false,
});

const ZERO_IN_KIND = result({
  counts: { all: 164, products: 0, services: 164, suppliers: 71 },
  breakdown: { products: 0, productSuppliers: 0, services: 164, serviceSuppliers: 71 },
  active: "products",
  narrowedTotal: 0,
  zero: "kind",
  elsewhere: ["services", "suppliers"],
  pager: pagerFor(1, 0, 0),
  specMatched: false,
});

export function BlendedSearchGallery() {
  const railFiltered = facetRail(DOCS, applied, vocabulary, "all");
  const counted = tabCounts(DOCS);
  const breakdown = kindBreakdown(DOCS);

  return (
    <Section
      id="blended-search"
      title="blended-search"
      note="boards 1c-s · 10c · 10c-s — one set, three shapes, a three-part rail and three zero states"
    >
      <States label="service row" stack>
        <div className="w-full">
          <BlendedResultList copy={CODE_COPIES} rows={[SERVICE, THIN_SERVICE]} />
        </div>
      </States>

      <States label="supplier row" stack>
        <div className="w-full">
          <BlendedResultList copy={CODE_COPIES} rows={[SUPPLIER, NAME_ONLY]} />
        </div>
      </States>

      <States label="product row" stack>
        <div className="w-full">
          <BlendedResultList
            copy={CODE_COPIES}
            rows={[PRODUCT, MADE_TO_ORDER]}
            compare={{
              [PRODUCT.id]: <CompareTick productId={PRODUCT.id} productName={PRODUCT.name} tradeId={PRODUCT.categoryId} />,
            }}
          />
        </div>
      </States>

      <States label="header line" stack>
        <div className="w-full">
          <Breakdown result={result({})} />
        </div>
        <div className="w-full">
          <Breakdown result={result({ breakdown })} />
        </div>
      </States>

      <States label="tabs" stack>
        <div className="w-full">
          <TabRow counts={AS_DRAWN} label="Result kinds, as drawn" />
        </div>
        <div className="w-full">
          <TabRow counts={AS_DRAWN} current="services" label="Result kinds, services tab" />
        </div>
        <div className="w-full">
          <TabRow counts={GOODS_ONLY} label="Result kinds, no services" />
        </div>
        <div className="w-full">
          <TabRow counts={counted} label="Result kinds, from the specimen documents" />
        </div>
      </States>

      <States label="rail, three scopes" stack>
        {railFiltered.map((scope) => (
          <div key={scope.scope} className="w-full">
            <p className="font-mono text-eyebrow uppercase text-faint">
              {t(`search_blended.scope.${scope.scope}` as "search_blended.scope.shared")}
              {scope.narrowsTo !== null ? ` · ${scope.narrowsTo}` : ""}
            </p>
            <div className="mt-2 grid gap-6 sm:grid-cols-3">
              {scope.groups.map((group) => (
                <div key={String(group.key)} className="min-w-0">
                  <p className="text-body-sm text-ink">{group.label}</p>
                  <RailGroup group={group} query={FILTERED} active="all" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </States>

      <States label="rail, options that lead nowhere" stack>
        <div className="grid w-full gap-6 sm:grid-cols-3">
          {facetRail(DOCS, emptied, vocabulary, "all")
            .flatMap((scope) => scope.groups)
            .filter((group) => group.options.some((option) => option.disabled))
            .map((group) => (
              <div key={String(group.key)} className="min-w-0">
                <p className="text-body-sm text-ink">{group.label}</p>
                <RailGroup group={group} query={EMPTIED} active="all" />
              </div>
            ))}
        </div>
      </States>

      {/*
         One specimen each for the sort strip, the pager and the total-zero
         state, and not two.

         Each of them is a landmark — a `nav` with a name, a titled `Panel` —
         and `tests/e2e/landmarks.spec.ts` holds the gallery to one landmark per
         role and name, because a screen reader's landmark list is otherwise a
         row of identical entries. So each shows the variant that contains the
         others: the Products scope carries every sort option, page eight
         carries both directions, and the filtered zero state carries the
         ladder. The variants they leave out are asserted in
         `tests/integration/blended-search-1cs.test.ts`.
      */}
      <States label="sort — products scope, where the fifth option appears" stack>
        <div className="w-full">
          <SortControl query={ON_PRODUCTS} active="products" />
        </div>
      </States>

      <States label="rfq prompt" stack>
        <div className="w-full">
          <RfqPrompt
            result={result({
              rfq: { href: "/rfq/new?category=vat-and-tax&kind=services", cap: 8, measured: 21, withinDay: 14 },
            })}
          />
        </div>
        <div className="w-full">
          <RfqPrompt
            result={result({
              rfq: { href: "/rfq/new?category=vat-and-tax&kind=services", cap: 8, measured: 0, withinDay: 0 },
            })}
          />
        </div>
      </States>

      <States label="pager — mid-list, both directions" stack>
        <div className="w-full">
          <Pager
            query={parseSearchQuery({ q: "vat return filing", page: "8" })}
            result={result({ pager: pagerFor(8, 20, 312) })}
          />
        </div>
      </States>

      <States label="zero — nothing at all, with the ladder" stack>
        <div className="w-full">
          <ZeroNothing query={EMPTIED} result={ZERO_NOTHING} clearAllHref="/search?q=vat+return+filing" />
        </div>
      </States>

      <States label="zero — nothing in this kind" stack>
        <div className="w-full">
          <ZeroInKind query={ON_PRODUCTS} result={ZERO_IN_KIND} />
        </div>
      </States>
    </Section>
  );
}
