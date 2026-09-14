import { CallBoard } from "@/app/(admin)/admin/crm/CallBoard";
import { bannerView, presentCrm } from "@/app/(admin)/admin/crm/present";
import type { CrmBoard, CrmRow, HeldScopeBanner } from "@/lib/crm/board";
import { SCRIPT_IDS } from "@/lib/crm/scripts";
import type { SignalFacts } from "@/lib/crm/model";
import { Section, States } from "../_kit";

/**
 * Board `12d` — the call list in the states its spec names: as drawn, a queue
 * with nothing due, the list never built, and the banner in each shape its
 * supply arithmetic can take.
 *
 * Every specimen runs through `presentCrm` and `bannerView`, the functions the
 * page uses, so a figure that does not derive here does not derive on the
 * console either. The board is rendered without the page's titled chrome — a
 * titled panel is a landmark, and the gallery shows several of these.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const DAY = 86_400_000;

const held = (over: Partial<Extract<SignalFacts, { kind: "held_page" }>> = {}): Extract<SignalFacts, { kind: "held_page" }> => ({
  kind: "held_page",
  areaId: "area-bb",
  areaName: "Business Bay",
  categoryId: "cat-hvac",
  categoryName: "HVAC",
  path: "/dubai/business-bay/hvac",
  listings: 78,
  verified: 8,
  need: 60,
  minVerifiedShare: 0.3,
  introWords: 0,
  minIntroWords: 250,
  unverified: 70,
  monthlySearches: 3_940,
  failing: ["verified", "copy"],
  tradeSearchesWeek: 8,
  tradeName: "Chiller AMC",
  claimed: false,
  ...over,
});

function row(over: Partial<CrmRow> & Pick<CrmRow, "id" | "displayName" | "facts" | "signal">): CrmRow {
  return {
    businessId: over.id,
    licenceNumber: "DED-882104",
    areaName: "Business Bay",
    phoneMasked: "04 44• ••••",
    claimStatus: "unclaimed",
    planId: null,
    signalValue: 8,
    demandScore: 3_940,
    state: "queued",
    due: true,
    callBackAt: null,
    lastTouchAt: null,
    lastOutcome: null,
    mine: false,
    action: "call",
    scriptId: "held_page.claim.v1",
    ...over,
  };
}

const ROWS: CrmRow[] = [
  row({ id: "g-emirates", displayName: "Emirates Climate Control", signal: "held_page", facts: held() }),
  row({
    id: "g-skyline",
    displayName: "Skyline Air Systems",
    signal: "cap_reached",
    licenceNumber: "DED-771902",
    areaName: "Al Quoz 4",
    claimStatus: "claimed",
    planId: "free",
    facts: { kind: "cap_reached", cap: "enquiry_cap", missedEnquiries30d: 8, refusedAt: null, refusedAttempted: null, refusedCap: null, planId: "free" },
    signalValue: 8,
    demandScore: 8,
    state: "unreachable",
    lastTouchAt: new Date(NOW.getTime() - 4 * DAY),
    lastOutcome: "no_answer",
    scriptId: "cap_reached.enquiry.v1",
  }),
  row({
    id: "g-cooltech",
    displayName: "Cool Tech Contracting",
    signal: "held_page",
    licenceNumber: "DED-441120",
    facts: held({ tradeSearchesWeek: 0 }),
    state: "callback",
    due: false,
    callBackAt: new Date(NOW.getTime() + 3 * DAY),
    lastTouchAt: new Date(NOW.getTime() - 3 * DAY),
    lastOutcome: "call_back",
    mine: true,
    scriptId: "held_page.claim_no_number.v1",
  }),
  row({
    id: "g-arctic",
    displayName: "Arctic Line Refrigeration",
    signal: "cap_reached",
    licenceNumber: "DED-330118",
    areaName: "Al Quoz 2",
    phoneMasked: null,
    claimStatus: "claimed",
    planId: "basic",
    facts: { kind: "cap_reached", cap: "product_cap", missedEnquiries30d: 0, refusedAt: "2026-09-08T08:00:00.000Z", refusedAttempted: 12, refusedCap: 50, planId: "basic" },
    signalValue: 12,
    demandScore: 0,
    state: "called",
    due: false,
    lastTouchAt: new Date(NOW.getTime() - DAY),
    lastOutcome: "interested",
    action: "follow_up",
    scriptId: "cap_reached.product.v1",
  }),
  row({
    id: "g-technopump",
    displayName: "Technopump Trading LLC",
    signal: "churn_risk",
    licenceNumber: "DED-330218",
    areaName: "DIP 2",
    claimStatus: "claimed",
    planId: "basic",
    facts: { kind: "churn_risk", replyRate: 0.34, replySample: 12, renewsAt: "2026-09-28T08:00:00.000Z", planId: "basic" },
    signalValue: 34,
    demandScore: 8,
    action: "save",
    scriptId: "churn_risk.v1",
  }),
];

const scripts = Object.fromEntries(SCRIPT_IDS.map((id) => [id, { calls: 0, linksSent: 0, claimed: 0 }])) as CrmBoard["scripts"];
scripts["held_page.claim.v1"] = { calls: 142, linksSent: 61, claimed: 28 };

const bannerOf = (facts: Extract<SignalFacts, { kind: "held_page" }>): HeldScopeBanner => ({ signalRef: "area-bb:cat-hvac", facts, unassigned: 14, mine: 2 });

function board(over: Partial<CrmBoard> = {}): CrmBoard {
  return {
    tab: "calls",
    rows: ROWS,
    due: ROWS.filter((candidate) => candidate.due).length,
    assignedToMe: 41,
    heldByOthers: 3,
    banner: bannerOf(held()),
    moreHeldScopes: 2,
    week: {
      since: new Date("2026-09-13T20:00:00Z"),
      callsMade: 142,
      linksSent: 61,
      claimedAfterLink: 28,
      upgraded: 9,
      churnSaved: 4,
      churnClosed: 7,
      clearedBySignal: 5,
      wrongNumbers: 2,
    },
    scripts,
    lastRun: { finishedAt: new Date("2026-09-13T20:24:00Z"), derived: 61 },
    nextRun: new Date("2026-09-14T20:23:00Z"),
    renewal: { fourF: 88, onList: 71, renewalPassed: 12 },
    tabCounts: { calls: 18, upgrade: 6, renewal: 7 },
    ...over,
  };
}

function Specimen({ value, caption }: { value: CrmBoard; caption: string }) {
  const view = presentCrm(value, NOW);
  return (
    <div className="w-full">
      <CallBoard
        rows={view.rows}
        caption={caption}
        listHeader={
          <>
            <p className="text-body-sm font-medium text-ink">{view.listTitle}</p>
            <span className="text-caption text-body">{view.listCount}</span>
          </>
        }
        rail={
          <div className="rounded-panel border border-line bg-card p-4">
            <p className="font-mono text-eyebrow uppercase text-faint">{view.week.since}</p>
            <dl className="mt-2 flex flex-col gap-2">
              {view.week.lines.map((line) => (
                <div key={line.key} className="flex justify-between gap-3 text-body-sm">
                  <dt className="text-body">{line.label}</dt>
                  <dd className="m-0 tabular-nums text-ink">{line.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        }
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{view.empty.title}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">{view.empty.body}</p>
          </div>
        }
      />
    </div>
  );
}

function Banner({ facts }: { facts: Extract<SignalFacts, { kind: "held_page" }> }) {
  const banner = bannerView(bannerOf(facts));
  return (
    <div className="w-full max-w-3xl rounded-panel border border-warn-line bg-warn-surface p-4">
      <p className="text-body-sm font-medium text-warn-ink">{banner.title}</p>
      <p className="mt-1 text-body-sm text-warn-ink">{banner.body}</p>
      <p className="mt-1 text-body-sm text-warn-ink">{banner.other}</p>
    </div>
  );
}

export function CrmGallery() {
  return (
    <Section
      id="crm"
      title="Ops CRM"
      note="Board 12d. Every row from a demand signal; the banner's supply arithmetic derives from the numbers it states; every rate carries its denominator."
    >
      <States label="Call list · as drawn" stack>
        <Specimen value={board()} caption="Call list, gallery specimen" />
      </States>
      <States label="Nothing due" stack>
        <Specimen value={board({ rows: [], due: 0, banner: null })} caption="Empty call list, gallery specimen" />
      </States>
      <States label="Never built" stack>
        <Specimen value={board({ rows: [], due: 0, banner: null, lastRun: null })} caption="Unbuilt call list, gallery specimen" />
      </States>
      <States label="Banner · verify only" stack>
        <Banner facts={held()} />
      </States>
      <States label="Banner · add and verify" stack>
        <Banner facts={held({ need: 100 })} />
      </States>
      <States label="Banner · thin scope" stack>
        <Banner facts={held({ listings: 1, verified: 0, unverified: 1, need: 99, failing: ["listings", "verified", "copy"] })} />
      </States>
      <States label="Banner · copy only left" stack>
        <Banner facts={held({ verified: 30, unverified: 48, failing: ["copy"] })} />
      </States>
    </Section>
  );
}
