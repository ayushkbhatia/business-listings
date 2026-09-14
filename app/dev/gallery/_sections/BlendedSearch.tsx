import { BlendedResultList } from "@/components/domain/BlendedResultRows";
import { Tabs } from "@/components/structure";
import { t } from "@/lib/i18n";
import { facetRail, visibleTabs, type FacetVocabulary, type SearchDoc, type TabCounts } from "@/lib/search/blended";
import type {
  BlendedSearchResult,
  BusinessResultView,
  ProductResultView,
  ServiceResultView,
} from "@/lib/search/blended-views";
import { SERVICE_FACET_KEYS, emptyServiceFacets, parseSearchQuery } from "@/lib/search/query";
import { RailGroup, RfqPrompt, ZeroAfterFiltering } from "@/app/(public)/search/_blended-view";
import { Section, States } from "../_kit";

/**
 * Board `1c-s` — blended search, in every documented state the page can be in.
 *
 * The rows are the page's own components from fixed values; the tabs, the rail
 * groups, the RFQ prompt and the zero-after-filtering card are the page's own
 * parts. The rail's counts go through `facetRail` over a small document set, the
 * function the page uses, so a specimen cannot show a count the rule would not
 * produce. No `h1` and no filter `aside` here: the gallery has its own, and a
 * second one is a duplicate landmark.
 */

const firm = {
  checkedCredentials: ["fta_tax_agent"],
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

const FIRM: BusinessResultView = {
  kind: "business",
  id: "gallery-business-1",
  businessSlug: "ardent-audit-and-advisory",
  businessName: "Ardent Audit & Advisory",
  place: "Deira · Dubai",
  replyMs: 4 * 3_600_000,
  summary: "Audit, VAT and corporate tax for trading companies and free zone entities.",
  sellsWork: true,
  teamLabel: t("search_blended.team", { band: t("storefront.team_band.b11_50") }),
  services: { names: ["VAT return filing", "Statutory audit"], total: 6 },
  matchedOnService: true,
  productCount: 0,
  ...firm,
};

const GOODS_FIRM: BusinessResultView = {
  kind: "business",
  id: "gallery-business-2",
  businessSlug: "emirates-software-trading",
  businessName: "Emirates Software Trading",
  place: "Deira · Dubai",
  replyMs: null,
  summary: "Accounting and point-of-sale software licences for small businesses.",
  sellsWork: false,
  teamLabel: null,
  services: null,
  matchedOnService: false,
  productCount: 14,
  checkedCredentials: [],
  verificationTier: 2,
  verifiedAt: "2026-03-01T08:00:00.000Z",
  rating: null,
};

const PRODUCT: ProductResultView = {
  kind: "product",
  id: "gallery-product-1",
  slug: "zoho-books-vat-return-filing-licence-1-year",
  name: "Zoho Books VAT return filing licence, 1 year",
  businessSlug: "emirates-software-trading",
  businessName: "Emirates Software Trading",
  summary: "One-year licence for the FTA-compliant edition, with the VAT return report and audit file included.",
  availability: t("availability.in_stock"),
  place: "Deira · Dubai",
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
const DOCS: SearchDoc[] = [
  { id: "service:1", kind: "service", rowId: "1", businessId: "a", services: [svc("per_return", "remote", "5 working days")], credentials: ["fta_tax_agent"] },
  { id: "service:2", kind: "service", rowId: "2", businessId: "b", services: [svc("retainer", "at_our_office", "2 weeks")], credentials: ["fta_tax_agent"] },
  { id: "service:3", kind: "service", rowId: "3", businessId: "c", services: [svc("per_return", "on_site", "2 weeks")], credentials: [] },
  { id: "business:a", kind: "business", rowId: "a", businessId: "a", services: [svc("per_return", "remote", "5 working days")], credentials: ["fta_tax_agent"] },
  { id: "product:1", kind: "product", rowId: "p", businessId: "d", services: [], credentials: [] },
];

const vocabulary: FacetVocabulary = {
  groupLabel: Object.fromEntries(
    SERVICE_FACET_KEYS.map((key) => [key, t(`search_blended.facet.${key}` as "search_blended.facet.fee")]),
  ) as FacetVocabulary["groupLabel"],
  option: {
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
};

const FILTERED = parseSearchQuery({ q: "vat return filing", emirate: "dubai", credential: "fta_tax_agent" });
const EMPTIED = parseSearchQuery({ q: "vat return filing", credential: "fta_tax_agent", delivered: "on_site" });

const AS_DRAWN: TabCounts = { all: 61, services: 38, businesses: 21, products: 2 };
const GOODS_ONLY: TabCounts = { all: 23, services: 0, businesses: 21, products: 2 };

function TabRow({ counts, current, label }: { counts: TabCounts; current?: "services"; label: string }) {
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

const ZERO: BlendedSearchResult = {
  counts: { all: 0, services: 0, businesses: 0, products: 0 },
  rail: facetRail(DOCS, { ...emptyServiceFacets(), credential: ["fta_tax_agent"], delivered: ["on_site"] }, vocabulary),
  rows: [],
  narrowedTotal: 0,
  unfilteredTotal: DOCS.length,
  suggestion: { key: "delivered", yields: 3 },
  overflow: [],
  rfq: null,
};

export function BlendedSearchGallery() {
  const railFiltered = facetRail(DOCS, { ...emptyServiceFacets(), credential: ["fta_tax_agent"] }, vocabulary);

  return (
    <Section id="blended-search" title="blended-search" note="board 1c-s · one set, three shapes, no price or stock facet">
      <States label="service row" stack>
        <div className="w-full">
          <BlendedResultList rows={[SERVICE, THIN_SERVICE]} />
        </div>
      </States>

      <States label="business row" stack>
        <div className="w-full">
          <BlendedResultList rows={[FIRM, GOODS_FIRM]} />
        </div>
      </States>

      <States label="product row" stack>
        <div className="w-full">
          <BlendedResultList rows={[PRODUCT]} />
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
      </States>

      <States label="rail, filtered" stack>
        <div className="grid w-full gap-6 sm:grid-cols-3">
          {railFiltered.map((group) => (
            <div key={group.key} className="min-w-0">
              <p className="font-mono text-eyebrow uppercase text-faint">{group.label}</p>
              <RailGroup group={group} query={FILTERED} />
            </div>
          ))}
        </div>
      </States>

      <States label="rfq prompt" stack>
        <div className="w-full">
          <RfqPrompt rfq={{ href: "/rfq/new?category=vat-and-tax&kind=services", cap: 8, measured: 21, withinDay: 14 }} />
        </div>
        <div className="w-full">
          <RfqPrompt rfq={{ href: "/rfq/new?category=vat-and-tax&kind=services", cap: 8, measured: 0, withinDay: 0 }} />
        </div>
      </States>

      <States label="zero after filtering" stack>
        <div className="w-full">
          <ZeroAfterFiltering query={EMPTIED} result={ZERO} clearAllHref="/search?q=vat+return+filing" />
        </div>
      </States>
    </Section>
  );
}
