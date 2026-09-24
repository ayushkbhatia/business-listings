import { QuoteComparisonView } from "@/app/(public)/enquiry/[id]/compare/_quotes";
import type { ComparisonOutlook } from "@/lib/buyer-company/queue";
import type { QuoteComparisonData } from "@/lib/db/queries/quote-comparison";
import {
  buildComparison,
  type ComparedRecipient,
  type ComparedSupplier,
  type QuotedLine,
  type SortKey,
} from "@/lib/quote/comparison";
import { Section, States } from "../_kit";

/**
 * Board `1n` — quotes compared line by line, in every state its spec lists.
 *
 * Rendered from plain values with a fixed clock and through the same pure model
 * the page and the CSV read, with no accept or message action: a gallery has
 * nothing to post to, so the forms render as plain containers and several
 * states share one page without two forms of one name.
 */

const NOW = new Date("2026-09-24T08:00:00Z");
const SENT = new Date("2026-09-22T05:00:00Z");
const at = (minutes: number) => new Date(SENT.getTime() + minutes * 60_000);
const DAY = 86_400_000;

const LINES = [
  { id: "g-valve", description: "Resilient seated gate valve, flanged", qty: 40, unit: "pcs", size: "DN100" },
  { id: "g-coupling", description: "Rigid grooved coupling", qty: 120, unit: "pcs", size: "DN100" },
  { id: "g-gasket", description: "EPDM gasket", qty: 120, unit: "pcs", size: "DN100" },
];

function supplier(id: string, displayName: string, rating: { average: number; count: number } | null): ComparedSupplier {
  return {
    businessId: id,
    slug: `${id}-gallery`,
    displayName,
    verificationTier: 2,
    verifiedAt: new Date("2026-05-14T08:00:00Z"),
    rating,
    closed: false,
  };
}

const AL_WAHA = supplier("alwaha", "Al Waha Industrial Supplies", { average: 4.8, count: 31 });
const EMIRATES = supplier("emirates", "Emirates Valve & Fitting Co.", { average: 4.6, count: 12 });
const NORTHERN = supplier("northern", "Northern Gulf Trading", { average: 4.4, count: 9 });
const TECHNOPUMP = supplier("technopump", "Technopump Trading LLC", { average: 4.4, count: 14 });
const GULF_COOL = supplier("gulfcool", "Gulf Cool Technical Services", null);

const line = (enquiryLineId: string | null, qty: number, unitPrice: string, leadTimeDays: number | null): QuotedLine => ({
  enquiryLineId,
  qty,
  unitPrice,
  leadTimeDays,
});

function quoted(who: ComparedSupplier, minutes: number, lines: QuotedLine[], over: Partial<NonNullable<ComparedRecipient["quote"]>> = {}): ComparedRecipient {
  return {
    supplier: who,
    state: "quoted",
    deliveredAt: SENT,
    openedAt: at(Math.min(30, minutes)),
    buyerNudgedAt: null,
    repliedAt: at(minutes),
    declinedAt: null,
    declineReason: null,
    quote: {
      id: `gq-${who.businessId}`,
      ref: `QT-8864-${who.businessId.slice(0, 3).toUpperCase()}R1`,
      revision: 1,
      status: "sent",
      sentAt: at(minutes),
      firstSentAt: at(minutes),
      expiresAt: new Date(at(minutes).getTime() + 14 * DAY),
      againstRevision: 1,
      paymentTerms: "net_30",
      delivery: "included",
      lines,
      ...over,
    },
  };
}

function waiting(who: ComparedSupplier, openedAt: Date | null, buyerNudgedAt: Date | null = null): ComparedRecipient {
  return {
    supplier: who,
    state: openedAt ? "opened" : "delivered",
    deliveredAt: SENT,
    openedAt,
    buyerNudgedAt,
    repliedAt: null,
    declinedAt: null,
    declineReason: null,
    quote: null,
  };
}

const Q_ALWAHA = quoted(AL_WAHA, 100, [line("g-valve", 40, "198.00", 0), line("g-coupling", 120, "46.00", 0), line("g-gasket", 120, "12.00", 0)]);
const Q_EMIRATES = quoted(EMIRATES, 175, [line("g-valve", 40, "183.00", 0), line("g-coupling", 120, "50.00", 0)], { paymentTerms: "advance", delivery: "charged_separately" });
const Q_NORTHERN = quoted(NORTHERN, 370, [line("g-valve", 40, "268.00", 12), line("g-coupling", 120, "41.00", 12), line("g-gasket", 120, "11.00", 12)], { paymentTerms: "net_60" });
const Q_TECHNOPUMP = quoted(TECHNOPUMP, 560, [line("g-valve", 40, "236.00", 10), line("g-coupling", 120, "48.00", 10), line("g-gasket", 120, "13.00", 10)], { delivery: "collection" });
const W_GULF_COOL = waiting(GULF_COOL, new Date(NOW.getTime() - 2 * DAY));

