import { AcceptedRecordView } from "@/app/(public)/enquiry/[id]/accepted/_record";
import { Button } from "@/components/primitives";
import type { AcceptedRecord } from "@/lib/enquiry/accepted-record";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `7c-s` — the accepted proposal, in every state its spec lists.
 *
 * Plain `AcceptedRecord` values with a fixed clock per state, so *the term ends
 * in 48 days* reads the same on every visit. Every value is the one `3j-s`,
 * `1h-s` and `1n-s` render for ENQ-40812; the account engineer's name the
 * render invented is not here, because no proposal field holds one.
 */

const LINKS = {
  pdf: "#accepted-proposal",
  thread: "#accepted-proposal",
  review: "#accepted-proposal",
  rebrief: { supplier: "#accepted-proposal", others: "#accepted-proposal" },
};

const ACCEPTED = new Date("2026-09-12T08:00:00Z");
const START = new Date("2026-11-01T00:00:00Z");

const EXCLUDED =
  "Major plant replacement, refrigerant gas beyond 5 kg per annum, civil and builder's work, asbestos handling, and works requiring a road closure permit. Spare parts above AED 500 quoted separately before proceeding.";

const TYPICAL: AcceptedRecord = {
  enquiryId: "gallery-7cs",
  ref: "ENQ-40812",
  buyerReference: "DP-FM-2026-14",
  costCode: null,
  delivery: null,
  acceptedAt: ACCEPTED,
  isBrief: true,
  declinedCount: 3,
  quote: {
    id: "q-7cs",
    ref: "PR-40812-R1",
    revision: 1,
    note: null,
    paymentTerms: "in_arrears",
    delivery: null,
    validityDays: 30,
    sentAt: new Date("2026-09-09T06:41:00Z"),
    expiresAt: new Date("2026-10-09T06:41:00Z"),
    lines: [],
    totalAed: "0.00",
    proposal: {
      feeAed: "18400.00",
      feeBasis: "per_month",
      feeBasisLabel: "Per month",
      mobilisationAed: "6000.00",
      termMonths: 24,
      serviceName: "Planned and reactive MEP maintenance",
      turnaround: "4-hour attendance on a reactive callout, 24/7",
      scope:
        "Quarterly PPM visits to a written schedule across both towers, covering 3 chillers, AHUs, pumps, LV distribution and BMS. 24/7 reactive callout with 4-hour attendance.",
      deliverable: "Monthly written report with photographs",
      deliveredWhere: "On site, both towers",
      exclusions: EXCLUDED,
    },
  },
  work: {
    brief: {
      subcategoryName: "Hard FM & MEP maintenance",
      emirate: "dubai",
      areaName: "Business Bay",
      building: "both towers",
      engagementType: "ongoing_contract",
      cadence: "quarterly",
      startMode: "from_date",
      startsOn: START,
    },
    site: { building: "both towers", areaName: "Business Bay", emirate: "dubai" },
    turnaroundLabel: "Response time",
    tradeSlug: "hard-fm",
    serviceSlug: "planned-reactive-mep",
  },
  supplier: {
    id: "b-7cs",
    slug: "emirates-facilities-group",
    displayName: "Emirates Facilities Group",
    person: { name: "Hana Qasim", role: "Contracts lead", phone: "+971552184470" },
    phone: null,
    whatsapp: null,
    location: null,
  },
  commitments: [],
  review: { kind: "none" },
  report: { kind: "none" },
};

function Record({ record, now }: { record: AcceptedRecord; now: Date }) {
  return (
    <div className="w-full min-w-0 rounded-card border border-line bg-paper">
      <AcceptedRecordView
        record={record}
        now={now}
        links={LINKS}
        breadcrumb={null}
        referenceForm={
          record.buyerReference ? (
            <span className="text-body-sm text-body">
              {t("accepted.reference.label")} <span className="font-mono text-ink">{record.buyerReference}</span>
            </span>
          ) : (
            <span className="text-body-sm text-muted">{t("accepted.reference.add")}</span>
          )
        }
        reportForm={<Button variant="danger">{t("accepted.report.open")}</Button>}
      />
    </div>
  );
}

const withProposal = (patch: Partial<NonNullable<AcceptedRecord["quote"]["proposal"]>>): AcceptedRecord["quote"] => ({
  ...TYPICAL.quote,
  proposal: { ...TYPICAL.quote.proposal!, ...patch },
});

export function AcceptedProposalGallery() {
  return (
    <Section
      id="accepted-proposal"
      title="accepted-proposal"
      note="board 7c-s · a basis and an exclusions list, and no total"
    >
      <States label="typical · accepted, term not yet started, no review" stack>
        <Record record={TYPICAL} now={new Date("2026-09-14T08:00:00Z")} />
      </States>

      <States label="term started · review open · the rail leads with coming back" stack>
        <Record record={TYPICAL} now={new Date("2027-03-02T08:00:00Z")} />
      </States>

      <States label="term ending within 90 days · renew or re-brief" stack>
        <Record record={TYPICAL} now={new Date("2028-09-13T08:00:00Z")} />
      </States>

      <States label="review written · the rail links to it" stack>
        <Record
          record={{ ...TYPICAL, review: { kind: "posted", postedAt: new Date("2027-02-10T08:00:00Z") } }}
          now={new Date("2027-03-02T08:00:00Z")}
        />
      </States>

      <States label="one-off job · no term, no cadence" stack>
        <Record
          record={{
            ...TYPICAL,
            buyerReference: null,
            declinedCount: 0,
            quote: {
              ...withProposal({
                feeAed: "4250.00",
                feeBasis: "fixed_fee",
                feeBasisLabel: "Fixed fee",
                mobilisationAed: "0.00",
                termMonths: null,
                serviceName: "Fire pump service",
                turnaround: null,
                scope: "Service both fire pumps and the jockey pump once, test the controller and leave a signed test sheet for the insurer.",
                deliverable: "Signed test sheet for the insurer",
                deliveredWhere: "On site",
                exclusions: "Replacement seals and bearings, quoted on the day if needed.",
              }),
              paymentTerms: "on_completion",
            },
            work: {
              ...TYPICAL.work!,
              brief: { ...TYPICAL.work!.brief!, engagementType: "one_off_job", cadence: null, startMode: "asap", startsOn: null, building: "Plot S30112" },
              site: { building: "Plot S30112", areaName: "JAFZA South", emirate: "dubai" },
            },
          }}
          now={new Date("2026-09-14T08:00:00Z")}
        />
      </States>

      <States label="nothing optional stated · no mobilisation, payment or exclusions · as soon as possible" stack>
        <Record
          record={{
            ...TYPICAL,
            declinedCount: 1,
            quote: {
              ...withProposal({ mobilisationAed: null, turnaround: null, deliverable: null, deliveredWhere: null, exclusions: null }),
              paymentTerms: null,
            },
            work: {
              ...TYPICAL.work!,
              brief: { ...TYPICAL.work!.brief!, cadence: null, startMode: "asap", startsOn: null },
              turnaroundLabel: "",
            },
          }}
          now={new Date("2026-09-14T08:00:00Z")}
        />
      </States>

      <States label="term ended · supplier since closed, record unchanged" stack>
        <Record
          record={{ ...TYPICAL, supplier: { ...TYPICAL.supplier, person: null, phone: null } }}
          now={new Date("2028-11-20T08:00:00Z")}
        />
      </States>
    </Section>
  );
}
