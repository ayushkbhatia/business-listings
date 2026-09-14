import { CategoryEditor } from "@/app/(admin)/admin/categories/CategoryEditor";
import { DemandPanel } from "@/app/(admin)/admin/categories/DemandPanel";
import { MergeFigures } from "@/app/(admin)/admin/categories/HeaderActions";
import { TaxonomyTree } from "@/app/(admin)/admin/categories/TaxonomyTree";
import { VisibilityPanel } from "@/app/(admin)/admin/categories/VisibilityPanel";
import type { CategoryEditor as EditorData } from "@/lib/taxonomy/board";
import type { MergePreview } from "@/lib/taxonomy/merge";
import { buildTree, type TreeRow } from "@/lib/taxonomy/tree-model";
import { Section, States } from "../_kit";

/**
 * Board `4d` — the category taxonomy in the states its spec names: as drawn,
 * a sector collapsed, a category with no spec template, a sector at zero
 * listings, a services category, a merge about to run, the read-only seat, and
 * the cold start.
 *
 * Every tree runs through `buildTree`, the function the page uses, so the counts
 * on each specimen add up the way the page's do. Rendered without landmarks —
 * several editors on one page would each claim a region.
 */

let order = 0;
const row = (over: Partial<TreeRow> & Pick<TreeRow, "id" | "name">): TreeRow => ({
  parentId: null,
  nameAr: null,
  slug: over.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
  code: "IN",
  sortOrder: order++,
  synonyms: [],
  showInIndex: true,
  acceptsRfq: true,
  requiresExtraCheck: false,
  ...over,
});

const ROWS: TreeRow[] = [
  row({ id: "auto", name: "Auto parts & garages" }),
  row({ id: "construction", name: "Construction & building materials" }),
  row({ id: "industrial", name: "Industrial & MEP supplies" }),
  row({ id: "hvac", name: "HVAC & refrigeration" }),
  row({ id: "logistics", name: "Logistics & freight forwarding" }),
  row({ id: "it", name: "IT, telecom & software" }),
  row({ id: "education", name: "Education & training" }),
  row({ id: "valves", parentId: "industrial", name: "Valves & actuators", synonyms: ["butterfly valve", "gate valve", "ball valve", "check valve", "صمامات"] }),
  row({ id: "pumps", parentId: "industrial", name: "Pumps & motors" }),
  row({ id: "pipes", parentId: "industrial", name: "Pipes & fittings" }),
  row({ id: "fasteners", parentId: "industrial", name: "Fasteners" }),
  row({ id: "bearings", parentId: "industrial", name: "Bearings & power transmission" }),
  row({ id: "safety", parentId: "industrial", name: "Safety & PPE" }),
  row({ id: "hoses", parentId: "industrial", name: "Industrial hoses", showInIndex: false }),
  ...Array.from({ length: 4 }, (_, index) => row({ id: `more-${index}`, parentId: "industrial", name: `Industrial trade ${index + 1}` })),
  row({ id: "customs", parentId: "logistics", name: "Customs clearance" }),
];

const COUNTS = new Map<string, number>([
  ["auto", 3_412],
  ["construction", 5_108],
  ["valves", 341],
  ["pumps", 298],
  ["pipes", 276],
  ["fasteners", 211],
  ["bearings", 184],
  ["safety", 168],
  ["hoses", 14],
  ["more-0", 120],
  ["more-1", 96],
  ["more-2", 80],
  ["more-3", 54],
  ["hvac", 1_196],
  ["logistics", 1_900],
  ["customs", 177],
  ["it", 2_634],
]);

const TREE = buildTree(ROWS, COUNTS);

const editor = (over: Partial<EditorData>): EditorData => ({
  id: "valves",
  name: "Valves & actuators",
  nameAr: null,
  slug: "valves-actuators",
  code: "IN",
  isSector: false,
  parent: { id: "industrial", name: "Industrial & MEP supplies", slug: "industrial-mep-supplies", requiresExtraCheck: false },
  childCount: 0,
  synonyms: ["butterfly valve", "gate valve", "ball valve", "check valve", "صمامات"],
  sharedSynonyms: [{ term: "gate valve", categories: ["Pipes & fittings"] }],
  showInIndex: true,
  acceptsRfq: true,
  requiresExtraCheck: false,
  index: "listed",
  onHomeGrid: null,
  trade: { kind: "goods", from: "inherited", ancestorName: "Industrial & MEP supplies" },
  templates: [{ id: "t3", name: "Valves & actuators", version: 3, status: "live" }],
  defaultTemplateId: "t3",
  resolvedTemplate: { id: "t3", name: "Valves & actuators", version: 3, origin: "own" },
  demand: { listings: 341, offerings: 8_412, rfqsPerMonth: 1_104, paidSellers: 118 },
  lastChange: { by: "r.haddad", at: new Date("2026-09-12T08:00:00Z"), action: "taxonomy_changed" },
  synonymsChanged: { by: "r.haddad", at: new Date("2026-09-12T08:00:00Z") },
  ...over,
});

