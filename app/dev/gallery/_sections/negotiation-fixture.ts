import type { Negotiation, RailThread } from "@/lib/messaging/negotiation-server";
import type { NegotiationMessage, NegotiationQuote } from "@/lib/messaging/negotiation";

/**
 * Board `10h`'s own fixture, as rows — ENQ-8841, four suppliers, r2 twelve
 * minutes old — and the states its spec documents, each a small edit of it.
 *
 * Rows, not words: every specimen goes through `buildNegotiationView`, the page's
 * own path, so a figure here is derived exactly as the page derives it. The
 * corrected totals are therefore not written anywhere in this file — r1's 14,880
 * and r2's 14,600 are what the lines below sum to.
 */

/** 09:26 in Dubai on 21 Aug, twelve minutes after r2. */
export const NEGOTIATION_NOW = new Date("2026-08-21T05:26:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso: string) => new Date(iso);

const REQUIREMENT = [
  { id: "req-valve", description: "Butterfly valve DN100", qty: 40, sortOrder: 0 },
  { id: "req-coupling", description: "Rigid coupling", qty: 120, sortOrder: 1 },
  { id: "req-gasket", description: "Grooved gasket", qty: 120, sortOrder: 2 },
];

const lines = (valve: string, coupling: string | null, gasket: string | null, prefix: string) =>
  [
    { id: `${prefix}-1`, enquiryLineId: "req-valve", description: "Butterfly valve DN100", qty: 40, unitPrice: valve, sortOrder: 0 },
    coupling === null
      ? null
      : { id: `${prefix}-2`, enquiryLineId: "req-coupling", description: "Rigid coupling", qty: 120, unitPrice: coupling, sortOrder: 1 },
    gasket === null
      ? null
      : { id: `${prefix}-3`, enquiryLineId: "req-gasket", description: "Grooved gasket", qty: 120, unitPrice: gasket, sortOrder: 2 },
  ].filter((line): line is NonNullable<typeof line> => line !== null);

const quote = (overrides: Partial<NegotiationQuote> & Pick<NegotiationQuote, "id" | "ref" | "revision" | "lines" | "sentAt">): NegotiationQuote => ({
  status: "sent",
  expiresAt: overrides.sentAt ? new Date(overrides.sentAt.getTime() + 14 * DAY) : null,
  validityDays: 14,
  note: null,
  proposal: null,
  ...overrides,
});

const R1 = quote({
  id: "gq-aw-r1",
  ref: "QT-8841-ALWR1",
  revision: 1,
  sentAt: at("2026-08-19T12:02:00.000Z"),
  note: "Quote attached — 40 valves at AED 198, couplings at 46, gaskets at 12. Ex-stock on the first two, two days on the gasket. Two-drop delivery included.",
  lines: lines("198.00", "46.00", "12.00", "r1"),
});

const R2 = quote({
  id: "gq-aw-r2",
  ref: "QT-8841-ALWR2",
  revision: 2,
  sentAt: at("2026-08-21T05:14:00.000Z"),
  lines: lines("191.00", "46.00", "12.00", "r2"),
});

const message = (overrides: Partial<NegotiationMessage> & Pick<NegotiationMessage, "id" | "body" | "fromSeller" | "createdAt">): NegotiationMessage => ({
  senderId: overrides.fromSeller ? "seat-rajesh" : "buyer-priya",
  readAt: null,
  flagged: false,
  automatic: false,
  quoteRevisionId: null,
  attachments: [],
  ...overrides,
});

const ASK = message({
  id: "gm-ask",
  body: "Northern Gulf are at 190 on the valve. Can you match it? Happy to take all 40 in one drop on the 4th if that helps.",
  fromSeller: false,
  createdAt: at("2026-08-19T13:41:00.000Z"),
  readAt: at("2026-08-19T14:02:00.000Z"),
});

const FLOOR = message({
  id: "gm-floor",
  body: "One drop makes it easier — 198 down to 191 on the valve, everything else the same. That is our floor on UL/FM stock.",
  fromSeller: true,
  createdAt: at("2026-08-21T05:14:00.000Z"),
  quoteRevisionId: R2.id,
});

const EV_QUOTE = quote({
  id: "gq-ev-r1",
  ref: "QT-8841-EMIR1",
  revision: 1,
  sentAt: at("2026-08-21T03:20:00.000Z"),
  lines: lines("189.00", "47.50", null, "ev"),
});

const NG_QUOTE = quote({
  id: "gq-ng-r1",
  ref: "QT-8841-NORR1",
  revision: 1,
  sentAt: at("2026-08-20T10:00:00.000Z"),
  lines: lines("190.00", "48.00", "13.00", "ng"),
});

function railThread(overrides: Partial<RailThread> & Pick<RailThread, "businessId" | "slug" | "displayName">): RailThread {
  return {
    declinedAt: null,
    declineReason: null,
    latestQuote: null,
    lastMessage: null,
    sellerHasWritten: false,
    unread: 0,
    deliveredAt: at("2026-08-19T08:00:00.000Z"),
    ...overrides,
  };
}

const RAIL: RailThread[] = [
  railThread({
    businessId: "gb-aw",
    slug: "al-waha-industrial-supplies",
    displayName: "Al Waha Industrial Supplies",
    latestQuote: R2,
    lastMessage: { body: FLOOR.body, fromSeller: true, createdAt: FLOOR.createdAt, attachments: 0 },
    sellerHasWritten: true,
  }),
  railThread({
    businessId: "gb-ev",
    slug: "emirates-valve-and-fitting",
    displayName: "Emirates Valve & Fitting",
    latestQuote: EV_QUOTE,
    lastMessage: {
      body: "Gasket line is not something we stock. Valves and couplings as quoted.",
      fromSeller: true,
      createdAt: new Date(NEGOTIATION_NOW.getTime() - 2 * HOUR),
      attachments: 0,
    },
    sellerHasWritten: true,
    unread: 1,
  }),
  railThread({
    businessId: "gb-ng",
    slug: "northern-gulf-trading",
    displayName: "Northern Gulf Trading",
    latestQuote: NG_QUOTE,
    lastMessage: { body: "Quote attached, valid 14 days.", fromSeller: true, createdAt: at("2026-08-20T10:01:00.000Z"), attachments: 0 },
    sellerHasWritten: true,
  }),
  railThread({ businessId: "gb-tp", slug: "technopump-trading", displayName: "Technopump Trading" }),
];

/** As drawn: four threads, Al Waha open, r2 just arrived, accept offered at 14,600. */
export function boardNegotiation(): Negotiation {
  return {
    enquiry: {
      id: "gallery-enq-8841",
      ref: "ENQ-8841",
      requirement: "Chilled water riser — grooved butterfly valves, rigid couplings and gaskets for the Marina tower plant room.",
      closesAt: at("2026-08-24T08:00:00.000Z"),
      releasedTo: null,
      releasedAt: null,
      winnerName: null,
      buyerCompanyId: null,
    },
    rail: RAIL,
    supplier: {
      id: "gb-aw",
      slug: "al-waha-industrial-supplies",
      displayName: "Al Waha Industrial Supplies",
      categoryCode: "VF",
      published: true,
      verificationTier: 2,
      verifiedAt: at("2026-06-11T08:00:00.000Z"),
      responseTimeMedianMs: 2 * HOUR,
      closed: false,
      declinedAt: null,
      declineReason: null,
      person: { name: "Rajesh Nair", role: "seller_sales" },
    },
    record: {
      messages: [ASK, FLOOR],
      quotes: [R1, R2],
      requirement: REQUIREMENT,
    },
  };
}

/** Technopump: nothing back. The row stays, the thread is empty, and a message still reaches them. */
export function noReplyNegotiation(): Negotiation {
  const board = boardNegotiation();
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8842" },
    supplier: {
      ...board.supplier,
      id: "gb-tp",
      slug: "technopump-trading",
      displayName: "Technopump Trading",
      categoryCode: "PU",
      verificationTier: 1,
      responseTimeMedianMs: null,
      person: null,
    },
    record: { messages: [], quotes: [], requirement: REQUIREMENT },
  };
}

