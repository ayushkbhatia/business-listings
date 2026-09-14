import { AcceptedRecordView } from "@/app/(public)/enquiry/[id]/accepted/_record";
import { Button } from "@/components/primitives";
import { recordLines, type AcceptedRecord } from "@/lib/enquiry/accepted-record";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `7c` — the accepted quote record, in every state its spec documents.
 *
 * Rendered from plain `AcceptedRecord` values with a fixed clock, so the price
 * window reads the same on every visit. The two forms are the page's, and the
 * page owns them and the breadcrumb: here they are static stand-ins, because a
 * server action has nothing to write to in a gallery and a second named `nav`
 * per state is a landmark axe fails the gallery over.
 */

const NOW = new Date("2026-08-25T08:00:00Z");

const LINKS = {
  pdf: "#accepted-record",
  thread: "#accepted-record",
  review: "#accepted-record",
};

const BOARD = recordLines([
  { id: "l1", description: "Grooved butterfly valve DN100, ductile iron", qty: 40, unitPrice: "191.00", leadTimeDays: 0, productId: "p1", sku: "AW-VLV-BF-100" },
  { id: "l2", description: "Grooved rigid coupling, 4 inch, painted", qty: 120, unitPrice: "46.00", leadTimeDays: 0, productId: "p2", sku: "AW-GRV-RC-100" },
  { id: "l3", description: "Grooved gasket, EPDM, 4 inch", qty: 120, unitPrice: "12.00", leadTimeDays: 2, productId: null, sku: null },
]);

const TYPICAL: AcceptedRecord = {
  enquiryId: "gallery-7c",
  ref: "ENQ-8841",
  buyerReference: "PO-2026-0418",
  acceptedAt: new Date("2026-08-21T08:00:00Z"),
  isBrief: false,
  declinedCount: 3,
  quote: {
    id: "q-7c",
    ref: "QT-8841-R2",
    revision: 2,
    note: "Revised after your call. Valves and couplings are ex-stock in JAFZA South; gaskets follow within 2 days of the drop.",
    paymentTerms: "net_30",
    delivery: "included",
    validityDays: 14,
    sentAt: new Date("2026-08-21T06:00:00Z"),
    expiresAt: new Date("2026-09-04T06:00:00Z"),
    lines: BOARD.lines,
    totalAed: BOARD.totalAed,
    proposal: null,
  },
  work: null,
  supplier: {
    id: "b-7c",
    slug: "al-waha-industrial-supplies",
    displayName: "Al Waha Industrial Supplies",
    person: { name: "Rajesh Nair", role: "Sales lead", phone: "+971557041120" },
    phone: "+97148812200",
    whatsapp: null,
    location: { type: "warehouse", addressLine: "Warehouse 14, JAFZA South", areaName: "Jebel Ali Free Zone", emirate: "dubai" },
  },
  commitments: [
    { messageId: "m1", text: "One drop, 40 valves and 120 couplings, on 4 Sep.", saidAt: new Date("2026-08-22T08:00:00Z") },
    { messageId: "m1", text: "Gaskets to follow within 2 days of the drop.", saidAt: new Date("2026-08-22T08:00:00Z") },
  ],
  review: { kind: "none" },
  report: { kind: "none" },
};

function Record({ record, now = NOW }: { record: AcceptedRecord; now?: Date }) {
  return (
    <div className="w-full rounded-card border border-line bg-paper">
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

export function AcceptedRecordGallery() {
  const ended = new Date("2026-09-10T08:00:00Z");
  const unstated: AcceptedRecord = {
    ...TYPICAL,
    buyerReference: null,
    declinedCount: 0,
    quote: {
      ...TYPICAL.quote,
      revision: 1,
      note: null,
      paymentTerms: null,
      delivery: null,
      lines: TYPICAL.quote.lines.map((line) => ({ ...line, leadTimeDays: null })),
    },
    commitments: [],
  };

  return (
    <Section id="accepted-record" title="accepted-record" note="board 7c · the record of what was agreed">
      <States label="typical" stack>
        <Record record={TYPICAL} />
      </States>

      <States label="one supplier · window ended · nothing stated" stack>
        <Record record={unstated} now={ended} />
      </States>

      <States label="no branch, no phone · a brief" stack>
        <Record
          record={{
            ...TYPICAL,
            isBrief: true,
            supplier: { ...TYPICAL.supplier, person: null, phone: null, whatsapp: null, location: null },
          }}
        />
      </States>

      <States label="reviewed · problem reported" stack>
        <Record
          record={{
            ...TYPICAL,
            review: { kind: "posted", postedAt: new Date("2026-08-24T08:00:00Z") },
            report: { kind: "open", filedAt: new Date("2026-08-24T10:00:00Z") },
          }}
        />
      </States>

      <States label="review held · report resolved" stack>
        <Record
          record={{
            ...TYPICAL,
            review: { kind: "held", postedAt: new Date("2026-08-24T08:00:00Z") },
            report: {
              kind: "resolved",
              filedAt: new Date("2026-08-24T10:00:00Z"),
              outcome: "seller_corrected",
              reason: "Replacement couplings delivered and confirmed by the buyer in the thread.",
              resolvedAt: new Date("2026-08-25T07:00:00Z"),
            },
          }}
        />
      </States>
    </Section>
  );
}