function data(recipients: ComparedRecipient[], over: Partial<QuoteComparisonData["enquiry"]> = {}): QuoteComparisonData {
  const enquiry: QuoteComparisonData["enquiry"] = {
    id: "gallery-1n",
    ref: "ENQ-8864",
    requirement: "Chilled water riser — valves, couplings, gaskets. For the Marina Plaza riser replacement, to the loading bay in one drop.",
    createdAt: SENT,
    closesAt: new Date(NOW.getTime() + 3 * DAY + 3_600_000),
    neededBy: new Date(NOW.getTime() + 11 * DAY),
    revision: 1,
    acceptedBusinessId: null,
    acceptedAt: null,
    buyerCompanyId: null,
    companyName: null,
    hasDeliveryAddress: false,
    ...over,
  };
  return {
    enquiry,
    input: {
      lines: LINES,
      recipients,
      revision: enquiry.revision,
      closesAt: enquiry.closesAt,
      neededBy: enquiry.neededBy,
      acceptedBusinessId: enquiry.acceptedBusinessId,
      acceptedAt: enquiry.acceptedAt,
    },
  };
}

const PERSONAL: ComparisonOutlook = { kind: "personal" };

function View({
  id,
  input,
  sort = "received",
  outlook = PERSONAL,
  mayAccept = true,
}: {
  id: string;
  input: QuoteComparisonData;
  sort?: SortKey;
  outlook?: ComparisonOutlook;
  mayAccept?: boolean;
}) {
  return (
    <div className="w-full min-w-0">
      <QuoteComparisonView
        data={input}
        model={buildComparison(input.input, NOW, sort)}
        now={NOW}
        token={null}
        outlook={outlook}
        error={null}
        mayAccept={mayAccept}
        live={false}
        idPrefix={id}
      />
    </div>
  );
}

const BOARD = [Q_ALWAHA, Q_EMIRATES, Q_NORTHERN, Q_TECHNOPUMP, W_GULF_COOL];

export function QuoteComparisonGallery() {
  const company = data(BOARD, { buyerCompanyId: "gallery-marina", companyName: "Marina Facilities LLC", hasDeliveryAddress: true });
  const companyOutlook: ComparisonOutlook = {
    kind: "company",
    companyName: "Marina Facilities LLC",
    requirePoNumber: true,
    requireCostCode: false,
    quotes: new Map(
      [Q_ALWAHA, Q_EMIRATES, Q_NORTHERN, Q_TECHNOPUMP].map((r) => [r.quote!.id, { required: true, approverNames: ["Rami Haddad"] }]),
    ),
  };
  const accepted = data(
    BOARD.map((r) =>
      r.quote
        ? { ...r, quote: { ...r.quote, status: r.supplier.businessId === "alwaha" ? "accepted" : "lost" } }
        : { ...r, state: "declined" },
    ),
    { acceptedBusinessId: "alwaha", acceptedAt: new Date(NOW.getTime() - 3_600_000) },
  );

  return (
    <Section id="quote-comparison" title="quote-comparison" note="board 1n · priced per line, every winner marked, one supplier accepted">
      <States label="as drawn · four quotes, one opened and quiet" stack>
        <View id="g1n-typical" input={data(BOARD)} />
      </States>

      <States label="company · every quote beyond her month" stack>
        <View id="g1n-company" input={company} outlook={companyOutlook} />
      </States>

      <States label="sorted by total · complete quotes first" stack>
        <View id="g1n-total" input={data(BOARD)} sort="total" />
      </States>

      <States label="first quote only" stack>
        <View
          id="g1n-first"
          input={data([Q_ALWAHA, waiting(EMIRATES, at(40)), waiting(NORTHERN, null), waiting(TECHNOPUMP, at(80), new Date(NOW.getTime() - 3_600_000)), W_GULF_COOL])}
        />
      </States>

      <States label="no quotes yet" stack>
        <View id="g1n-none" input={data([waiting(AL_WAHA, at(20)), waiting(EMIRATES, null), W_GULF_COOL])} />
      </States>

      <States label="quantities that do not answer the line" stack>
        <View
          id="g1n-quantities"
          input={data([
            Q_ALWAHA,
            quoted(EMIRATES, 175, [line("g-valve", 30, "175.00", 0), line("g-coupling", 120, "50.00", 0), line("g-gasket", 120, "12.50", 0)]),
            quoted(NORTHERN, 370, [
              line("g-valve", 24, "262.00", 0),
              line("g-valve", 16, "268.00", 21),
              line("g-coupling", 120, "41.00", 12),
              line("g-gasket", 120, "11.00", 12),
              line(null, 1, "350.00", null),
            ]),
          ])}
        />
      </States>

      <States label="closed before anything was accepted" stack>
        <View id="g1n-closed" input={data(BOARD, { closesAt: new Date(NOW.getTime() - 3_600_000) })} />
      </States>

      <States label="accepted · the record of what the others offered" stack>
        <View id="g1n-accepted" input={accepted} />
      </States>

      <States label="account cannot accept · staff role, no buyer role (build plan 9.4)" stack>
        <View id="g1n-not-permitted" input={data(BOARD)} mayAccept={false} />
      </States>
    </Section>
  );
}
