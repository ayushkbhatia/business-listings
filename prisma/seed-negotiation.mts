import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board `10h` — a negotiation in progress, and one to accept from.
 *
 * `ENQ-8881` is the board as drawn: one requirement sent to four suppliers,
 * and the four things that happen to a fan-out — a revision twelve minutes old
 * after the buyer named a rival's price, a quote that declines one line, a flat
 * quote from yesterday, and silence. Read-only in the acceptance suite; a
 * message sent there is additive and changes no count a spec asserts.
 *
 * `ENQ-8882` is the one the acceptance suite accepts from the thread, so the
 * destructive spec consumes a fixture of its own rather than the board's
 * (memory: destructive e2e tests eat fixtures).
 *
 * Their own account-less buyer with a fixed claim token, like `7c`'s and
 * `3j-s`'s, so no spec counting another buyer's enquiries moves.
 *
 * **The wall clock, not `NOW`.** The board's figure is *12 min ago*; anchored to
 * noon Dubai, a morning seed would date the revision in the future.
 *
 * Suppliers: claimed, published goods sellers on a paid plan — Pro has no
 * monthly cap and Basic's forty is far above what these rows add, so
 * `onlyOneSellerAtCap` never trims them — valves first (the trade the fixture's
 * lines are in), then the fewest recipient rows already, and never a seller
 * another spec signs in as or counts replies on.
 * PRNG-free.
 */

type Db = PrismaClient;

export const NEGOTIATION_CLAIM_TOKEN = "seed-0000-4000-8000-provisional04";
export const NEGOTIATION_ENQUIRY_ID = "seedenquirynegotiation001";
export const NEGOTIATION_ACCEPT_ENQUIRY_ID = "seedenquirynegotiation002";

const BUYER_ID = "00000000-0000-4000-8000-0000000010a0";
const SEAT_IDS = [
  "00000000-0000-4000-8000-0000000010a1",
  "00000000-0000-4000-8000-0000000010a2",
  "00000000-0000-4000-8000-0000000010a3",
];
const SEAT_NAMES = ["Rajesh Nair", "Sana Qureshi", "Imran Siddiqui"];

/** Slugs other specs sign in as or assert counts on. */
const RESERVED = [
  "al-marwan-industrial-supplies-llc",
  "al-manara-equipment-trading-llc",
  "al-waha-industrial-supplies",
  "emirates-facilities-group",
  // Board 4f's reply-rate fixture: "4 of 12 answered". A silent row here would move it.
  "technopump-trading-llc",
];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The same mark `nextQuoteRef` puts in a reference: the enquiry number and the seller's code. */
function quoteRef(enquiryRef: string, slug: string, revision: number): string {
  const mark = slug.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "SUP";
  return `QT-${enquiryRef.replace(/^ENQ-/, "")}-${mark}R${revision}`;
}

