import { renderSection } from "@/components/storefront";
import { SectionLibraryRail } from "@/components/domain/SectionLibraryRail";
import { sectionLibrary } from "@/lib/storefront/library";
import type { SectionData } from "@/lib/storefront/render-data";
import { sectionType } from "@/lib/storefront/section-types";
import type { ResolvedSection } from "@/lib/storefront/sections";
import { SPECIMEN_DATA, SPECIMEN_WORK_DATA } from "@/lib/storefront/specimen-data";
import { Section, States } from "../_kit";

/**
 * Board `5c-s` — the section library filtered by trade kind, and the services
 * sections it offers, in every state the board documents.
 *
 * The library rail for a services template, a goods one and one whose stores
 * sell both (B9); then each live services section typical, with one service,
 * with gaps (B6), with nothing published in a preview, and the held process
 * steps card (B3). A state that exists only in the running app is a state
 * nobody reviews.
 */

const sectionOf = (type: string, settings: unknown = {}): ResolvedSection => {
  const definition = sectionType(type)!;
  return {
    id: `gallery-${type}`,
    type,
    sortOrder: 0,
    enabled: true,
    fixed: definition.fixed,
    singleton: definition.singleton,
    sellerEditableFields: [],
    showOnMobile: true,
    settings,
    definition,
  };
};

const draw = (type: string, data: SectionData, options: { settings?: unknown; preview?: boolean } = {}) =>
  renderSection({
    section: sectionOf(type, options.settings),
    data,
    content: {},
    enquireHref: "#enquire",
    preview: options.preview ?? false,
  });

const ONE_SERVICE: SectionData = {
  ...SPECIMEN_WORK_DATA,
  work: { ...SPECIMEN_WORK_DATA.work!, services: SPECIMEN_WORK_DATA.work!.services.slice(0, 1) },
};

const NOTHING_PUBLISHED: SectionData = {
  ...SPECIMEN_WORK_DATA,
  work: { ...SPECIMEN_WORK_DATA.work!, services: [], credentials: [], sectors: [] },
};

const hrefs = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, `#builder-section-${key}`]));
const allKeys = sectionLibrary("both", []).flatMap((group) => group.entries.map((entry) => entry.type.key));

export function BuilderSectionsGallery() {
  return (
    <>
      <Section id="section-library-rail" title="section-library-rail" note="board 5c-s · filtered by trade kind, unavailable disabled with the reason">
        <div className="grid gap-6 lg:grid-cols-3">
          <SectionLibraryRail
            navLabel="Section library — services template"
            scope="services"
            groups={sectionLibrary("services", [{ type: "hero" }, { type: "scope_grid" }])}
            selectedKey="scope_grid"
            hrefs={hrefs(allKeys)}
          />
          <SectionLibraryRail
            navLabel="Section library — goods template"
            scope="goods"
            groups={sectionLibrary("goods", [{ type: "catalogue_grid" }])}
            selectedKey="catalogue_grid"
            hrefs={hrefs(allKeys)}
          />
          <SectionLibraryRail
            navLabel="Section library — both, neither disabled"
            scope="both"
            groups={sectionLibrary("both", [])}
            selectedKey={null}
            hrefs={hrefs(allKeys)}
          />
        </div>
      </Section>

      <Section id="builder-scope-grid" title="builder-scope-grid" note="board 5c-s · a view over scope sheets, gaps read Not stated">
        <States label="typical — fee basis and turnaround, the unset fee basis reading Not stated" stack>
          <div className="w-full">{draw("scope_grid", SPECIMEN_WORK_DATA)}</div>
        </States>
        <States label="all four columns, rearranged" stack>
          <div className="w-full">
            {draw("scope_grid", SPECIMEN_WORK_DATA, {
              settings: { columns: ["engagement", "delivered", "turnaround", "fee_basis"] },
            })}
          </div>
        </States>
        <States label="one service — column headers retained" stack>
          <div className="w-full">{draw("scope_grid", ONE_SERVICE)}</div>
        </States>
        <States label="no services published — preview says why" stack>
          <div className="w-full">{draw("scope_grid", NOTHING_PUBLISHED, { preview: true })}</div>
        </States>
      </Section>

      <Section id="builder-credential-wall" title="builder-credential-wall" note="board 5c-s · the shared credential table, configured by which rows">
        <States label="every credential" stack>
          <div className="w-full">{draw("credential_wall", SPECIMEN_WORK_DATA)}</div>
        </States>
        <States label="checked ones only" stack>
          <div className="w-full">{draw("credential_wall", SPECIMEN_WORK_DATA, { settings: { show: "verified" } })}</div>
        </States>
        <States label="no credentials — preview routes to where they are added" stack>
          <div className="w-full">{draw("credential_wall", NOTHING_PUBLISHED, { preview: true })}</div>
        </States>
      </Section>

      <Section id="builder-coverage" title="builder-coverage" note="board 5c-s · rows, never a map or a pin (B7)">
        <States label="one row per service" stack>
          <div className="w-full">{draw("coverage", SPECIMEN_WORK_DATA)}</div>
        </States>
        <States label="the union, as a line" stack>
          <div className="w-full">{draw("coverage", SPECIMEN_WORK_DATA, { settings: { rows: "union" } })}</div>
        </States>
        <States label="no services published — preview" stack>
          <div className="w-full">{draw("coverage", NOTHING_PUBLISHED, { preview: true })}</div>
        </States>
      </Section>

      <Section id="builder-sectors-served" title="builder-sectors-served" note="board 5c-s · display only, and process steps held for Q1">
        <States label="declared sectors" stack>
          <div className="w-full">{draw("sectors_served", SPECIMEN_WORK_DATA)}</div>
        </States>
        <States label="none declared — preview" stack>
          <div className="w-full">{draw("sectors_served", NOTHING_PUBLISHED, { preview: true })}</div>
        </States>
        <States label="process steps — held, with the decision named" stack>
          <div className="w-full">{draw("process_steps", SPECIMEN_WORK_DATA)}</div>
        </States>
      </Section>

      <Section id="builder-shared-by-kind" title="builder-shared-by-kind" note="board 5c-s B5 · shared in layout, not in copy">
        <States label="reviews — goods, then work">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <div>{draw("reviews", SPECIMEN_DATA)}</div>
            <div>{draw("reviews", SPECIMEN_WORK_DATA)}</div>
          </div>
        </States>
        <States label="enquiry form — goods, then work">
          <div className="grid w-full gap-4 md:grid-cols-2">
            <div>{draw("enquiry_form", SPECIMEN_DATA)}</div>
            <div>{draw("enquiry_form", SPECIMEN_WORK_DATA)}</div>
          </div>
        </States>
      </Section>
    </>
  );
}
