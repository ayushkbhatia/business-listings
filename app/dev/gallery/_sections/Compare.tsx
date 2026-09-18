import { buildComparison, visibleRows, type CompareField, type CompareProduct } from "@/lib/compare/table";
import { EMPTY_TRAY, compareHref, type CompareChange, type Tray } from "@/lib/compare/tray";
import { t } from "@/lib/i18n";
import {
  CompareEmpty,
  CompareHeader,
  CompareNeedsMore,
  CompareNotices,
  CompareSummary,
  ComparisonTable,
  type CompareColumn,
} from "@/app/(public)/compare/_view";
import { CompareTick } from "@/app/(public)/_compare/CompareTick";
import { TrayContents } from "@/app/(public)/_compare/CompareTray";
import { Frame, Section, Specimen, States } from "../_kit";

/**
 * Board `10d` — the product comparison, in every state the page and the tray
 * can be in.
 *
 * The table is built by `buildComparison` from the board's own fixture — four
 * butterfly valves, the size written three ways, one seat left blank, one field
 * nobody filled — so the tints shown are the ones the rule computes, not ones a
 * specimen painted. Headings are `h2` here: the gallery has its `h1`.
 *
 * Two tables, not three, and each with its own caption: the table is a named
 * region, and a gallery that draws one region twice under one name is the
 * duplicate-landmark defect the axe pass fails.
 */

const VALVES = { id: "gallery-trade-valves", name: "Butterfly valves" };
const PUMPS = { id: "gallery-trade-pumps", name: "Centrifugal pumps" };

const field = (id: string, label: string, overrides: Partial<CompareField> = {}): CompareField => ({
  id,
  key: id,
  label,
  unit: null,
  type: "text",
  isFilterable: true,
  options: [],
  ...overrides,
});

const FIELDS: CompareField[] = [
  field("size", "Nominal size"),
  field("end", "End connection", { type: "select", options: ["Grooved, AWWA C606", "Lugged wafer", "Wafer"] }),
  field("body", "Body material", { type: "select", options: ["Ductile iron GGG40", "Ductile iron", "Cast iron GG25"] }),
  field("disc", "Disc material"),
  field("seat", "Seat material"),
  field("pressure", "Pressure rating"),
  field("cert", "Certification"),
  field("coating", "Coating"),
];

const COLUMNS: CompareColumn[] = [
  column("gallery-cmp-1", "Grooved butterfly valve DN100", "Al Waha Industrial Supplies", 2),
  column("gallery-cmp-2", "Lugged butterfly valve 4\"", "Emirates Valve Trading", 2),
  column("gallery-cmp-3", "Fire-rated butterfly valve DN100", "Gulf Flow Controls", 1),
  column("gallery-cmp-4", "Wafer butterfly valve 4 inch", "Sharjah Pipeline Supply", 0),
];

function column(id: string, name: string, seller: string, tier: number): CompareColumn {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id,
    slug,
    name,
    businessSlug: seller.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    seller,
    verificationTier: tier,
    verifiedAt: tier > 0 ? "2026-08-14T08:00:00.000Z" : null,
    imageUrl: null,
  };
}

const product = (id: string, spec: Record<string, string>, overrides: Partial<CompareProduct> = {}): CompareProduct => ({
  id,
  specValues: spec,
  availability: "in_stock",
  stockQty: null,
  leadTimeDays: null,
  replyMs: null,
  ...overrides,
});

const PRODUCTS: CompareProduct[] = [
  product(
    "gallery-cmp-1",
    { size: "DN100", end: "Grooved, AWWA C606", body: "Ductile iron GGG40", disc: "Stainless 316", seat: "EPDM", pressure: "PN16", cert: "UL/FM, Civil Defence" },
    { stockQty: 240, replyMs: 2 * 3_600_000 },
  ),
  product(
    "gallery-cmp-2",
    { size: '4"', end: "Lugged wafer", body: "Ductile iron", disc: "Stainless 316", seat: "EPDM", pressure: "232 psi", cert: "UL listed" },
    { replyMs: 26 * 3_600_000 },
  ),
  product(
    "gallery-cmp-3",
    { size: "DN100", end: "Grooved, AWWA C606", body: "Ductile iron GGG40", disc: "Stainless 316", seat: "EPDM", pressure: "PN16", cert: "UL/FM, Civil Defence" },
    { availability: "indent", leadTimeDays: 42, replyMs: 5 * 3_600_000 },
  ),
  product(
    "gallery-cmp-4",
    { size: "4 inch", end: "Wafer", body: "Cast iron GG25", pressure: "PN16" },
    { availability: "made_to_order", leadTimeDays: 14 },
  ),
];

const LABELS = {
  availability: t("compare.row_availability"),
  reply: t("compare.row_reply"),
  completeness: t("compare.row_completeness"),
};

