import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board `10f` — a buyer with a review to write, and every state beside it.
 *
 * One account-less buyer with a fixed claim token, a registered company so the
 * *signed as* choice has both options, and six enquiries — one per state the
 * page renders:
 *
 *   ENQ-8891  accepted 44 days ago, a draft in progress        — the board as drawn
 *   ENQ-8892  accepted 20 days ago, nothing written            — the acceptance suite posts here
 *   ENQ-8893  sent, no supplier replied                        — not eligible
 *   ENQ-8894  accepted 120 days ago                            — the window has closed
 *   ENQ-8895  reviewed 20 days ago, and the supplier replied   — read-only
 *   ENQ-8896  reviewed 2 days ago                              — editable; the suite edits it
 *
 * **Suppliers of its own**, claimed, verified, on Pro and never published — the
 * lesson `10h`'s fixtures learned in CI: every claimed paid seller already feeds
 * some measured fixture, and a review on one moves its rating on 1m, 4f and the
 * storefront. Unpublished, they reach no public count; and an unlisted supplier
 * is a real state the page handles (the review is kept against the record and
 * the buyer is not sent to a listing page that does not exist).
 *
 * The wall clock, not `NOW`: the window is measured in Dubai days from
 * acceptance, and a day anchor would move the board's *open until* date.
 * PRNG-free.
 */

type Db = PrismaClient;

export const REVIEW_WRITE_CLAIM_TOKEN = "seed-0000-4000-8000-provisional05";
export const REVIEW_WRITE_ENQUIRY_IDS = {
  drawn: "seedenquiryreviewwrite001",
  post: "seedenquiryreviewwrite002",
  silent: "seedenquiryreviewwrite003",
  closed: "seedenquiryreviewwrite004",
  replied: "seedenquiryreviewwrite005",
  editable: "seedenquiryreviewwrite006",
} as const;

const BUYER_ID = "00000000-0000-4000-8000-0000000010b0";
const SEAT_IDS = ["00000000-0000-4000-8000-0000000010b1", "00000000-0000-4000-8000-0000000010b2", "00000000-0000-4000-8000-0000000010b3"];

