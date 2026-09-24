import { ProposalComparisonView } from "@/app/(public)/enquiry/[id]/compare/_proposals";
import type { ComparisonColumn, ProposalComparison } from "@/lib/db/queries/proposal-comparison";
import { Section, States } from "../_kit";

/**
 * Board `1n-s` — proposals compared, in every state its spec lists.
 *
 * Rendered from plain values with a fixed clock, and with no accept action: a
 * gallery has nothing to accept, and the page's forms render as plain
 * containers so several states can share one page.
 */

const NOW = new Date("2026-09-14T08:00:00Z");
const SENT = new Date("2026-09-09T06:00:00Z");
const at = (minutes: number) => new Date(SENT.getTime() + minutes * 60_000);

const EXCLUDED_EFG =
  "Major plant replacement, refrigerant gas beyond 5 kg per annum, civil and builder's work. Spare parts above AED 500 quoted separately.";

function column(input: Partial<ComparisonColumn> & Pick<ComparisonColumn, "businessId" | "displayName">): ComparisonColumn {
  return {
    slug: input.businessId,
    licenceVerified: true,
    credentials: [],
    quote: { id: `q-${input.businessId}`, ref: `QT-40812-${input.businessId.toUpperCase()}R1`, revision: 1, status: "sent", sentAt: at(41), expiresAt: new Date("2026-10-09T06:00:00Z"), paymentTerms: null },
    arrivedAt: at(41),
    repliedInMs: 41 * 60_000,
    state: "open",
    ...input,
    proposal: {
      feeAed: "18400",
      feeBasis: "per_month",
      feeBasisLabel: "Per month",
      mobilisationAed: null,
      termMonths: null,
      serviceName: "Planned and reactive MEP maintenance",
      scope: "Quarterly PPM visits across both towers, 24/7 reactive callout.",
      turnaround: null,
      deliverable: null,
      deliveredWhere: "On site",
      exclusions: null,
      ...input.proposal,
    },
  };
}

const EFG = column({
  businessId: "efg",
  displayName: "Emirates Facilities Group",
  credentials: [{ kind: "other", issuer: "ISO 41001", identifier: null, verified: false }],
  proposal: {
    feeAed: "18400",
    feeBasis: "per_month",
    feeBasisLabel: "Per month",
    mobilisationAed: "6000",
    termMonths: 24,
    serviceName: "Planned and reactive MEP maintenance",
    scope: "Quarterly PPM visits to a written schedule across both towers, covering chillers, AHUs, pumps, LV distribution and BMS. 24/7 reactive callout with 4-hour attendance.",
    turnaround: "4-hour attendance, 24/7",
    deliverable: "Monthly written report with photographs",
    deliveredWhere: "On site, both towers",
    exclusions: EXCLUDED_EFG,
  },
});
const SHIRAWI = column({
  businessId: "alsh",
  displayName: "Al Shirawi Facilities",
  arrivedAt: at(192),
  repliedInMs: 192 * 60_000,
  proposal: {
    feeAed: "5100",
    feeBasis: "per_visit",
    feeBasisLabel: "Per visit",
    mobilisationAed: "0",
    termMonths: 12,
    serviceName: "Chiller call-out",
    scope: "Four planned visits a year. Reactive callout charged at AED 850 each.",
    turnaround: "Same day for a chiller down",
    deliverable: "Visit sheet signed on site",
    deliveredWhere: "On site",
    exclusions: "All reactive work and all spare parts.",
  },
});
const KHANSAHEB = column({
  businessId: "khan",
  displayName: "Khansaheb Facilities",
  arrivedAt: at(400),
  repliedInMs: 400 * 60_000,
  credentials: [{ kind: "other", issuer: "ISO 41001", identifier: null, verified: false }],
  proposal: {
    feeAed: "5.40",
    feeBasis: "per_sqft_yr",
    feeBasisLabel: "Per sq ft / yr",
    mobilisationAed: null,
    termMonths: 12,
    serviceName: "Building maintenance",
    scope: "Planned maintenance of chillers, AHUs and pumps, and reactive attendance around the clock.",
    turnaround: "6-hour attendance, 24/7",
    deliverable: "Monthly report plus quarterly review meeting",
    deliveredWhere: "On site",
    exclusions: "Chiller overhaul and BMS software licences.",
  },
});
const GULF_TOWERS = column({
  businessId: "gulf",
  displayName: "Gulf Towers Maintenance",
  arrivedAt: at(485),
  repliedInMs: 485 * 60_000,
  proposal: {
    feeAed: "231000",
    feeBasis: "fixed_fee",
    feeBasisLabel: "Fixed fee",
    mobilisationAed: null,
    termMonths: 12,
    serviceName: "Tower MEP maintenance",
    scope: "Planned and reactive maintenance in office hours.",
    turnaround: "Office hours only",
    deliverable: "Quarterly report",
    deliveredWhere: "On site",
    exclusions: "Out-of-hours attendance.",
  },
});