/** Emirates Valve: two of three lines priced. The rest stands; the gasket row is grey and totals nothing. */
export function partialNegotiation(): Negotiation {
  const board = boardNegotiation();
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8843" },
    supplier: { ...board.supplier, id: "gb-ev", slug: "emirates-valve-and-fitting", displayName: "Emirates Valve & Fitting", person: null },
    record: {
      messages: [
        message({
          id: "gm-ev",
          body: "Gasket line is not something we stock. Valves and couplings as quoted.",
          fromSeller: true,
          createdAt: new Date(NEGOTIATION_NOW.getTime() - 2 * HOUR),
          quoteRevisionId: EV_QUOTE.id,
        }),
      ],
      quotes: [EV_QUOTE],
      requirement: REQUIREMENT,
    },
  };
}

/** r3 on top of r2: each revision struck against the one before, and the accept names the latest. */
export function thirdRevisionNegotiation(): Negotiation {
  const board = boardNegotiation();
  const r3 = quote({
    id: "gq-aw-r3",
    ref: "QT-8841-ALWR3",
    revision: 3,
    sentAt: at("2026-08-21T05:24:00.000Z"),
    lines: lines("190.00", "45.00", "12.00", "r3"),
  });
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8844" },
    record: {
      ...board.record,
      messages: [
        ...board.record.messages,
        message({ id: "gm-r3-ask", body: "Can you do 190 and 45 on the couplings if we confirm today?", fromSeller: false, createdAt: at("2026-08-21T05:19:00.000Z"), readAt: at("2026-08-21T05:22:00.000Z") }),
        message({
          id: "gm-r3",
          body: "190 and 45, confirmed today only. Datasheets attached.",
          fromSeller: true,
          createdAt: at("2026-08-21T05:24:00.000Z"),
          quoteRevisionId: r3.id,
          attachments: [
            { documentId: "gd-ds-valve", filename: "AW butterfly valve DN100 datasheet.pdf", bytes: 412_000, mimeType: "application/pdf" },
            { documentId: "gd-ds-coupling", filename: "Rigid coupling 4in UL-FM listing.pdf", bytes: 188_000, mimeType: "application/pdf" },
          ],
        }),
      ],
      quotes: [...board.record.quotes, r3],
    },
  };
}