const COMPARISON = buildComparison(FIELDS, PRODUCTS, LABELS);
const SET = COLUMNS.map((entry) => entry.id);
const ASK_ALL = `/rfq/new?to=${COLUMNS.map((entry) => entry.businessSlug).join(",")}&products=${SET.join(",")}`;

const held = (n: number) => ({ id: `cgalleryheld${String(n).padStart(14, "0")}`, name: COLUMNS[n - 1]!.name, seller: COLUMNS[n - 1]!.seller });
const trayOf = (...ns: number[]): Tray => ({ trade: VALVES, items: ns.map(held) });

const REPLACED: CompareChange = {
  outcome: "replaced",
  tray: { trade: PUMPS, items: [{ id: "cgallerypump000000000001", name: "End-suction pump 7.5 kW", seller: "Gulf Flow Controls" }] },
  dropped: 3,
  productId: "cgallerypump000000000001",
};

const UNAVAILABLE: CompareChange = { outcome: "unavailable", tray: trayOf(1, 2), dropped: 0, productId: null };

export function CompareGallery() {
  return (
    <Section
      id="product-comparison"
      title="Product comparison"
      note="Board 10d — the table, its states, the tick and the tray"
    >
      <States label="Header" stack>
        <div className="w-full">
          <CompareHeader
            columns={COLUMNS}
            trade={VALVES.name}
            hasTemplate
            hideMatching={false}
            toggleHref={`${compareHref(SET)}&diff=1`}
            askAllHref={ASK_ALL}
            headingLevel={2}
          />
        </div>
      </States>

      <States label="Every row" stack>
        <div className="w-full">
          <ComparisonTable
            columns={COLUMNS}
            rows={COMPARISON.rows}
            set={SET}
            hideMatching={false}
            captionId="gallery-compare-all"
            caption={t("compare.caption", { count: 4, formatted: "4", trade: VALVES.name })}
          />
          <CompareSummary deciding={COMPARISON.deciding} hasTemplate />
        </div>
      </States>

      <States label="Matching hidden" stack>
        <div className="w-full">
          <ComparisonTable
            columns={COLUMNS}
            rows={visibleRows(COMPARISON, true)}
            set={SET}
            hideMatching
            captionId="gallery-compare-differs"
            caption={t("compare.caption_differs", { count: 4, formatted: "4", trade: VALVES.name })}
          />
        </div>
      </States>

      <States label="Summary" stack>
        <Specimen caption="nothing differs">
          <CompareSummary deciding={0} hasTemplate />
        </Specimen>
        <Specimen caption="trade with no template">
          <CompareSummary deciding={0} hasTemplate={false} />
        </Specimen>
      </States>

      <States label="Left out" stack>
        <div className="w-full">
          <CompareNotices
            delisted={1}
            otherTrade={[{ id: "gallery-other", name: "End-suction pump 7.5 kW", trade: PUMPS.name }]}
            overflow={2}
            trade={VALVES.name}
          />
        </div>
      </States>

      <States label="One product" stack>
        <div className="w-full">
          <CompareNeedsMore trade={VALVES.name} />
        </div>
      </States>

      <States label="Empty" stack>
        <CompareEmpty headingLevel={2} />
      </States>

      <States label="Tick">
        <Specimen caption="add">
          <CompareTick productId="cgalleryheld00000000000009" productName="Wafer butterfly valve DN150" tradeId={VALVES.id} tray={EMPTY_TRAY} />
        </Specimen>
        <Specimen caption="in the comparison">
          <CompareTick productId={held(1).id} productName={held(1).name} tradeId={VALVES.id} tray={trayOf(1, 2)} />
        </Specimen>
        <Specimen caption="another trade held">
          <CompareTick productId="cgallerypump000000000001" productName="End-suction pump 7.5 kW" tradeId={PUMPS.id} tray={trayOf(1, 2, 3)} />
        </Specimen>
        <Specimen caption="full — refused, four named">
          <CompareTick productId="cgalleryheld00000000000009" productName="Wafer butterfly valve DN150" tradeId={VALVES.id} tray={trayOf(1, 2, 3, 4)} />
        </Specimen>
      </States>

      <States label="Tray" stack>
        <Specimen caption="one held — needs one more">
          <Frame>
            <TrayContents tray={trayOf(1)} notice={null} />
          </Frame>
        </Specimen>
        <Specimen caption="three held">
          <Frame>
            <TrayContents tray={trayOf(1, 2, 3)} notice={null} />
          </Frame>
        </Specimen>
        <Specimen caption="four held — full">
          <Frame>
            <TrayContents tray={trayOf(1, 2, 3, 4)} notice={null} />
          </Frame>
        </Specimen>
        <Specimen caption="another trade started a new one">
          <Frame>
            <TrayContents tray={REPLACED.tray} notice={REPLACED} />
          </Frame>
        </Specimen>
        <Specimen caption="product no longer listed">
          <Frame>
            <TrayContents tray={UNAVAILABLE.tray} notice={UNAVAILABLE} />
          </Frame>
        </Specimen>
      </States>
    </Section>
  );
}