function Board({ value, canWrite = true, selectedId }: { value: EditorData; canWrite?: boolean; selectedId: string | null }) {
  return (
    <div className="grid w-full items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <TaxonomyTree tree={TREE} selectedId={selectedId} />
      <div className="flex min-w-0 flex-col gap-4">
        <CategoryEditor editor={value} canWrite={canWrite} landmark={false} />
        <div className="grid items-start gap-4 wide:grid-cols-2">
          <VisibilityPanel editor={value} canWrite={canWrite} sectorAcceptsRfq={value.isSector ? null : true} landmark={false} />
          <DemandPanel editor={value} landmark={false} />
        </div>
      </div>
    </div>
  );
}

const MERGE: MergePreview = {
  source: { id: "hoses", name: "Industrial hoses", slug: "industrial-hoses", isSector: false, parentName: "Industrial & MEP supplies", listings: 14 },
  target: { id: "pipes", name: "Pipes & fittings", slug: "pipes-fittings", isSector: false, parentName: "Industrial & MEP supplies", listings: 276 },
  refusal: null,
  moves: {
    listings: 14,
    unlistedListings: 2,
    secondCategoryLinks: 3,
    products: 212,
    services: 0,
    subcategories: 0,
    areaPages: 2,
    emiratePages: 0,
    pagesKept: 1,
    redirects: 3,
    synonymsAdded: ["Industrial hoses", "hydraulic hose"],
  },
  targetTemplate: { name: "Pipes & fittings", version: 2 },
};

export function TaxonomyGallery() {
  return (
    <Section
      id="category-taxonomy"
      title="Category taxonomy"
      note="Board 4d. Every count is a query and the header is the sum of the tree; the home grid is read, never switched; a merge and an address change write their redirects."
    >
      <States label="As drawn · one sector open, one subcategory selected" stack>
        <Board value={editor({})} selectedId="valves" />
      </States>
      <States label="Sector selected · collapsed siblings, count only" stack>
        <Board
          value={editor({
            id: "logistics",
            name: "Logistics & freight forwarding",
            slug: "logistics-freight-forwarding",
            code: "LG",
            isSector: true,
            parent: null,
            childCount: 1,
            synonyms: ["freight", "شحن"],
            sharedSynonyms: [],
            onHomeGrid: true,
            trade: { kind: "goods", from: "own", ancestorName: null },
            demand: { listings: 2_077, offerings: 1_240, rfqsPerMonth: 388, paidSellers: 402 },
          })}
          selectedId="logistics"
        />
      </States>
      <States label="No spec template · the gap is shown" stack>
        <Board
          value={editor({ id: "hoses", name: "Industrial hoses", slug: "industrial-hoses", synonyms: [], sharedSynonyms: [], templates: [], defaultTemplateId: null, resolvedTemplate: null, showInIndex: false, index: "switched_off", demand: { listings: 14, offerings: 40, rfqsPerMonth: 3, paidSellers: 1 }, synonymsChanged: null })}
          selectedId="hoses"
        />
      </States>
      <States label="Sector at zero listings · out of the index and off the grid" stack>
        <Board
          value={editor({
            id: "education",
            name: "Education & training",
            slug: "education-training",
            code: "ED",
            isSector: true,
            parent: null,
            synonyms: [],
            sharedSynonyms: [],
            index: "no_listings",
            onHomeGrid: false,
            templates: [],
            defaultTemplateId: null,
            resolvedTemplate: null,
            trade: { kind: "services", from: "own", ancestorName: null },
            demand: { listings: 0, offerings: 0, rfqsPerMonth: 0, paidSellers: 0 },
            lastChange: null,
            synonymsChanged: null,
          })}
          selectedId="education"
        />
      </States>
      <States label="Services category · scope sheets, not a catalogue" stack>
        <Board
          value={editor({
            id: "customs",
            name: "Customs clearance",
            slug: "customs-clearance",
            parent: { id: "logistics", name: "Logistics & freight forwarding", slug: "logistics-freight-forwarding", requiresExtraCheck: true },
            synonyms: ["customs broker", "تخليص جمركي"],
            sharedSynonyms: [],
            requiresExtraCheck: false,
            trade: { kind: "services", from: "own", ancestorName: null },
            templates: [],
            defaultTemplateId: null,
            resolvedTemplate: null,
            demand: { listings: 177, offerings: 305, rfqsPerMonth: 61, paidSellers: 44 },
          })}
          selectedId="customs"
        />
      </States>
      <States label="Merge · what moves before the reason is asked" stack>
        <div className="w-full max-w-2xl">
          <MergeFigures preview={MERGE} />
        </div>
      </States>
      <States label="Read only · moderator" stack>
        <Board value={editor({ id: "pumps", name: "Pumps & motors", slug: "pumps-motors", sharedSynonyms: [], synonyms: ["pump"] })} canWrite={false} selectedId="pumps" />
      </States>
      <States label="Cold start · a thin tree reads honest" stack>
        <div className="grid w-full items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
          <TaxonomyTree
            tree={buildTree(
              [row({ id: "cold-a", name: "Valves & fittings" }), row({ id: "cold-b", name: "Pipes & tubing" }), row({ id: "cold-c", parentId: "cold-a", name: "Gate valves" })],
              new Map([["cold-c", 3], ["cold-a", 1]]),
            )}
            selectedId="cold-c"
          />
          <DemandPanel
            editor={editor({ id: "cold-c", name: "Gate valves", demand: { listings: 3, offerings: 0, rfqsPerMonth: 0, paidSellers: 0 } })}
            landmark={false}
          />
        </div>
      </States>
    </Section>
  );
}