/** r2's window passed with nothing accepted: the accept is disabled and says why, and a chip asks for a new revision. */
export function expiredNegotiation(): Negotiation {
  const board = boardNegotiation();
  const expired = { ...R2, expiresAt: new Date(NEGOTIATION_NOW.getTime() - 3 * HOUR) };
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8845" },
    record: { ...board.record, quotes: [R1, expired] },
  };
}

/** Northern Gulf accepted: read-only here, with *declined* on it, per `7c`'s auto-decline. */
export function acceptedElsewhereNegotiation(): Negotiation {
  const board = boardNegotiation();
  return {
    ...board,
    enquiry: {
      ...board.enquiry,
      ref: "ENQ-8846",
      releasedTo: "gb-ng",
      releasedAt: at("2026-08-21T07:00:00.000Z"),
      winnerName: "Northern Gulf Trading",
      buyerCompanyId: null,
      closesAt: at("2026-08-21T07:00:00.000Z"),
    },
    record: { ...board.record, quotes: [R1, { ...R2, status: "lost" }] },
  };
}

/** Closed with nothing accepted: read-only, and re-send is `10e`'s path. */
export function closedNegotiation(): Negotiation {
  const board = boardNegotiation();
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8847", closesAt: at("2026-08-21T04:00:00.000Z") },
  };
}

/** Accepted here: the record is one link away, and the pair keep talking. */
export function acceptedHereNegotiation(): Negotiation {
  const board = boardNegotiation();
  return {
    ...board,
    enquiry: { ...board.enquiry, ref: "ENQ-8848", releasedTo: "gb-aw", releasedAt: at("2026-08-21T05:25:00.000Z") },
    record: { ...board.record, quotes: [R1, { ...R2, status: "accepted" }] },
  };
}

/**
 * Build plan 9.4: the board's own thread, read by an account that may not accept
 * — a staff role with no buyer one. Its own reference, like every other state,
 * so the gallery never carries two rails named for one enquiry.
 */
export function notPermittedNegotiation(): Negotiation {
  const board = boardNegotiation();
  return { ...board, enquiry: { ...board.enquiry, ref: "ENQ-8849" } };
}