export async function seedNegotiationThreads(db: Db, now: Date) {
  console.log("→ negotiation threads, for board 10h");
  const at = (ms: number) => new Date(now.getTime() + ms);

  const candidates = await db.business.findMany({
    where: {
      claimStatus: "claimed",
      publishedAt: { not: null },
      suspendedAt: null,
      closureRequestedAt: null,
      planId: { in: ["pro", "basic"] },
      sellsKind: { not: "services" },
      slug: { notIn: RESERVED },
    },
    orderBy: [{ slug: "asc" }],
    select: {
      id: true,
      slug: true,
      displayName: true,
      primaryCategory: { select: { slug: true, parent: { select: { slug: true } } } },
      _count: { select: { recipients: true } },
    },
  });
  const valves = (business: (typeof candidates)[number]) =>
    Number(
      business.primaryCategory?.slug === "valves-and-fittings" ||
        business.primaryCategory?.parent?.slug === "valves-and-fittings",
    );
  const ordered = [...candidates].sort(
    (a, b) =>
      valves(b) - valves(a) ||
      a._count.recipients - b._count.recipients ||
      a.slug.localeCompare(b.slug),
  );
  if (ordered.length < 4) {
    // Loud rather than silent: a spec asserting on ENQ-8881 fails with a reason.
    throw new Error(`Board 10h fixtures need 4 claimed goods suppliers on a paid plan; the seed has ${ordered.length}.`);
  }
  const [revised, partial, flat, silent] = ordered as [(typeof ordered)[number], (typeof ordered)[number], (typeof ordered)[number], (typeof ordered)[number]];

  const buyer = await db.user.create({
    data: {
      id: BUYER_ID,
      phone: "+971544120104",
      fullName: "Priya Menon",
      roles: [],
      isProvisional: true,
      claimToken: NEGOTIATION_CLAIM_TOKEN,
    },
    select: { id: true },
  });

  /* A seat per answering supplier, so every message is attributable to a person. */
  const seats = new Map<string, string>();
  for (const [index, business] of [revised, partial, flat].entries()) {
    const existing = await db.user.findFirst({
      where: { businessId: business.id, roles: { hasSome: ["seller_sales", "seller_owner", "seller_manager"] } },
      orderBy: { id: "asc" },
      select: { id: true },
    });
    const seat =
      existing ??
      (await db.user.create({
        data: {
          id: SEAT_IDS[index]!,
          phone: `+97155704${String(1210 + index)}`,
          fullName: SEAT_NAMES[index]!,
          roles: ["seller_sales"],
          businessId: business.id,
        },
        select: { id: true },
      }));
    seats.set(business.id, seat.id);
  }

  /* ── ENQ-8881: as drawn ─────────────────────────────────────────────────── */

  const drawn = await db.enquiry.create({
    data: {
      id: NEGOTIATION_ENQUIRY_ID,
      ref: "ENQ-8881",
      buyerId: buyer.id,
      requirement:
        "Chilled water riser — grooved butterfly valves, rigid couplings and gaskets for a Dubai Marina tower plant room. UL/FM listed, one drop on the 4th.",
      deliverToArea: "Dubai Marina",
      emirate: "dubai",
      termsWanted: "net_30",
      closesAt: at(3 * DAY),
      createdAt: at(-50 * HOUR),
      lines: {
        create: [
          { description: "Grooved butterfly valve DN100, UL/FM", qty: 40, unit: "pcs", size: "DN100", targetUnitPriceAed: "190.00", sortOrder: 0 },
          { description: "Grooved rigid coupling, 4 inch", qty: 120, unit: "pcs", size: "DN100", sortOrder: 1 },
          { description: "Grooved gasket, EPDM, 4 inch", qty: 120, unit: "pcs", size: "DN100", sortOrder: 2 },
        ],
      },
      recipients: {
        create: [
          { businessId: revised.id, state: "quoted", openedAt: at(-49 * HOUR), firstReplyAt: at(-41 * HOUR), createdAt: at(-50 * HOUR) },
          { businessId: partial.id, state: "quoted", openedAt: at(-30 * HOUR), firstReplyAt: at(-2 * HOUR), createdAt: at(-50 * HOUR) },
          { businessId: flat.id, state: "quoted", openedAt: at(-44 * HOUR), firstReplyAt: at(-26 * HOUR), createdAt: at(-50 * HOUR) },
          // B9: nothing back. A state, not an absence — and what 4f reads.
          { businessId: silent.id, state: "delivered", createdAt: at(-50 * HOUR) },
        ],
      },
    },
    select: { id: true, ref: true, lines: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
  const [valve, coupling, gasket] = drawn.lines as [{ id: string }, { id: string }, { id: string }];
  const goods = (prices: [string, string | null, string | null], leads: [number, number, number] = [0, 0, 2]) =>
    [
      { enquiryLineId: valve.id, description: "Grooved butterfly valve DN100, UL/FM", qty: 40, unitPrice: prices[0], leadTimeDays: leads[0], sortOrder: 0 },
      prices[1] === null
        ? null
        : { enquiryLineId: coupling.id, description: "Grooved rigid coupling, 4 inch", qty: 120, unitPrice: prices[1], leadTimeDays: leads[1], sortOrder: 1 },
      prices[2] === null
        ? null
        : { enquiryLineId: gasket.id, description: "Grooved gasket, EPDM, 4 inch", qty: 120, unitPrice: prices[2], leadTimeDays: leads[2], sortOrder: 2 },
    ].filter((line): line is NonNullable<typeof line> => line !== null);

  // Al Waha's part: r1, the buyer's counter naming a rival, r2 at the floor.
  const r1Sent = at(-41 * HOUR);
  await db.quote.create({
    data: {
      ref: quoteRef(drawn.ref, revised.slug, 1),
      enquiryId: drawn.id,
      businessId: revised.id,
      revision: 1,
      validityDays: 14,
      status: "read",
      note: "Quote attached — 40 valves at AED 198, couplings at 46, gaskets at 12. Ex-stock on the first two, two days on the gasket. Two-drop delivery included.",
      sentAt: r1Sent,
      readAt: at(-40 * HOUR),
      expiresAt: new Date(r1Sent.getTime() + 14 * DAY),
      createdAt: r1Sent,
      paymentTerms: "net_30",
      delivery: "included",
      // 40 × 198 + 120 × 46 + 120 × 12 = 14,880.00 — summed at render, never stored.
      lines: { create: goods(["198.00", "46.00", "12.00"]) },
    },
  });
  const r2Sent = at(-12 * MIN);
  const r2 = await db.quote.create({
    data: {
      ref: quoteRef(drawn.ref, revised.slug, 2),
      enquiryId: drawn.id,
      businessId: revised.id,
      revision: 2,
      validityDays: 14,
      status: "sent",
      sentAt: r2Sent,
      expiresAt: new Date(r2Sent.getTime() + 14 * DAY),
      createdAt: r2Sent,
      paymentTerms: "net_30",
      delivery: "included",
      // 40 × 191 + 120 × 46 + 120 × 12 = 14,600.00 — the figure 7c was corrected to.
      lines: { create: goods(["191.00", "46.00", "12.00"]) },
    },
    select: { id: true },
  });

  const partialSent = at(-2 * HOUR);
  const partialQuote = await db.quote.create({
    data: {
      ref: quoteRef(drawn.ref, partial.slug, 1),
      enquiryId: drawn.id,
      businessId: partial.id,
      revision: 1,
      validityDays: 10,
      status: "sent",
      sentAt: partialSent,
      expiresAt: new Date(partialSent.getTime() + 10 * DAY),
      createdAt: partialSent,
      paymentTerms: "advance",
      delivery: "collection",
      // The gasket line is not quoted: it renders grey and totals nothing.
      lines: { create: goods(["189.00", "47.50", null], [3, 3, 0]) },
    },
    select: { id: true },
  });

  const flatSent = at(-26 * HOUR);
  await db.quote.create({
    data: {
      ref: quoteRef(drawn.ref, flat.slug, 1),
      enquiryId: drawn.id,
      businessId: flat.id,
      revision: 1,
      validityDays: 14,
      status: "read",
      sentAt: flatSent,
      readAt: at(-25 * HOUR),
      expiresAt: new Date(flatSent.getTime() + 14 * DAY),
      createdAt: flatSent,
      lines: { create: goods(["190.00", "48.00", "13.00"], [2, 2, 2]) },
    },
  });

  await db.message.createMany({
    data: [
      {
        enquiryId: drawn.id,
        businessId: revised.id,
        senderId: buyer.id,
        authorSide: "buyer",
        body: "Northern Gulf are at 190 on the valve. Can you match it? Happy to take all 40 in one drop on the 4th if that helps.",
        createdAt: at(-39 * HOUR - 19 * MIN),
        readAt: at(-38 * HOUR),
      },
      {
        enquiryId: drawn.id,
        businessId: revised.id,
        senderId: seats.get(revised.id)!,
        authorSide: "seller",
        body: "One drop makes it easier — 198 down to 191 on the valve, everything else the same. That is our floor on UL/FM stock.",
        quoteRevisionId: r2.id,
        createdAt: r2Sent,
      },
      {
        enquiryId: drawn.id,
        businessId: partial.id,
        senderId: seats.get(partial.id)!,
        authorSide: "seller",
        body: "Gasket line is not something we stock. Valves and couplings as quoted, three days from order.",
        quoteRevisionId: partialQuote.id,
        createdAt: partialSent,
      },
      {
        enquiryId: drawn.id,
        businessId: flat.id,
        senderId: seats.get(flat.id)!,
        authorSide: "seller",
        body: "Quote attached, valid 14 days.",
        createdAt: new Date(flatSent.getTime() + MIN),
        readAt: at(-25 * HOUR),
      },
    ],
  });

  /* ── ENQ-8882: the one the acceptance suite accepts from the thread ─────── */

  const acceptable = await db.enquiry.create({
    data: {
      id: NEGOTIATION_ACCEPT_ENQUIRY_ID,
      ref: "ENQ-8882",
      buyerId: buyer.id,
      requirement: "Grooved couplings and gaskets for a sprinkler riser top-up. Collection from Al Quoz is fine.",
      deliverToArea: "Al Quoz Industrial 3",
      emirate: "dubai",
      closesAt: at(5 * DAY),
      createdAt: at(-20 * HOUR),
      lines: {
        create: [
          { description: "Grooved rigid coupling, 4 inch", qty: 60, unit: "pcs", size: "DN100", sortOrder: 0 },
          { description: "Grooved gasket, EPDM, 4 inch", qty: 60, unit: "pcs", size: "DN100", sortOrder: 1 },
        ],
      },
      recipients: {
        create: [
          { businessId: revised.id, state: "quoted", openedAt: at(-19 * HOUR), firstReplyAt: at(-6 * HOUR), createdAt: at(-20 * HOUR) },
          { businessId: flat.id, state: "quoted", openedAt: at(-18 * HOUR), firstReplyAt: at(-5 * HOUR), createdAt: at(-20 * HOUR) },
        ],
      },
    },
    select: { id: true, ref: true, lines: { orderBy: { sortOrder: "asc" }, select: { id: true } } },
  });
  const [c2, g2] = acceptable.lines as [{ id: string }, { id: string }];
  for (const [business, prices, hoursAgo] of [
    [revised, ["45.00", "11.50"], 6],
    [flat, ["47.00", "12.50"], 5],
  ] as const) {
    const sentAt = at(-hoursAgo * HOUR);
    await db.quote.create({
      data: {
        ref: quoteRef(acceptable.ref, business.slug, 1),
        enquiryId: acceptable.id,
        businessId: business.id,
        revision: 1,
        validityDays: 14,
        status: "sent",
        sentAt,
        expiresAt: new Date(sentAt.getTime() + 14 * DAY),
        createdAt: sentAt,
        lines: {
          create: [
            { enquiryLineId: c2.id, description: "Grooved rigid coupling, 4 inch", qty: 60, unitPrice: prices[0], leadTimeDays: 0, sortOrder: 0 },
            { enquiryLineId: g2.id, description: "Grooved gasket, EPDM, 4 inch", qty: 60, unitPrice: prices[1], leadTimeDays: 1, sortOrder: 1 },
          ],
        },
      },
    });
  }

  console.log(
    `   ${drawn.ref} with ${revised.displayName}, ${partial.displayName}, ${flat.displayName} and ${silent.displayName}; ${acceptable.ref} to accept`,
  );
}