const TYPICAL: ProposalComparison = {
  enquiryId: "gallery-1ns",
  ref: "ENQ-40812",
  requirement: "Two commercial towers, 12 and 14 floors. Quarterly PPM on chillers, AHUs and pumps plus a 24/7 reactive line.",
  createdAt: SENT,
  closesAt: new Date("2026-09-23T06:00:00Z"),
  scale: "12 floors, 3 chillers, about 40,000 sq ft",
  brief: {
    subcategoryName: "Hard FM & MEP maintenance",
    emirate: "dubai",
    areaName: null,
    building: "Business Bay",
    engagementType: "ongoing_contract",
    cadence: "quarterly",
    startMode: "from_date",
    startsOn: new Date("2026-11-01T00:00:00Z"),
  },
  subcategoryName: "Hard FM & MEP maintenance",
  turnaroundLabel: "Response time",
  engagementType: "ongoing_contract",
  cadence: "quarterly",
  acceptedBusinessId: null,
  buyerCompanyId: null,
  recipientCount: 6,
  columns: [EFG, SHIRAWI, KHANSAHEB, GULF_TOWERS],
  declined: [],
  waiting: [
    { businessId: "w1", displayName: "Northern Cooling Services", declineReason: null },
    { businessId: "w2", displayName: "Sand and Steel Services", declineReason: null },
  ],
  firstProposalInMs: 41 * 60_000,
};

const NO_FIGURES = { areaSqFt: null, visitsPerYear: null };

function View({
  comparison,
  id,
  figures = NO_FIGURES,
  mayAccept = true,
}: {
  comparison: ProposalComparison;
  id: string;
  figures?: { areaSqFt: number | null; visitsPerYear: number | null };
  mayAccept?: boolean;
}) {
  return (
    <div className="w-full min-w-0">
      <ProposalComparisonView
        comparison={comparison}
        now={NOW}
        token={null}
        figures={figures}
        error={null}
        idPrefix={id}
        mayAccept={mayAccept}
      />
    </div>
  );
}

export function ProposalComparisonGallery() {
  return (
    <Section id="proposal-comparison" title="proposal-comparison" note="board 1n-s · four fee bases, one labelled row of our arithmetic, nothing ranked">
      <States label="typical · four bases, two not replied" stack>
        <View id="g1ns-typical" comparison={TYPICAL} />
      </States>

      <States label="the buyer states an area" stack>
        <View id="g1ns-area" comparison={TYPICAL} figures={{ areaSqFt: 40_000, visitsPerYear: null }} />
      </States>

      <States label="first reply only" stack>
        <View
          id="g1ns-first"
          comparison={{ ...TYPICAL, columns: [EFG], waiting: [...TYPICAL.waiting, { businessId: "w3", displayName: "Al Shirawi Facilities", declineReason: null }] }}
        />
      </States>

      <States label="all on the same basis · row suppressed" stack>
        <View
          id="g1ns-same"
          comparison={{
            ...TYPICAL,
            columns: [EFG, column({ businessId: "b2", displayName: "Khansaheb Facilities", arrivedAt: at(300), proposal: { ...EFG.proposal, feeAed: "19250", mobilisationAed: null, termMonths: 12 } })],
          }}
        />
      </States>

      <States label="one proposal past validity · a supplier declined" stack>
        <View
          id="g1ns-expired"
          comparison={{
            ...TYPICAL,
            columns: [EFG, { ...SHIRAWI, state: "expired", quote: { ...SHIRAWI.quote, expiresAt: new Date("2026-09-12T06:00:00Z") } }],
            waiting: [],
            declined: [{ businessId: "d1", displayName: "Northern Cooling Services", declineReason: "Outside the area we cover" }],
          }}
        />
      </States>

      <States label="accepted · frozen as the record" stack>
        <View
          id="g1ns-accepted"
          comparison={{
            ...TYPICAL,
            acceptedBusinessId: "efg",
            waiting: [],
            columns: [
              { ...EFG, state: "accepted" },
              { ...SHIRAWI, state: "declined" },
              { ...KHANSAHEB, state: "declined" },
            ],
          }}
        />
      </States>

      <States label="a one-off job · no year to put it on" stack>
        <View
          id="g1ns-oneoff"
          comparison={{
            ...TYPICAL,
            engagementType: "one_off_job",
            cadence: null,
            brief: { ...TYPICAL.brief!, engagementType: "one_off_job", cadence: null, startMode: "asap", startsOn: null },
            columns: [GULF_TOWERS, { ...SHIRAWI, arrivedAt: at(600) }],
          }}
        />
      </States>

      <States label="no replies yet" stack>
        <View id="g1ns-none" comparison={{ ...TYPICAL, columns: [], firstProposalInMs: null }} />
      </States>

      <States label="account cannot accept · staff role, no buyer role (build plan 9.4)" stack>
        <View id="g1ns-not-permitted" comparison={TYPICAL} mayAccept={false} />
      </States>
    </Section>
  );
}