const SUPPLIERS = [
  { slug: "sparkle-facilities-services-fixture", name: "Sparkle Facilities Services", licence: "DED-889101", category: "facilities-management-and-cleaning", seat: "Anil Varghese" },
  { slug: "coastline-valve-trading-fixture", name: "Coastline Valve Trading", licence: "DED-889102", category: "valves-and-fittings", seat: "Omar Haddad" },
  { slug: "fireline-ducting-works-fixture", name: "Fireline Ducting Works", licence: "DED-889103", category: "facilities-management-and-cleaning", seat: "Rohit Menon" },
] as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export async function seedReviewWrite(db: Db, now: Date) {
  console.log("→ reviews to write, for board 10f");
  const at = (ms: number) => new Date(now.getTime() + ms);

  const created = [];
  for (const [index, supplier] of SUPPLIERS.entries()) {
    const category =
      (await db.category.findFirst({ where: { slug: supplier.category }, select: { id: true } })) ??
      (await db.category.findFirst({ orderBy: { id: "asc" }, select: { id: true } }));
    const business = await db.business.create({
      data: {
        tradeName: `${supplier.name} LLC`,
        displayName: supplier.name,
        slug: supplier.slug,
        licenceNumber: supplier.licence,
        licenceAuthority: "DED",
        licenceExpiry: at(400 * DAY),
        verificationTier: 2,
        verifiedAt: at(-200 * DAY),
        claimStatus: "claimed",
        planId: "pro",
        primaryCategoryId: category!.id,
        source: "self_added",
        // Never published: see the file comment.
        publishedAt: null,
        createdAt: at(-500 * DAY),
      },
      select: { id: true },
    });
    await db.user.create({
      data: {
        id: SEAT_IDS[index]!,
        phone: `+97155704${String(1310 + index)}`,
        fullName: supplier.seat,
        roles: ["seller_sales"],
        businessId: business.id,
      },
    });
    created.push(business);
  }
  const [sparkle, coastline, fireline] = created as [{ id: string }, { id: string }, { id: string }];

  const company = await db.buyerCompany.create({
    data: { name: "Marina Facilities LLC", emirate: "dubai", createdAt: at(-300 * DAY) },
    select: { id: true },
  });
  const buyer = await db.user.create({
    data: {
      id: BUYER_ID,
      phone: "+971544120105",
      fullName: "Priya Menon",
      roles: [],
      isProvisional: true,
      claimToken: REVIEW_WRITE_CLAIM_TOKEN,
      buyerCompanyId: company.id,
    },
    select: { id: true },
  });

  /**
   * One accepted enquiry: quote first, then the release — the order acceptance
   * produces, and the one `quote_not_sent_after_acceptance` insists on.
   */
  const accepted = async (input: {
    id: string;
    ref: string;
    supplier: { id: string };
    requirement: string;
    area: string;
    acceptedDaysAgo: number;
    lines: { description: string; qty: number; unitPrice: string }[];
  }) => {
    const acceptedAt = at(-input.acceptedDaysAgo * DAY);
    const sentAt = new Date(acceptedAt.getTime() - 3 * DAY);
    const enquiry = await db.enquiry.create({
      data: {
        id: input.id,
        ref: input.ref,
        buyerId: buyer.id,
        buyerCompanyId: company.id,
        requirement: input.requirement,
        deliverToArea: input.area,
        closesAt: new Date(acceptedAt.getTime() - HOUR),
        createdAt: new Date(sentAt.getTime() - 2 * DAY),
        lines: {
          create: input.lines.map((line, index) => ({ description: line.description, qty: line.qty, sortOrder: index })),
        },
        recipients: {
          create: [
            {
              businessId: input.supplier.id,
              state: "quoted",
              openedAt: new Date(sentAt.getTime() - DAY),
              firstReplyAt: sentAt,
              createdAt: new Date(sentAt.getTime() - 2 * DAY),
            },
          ],
        },
      },
      select: { id: true },
    });
    await db.quote.create({
      data: {
        ref: `QT-${input.ref.replace(/^ENQ-/, "")}-R1`,
        enquiryId: enquiry.id,
        businessId: input.supplier.id,
        revision: 1,
        validityDays: 14,
        status: "accepted",
        sentAt,
        readAt: new Date(sentAt.getTime() + HOUR),
        acceptedAt,
        expiresAt: new Date(sentAt.getTime() + 14 * DAY),
        createdAt: sentAt,
        lines: {
          create: input.lines.map((line, index) => ({
            description: line.description,
            qty: line.qty,
            unitPrice: line.unitPrice,
            leadTimeDays: 2,
            sortOrder: index,
          })),
        },
      },
    });
    await db.enquiry.update({
      where: { id: enquiry.id },
      data: { contactReleasedToBusinessId: input.supplier.id, contactReleasedAt: acceptedAt },
    });
    return enquiry;
  };

  const amc = [{ description: "Deep clean AMC, retail unit, quarterly", qty: 3, unitPrice: "3200.00" }];

  /* ── ENQ-8891: the board as drawn — a draft in progress. ── */
  const drawn = await accepted({
    id: REVIEW_WRITE_ENQUIRY_IDS.drawn,
    ref: "ENQ-8891",
    supplier: sparkle,
    requirement: "Deep clean AMC, 3 retail units. Quarterly visits, out of trading hours.",
    area: "Sharjah",
    acceptedDaysAgo: 44,
    // 3 × 3,200 = 9,600 — summed at render, never stored.
    lines: amc,
  });
  await db.reviewDraft.create({
    data: {
      enquiryId: drawn.id,
      buyerId: buyer.id,
      businessId: sparkle.id,
      overall: 4,
      quotedAccurate: 5,
      onTime: 3,
      asDescribed: 4,
      responsiveness: 5,
      body: "Quote matched the final invoice to the dirham. Crew arrived a day late on the first visit but stayed until it was done, and the supervisor answers his phone.",
      showCompanyName: true,
      updatedAt: at(-6 * 60_000),
    },
  });

  /* ── ENQ-8892: accepted, nothing written. The acceptance suite posts the review. ── */
  await accepted({
    id: REVIEW_WRITE_ENQUIRY_IDS.post,
    ref: "ENQ-8892",
    supplier: coastline,
    requirement: "Chilled water riser — 40 grooved butterfly valves, delivered to Al Quoz.",
    area: "Al Quoz Industrial 1",
    acceptedDaysAgo: 20,
    lines: [{ description: "Grooved butterfly valve DN100", qty: 40, unitPrice: "191.00" }],
  });

  /* ── ENQ-8893: sent, nobody replied. Not eligible, with the reason. ── */
  await db.enquiry.create({
    data: {
      id: REVIEW_WRITE_ENQUIRY_IDS.silent,
      ref: "ENQ-8893",
      buyerId: buyer.id,
      buyerCompanyId: company.id,
      requirement: "Fire-rated ducting Ø300, 60 m, for a Jebel Ali warehouse extension.",
      deliverToArea: "Jebel Ali Industrial",
      closesAt: at(-4 * DAY),
      createdAt: at(-11 * DAY),
      lines: { create: [{ description: "Fire-rated duct Ø300", qty: 60, sortOrder: 0 }] },
      recipients: { create: [{ businessId: fireline.id, state: "delivered", createdAt: at(-11 * DAY) }] },
    },
  });

  /* ── ENQ-8894: accepted 120 days ago. The form is absent, and the day is stated. ── */
  await accepted({
    id: REVIEW_WRITE_ENQUIRY_IDS.closed,
    ref: "ENQ-8894",
    supplier: sparkle,
    requirement: "Post-fit-out deep clean, one office floor in Business Bay.",
    area: "Business Bay",
    acceptedDaysAgo: 120,
    lines: [{ description: "Post-construction deep clean, office floor", qty: 1, unitPrice: "4800.00" }],
  });

  /* ── ENQ-8895: reviewed 20 days ago, and the supplier replied. Read-only. ── */
  const replied = await accepted({
    id: REVIEW_WRITE_ENQUIRY_IDS.replied,
    ref: "ENQ-8895",
    supplier: fireline,
    requirement: "Kitchen extract duct cleaning, two restaurant units in Jumeirah.",
    area: "Jumeirah",
    acceptedDaysAgo: 30,
    lines: [{ description: "Kitchen extract duct clean, restaurant unit", qty: 2, unitPrice: "1850.00" }],
  });
  const repliedAt = at(-20 * DAY);
  await db.review.create({
    data: {
      businessId: fireline.id,
      buyerId: buyer.id,
      enquiryId: replied.id,
      overall: 3,
      quotedAccurate: 4,
      onTime: 2,
      asDescribed: 3,
      responsiveness: null,
      body: "The clean itself was thorough and the certificate came the same day, but the team arrived two hours after the agreed slot on both units.",
      showCompanyName: true,
      editableUntil: new Date(repliedAt.getTime() + 14 * DAY),
      sellerReply: "Thank you. The delay was a vehicle problem, and we have added a standby van for early slots.",
      sellerRepliedAt: at(-18 * DAY),
      createdAt: repliedAt,
    },
  });

  /* ── ENQ-8896: reviewed two days ago, inside the fortnight. The suite edits it. ── */
  const editable = await accepted({
    id: REVIEW_WRITE_ENQUIRY_IDS.editable,
    ref: "ENQ-8896",
    supplier: coastline,
    requirement: "Replacement strainers for a pump room, delivered to Mussafah.",
    area: "Mussafah Industrial",
    acceptedDaysAgo: 9,
    lines: [{ description: "Y-strainer DN80, flanged", qty: 6, unitPrice: "310.00" }],
  });
  const postedAt = at(-2 * DAY);
  await db.review.create({
    data: {
      businessId: coastline.id,
      buyerId: buyer.id,
      enquiryId: editable.id,
      overall: 5,
      quotedAccurate: 5,
      onTime: 5,
      asDescribed: null,
      responsiveness: 4,
      body: "Six strainers delivered the day after the quote was accepted, exactly as quoted, with test certificates in the box.",
      showCompanyName: false,
      editableUntil: new Date(postedAt.getTime() + 14 * DAY),
      createdAt: postedAt,
    },
  });

  console.log("   ENQ-8891 as drawn, ENQ-8892 to post, and the four other states for Marina Facilities LLC");
}
