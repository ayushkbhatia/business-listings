import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 6b — enough evidence for a curated list to have anybody on it.
 *
 * The bar is a verified licence, a measured median reply under four hours, and
 * fifteen reviews from real enquiries. The seed had two reviews in total, so
 * every list was empty and criterion 4's interesting half — that a business
 * failing a rule is *absent* — had nothing to be absent from.
 *
 * So: four of the Al Quoz HVAC listings recruited in `seed-area-pages.mts` are
 * given the evidence, and a fifth is given everything except the reply time.
 * That fifth is the point of the fixture. It is verified, well reviewed, and
 * on the most expensive plan in the product, and it is not on the list.
 *
 * Deterministic and PRNG-free, for the reason the other two post-passes are.
 */

/** Matches `MIN_REVIEWS` in lib/seo/curated.ts. Kept in step with it by a test. */
const REVIEWS = 15;

const FAST_MS = 90 * 60_000;
const SLOW_MS = 7 * 3_600_000;

interface Qualifier {
  slug: string;
  replyMs: number;
  visited: boolean;
  /** Deliberately on a paid plan, to prove the plan buys nothing here. */
  plan: string | null;
}

const QUALIFIERS: Qualifier[] = [
  { slug: "al-hvac-001", replyMs: FAST_MS, visited: true, plan: null },
  { slug: "al-hvac-002", replyMs: FAST_MS + 20 * 60_000, visited: false, plan: "pro" },
  { slug: "al-hvac-003", replyMs: FAST_MS + 40 * 60_000, visited: false, plan: null },
  { slug: "al-hvac-004", replyMs: FAST_MS + 60 * 60_000, visited: false, plan: "basic" },
  /*
     The one that proves the rule. Everything a supplier can buy, and one thing
     they cannot: a reply time under four hours. It is measured from real
     enquiry timestamps and there is no field for it, so this listing is off the
     list no matter what it pays.
  */
  { slug: "al-hvac-005", replyMs: SLOW_MS, visited: true, plan: "pro" },
];

export async function seedCurated(db: PrismaClient, now: Date) {
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "hvac-and-ventilation" },
    select: { id: true },
  });
  const area = await db.area.findUniqueOrThrow({
    where: { slug: "al-quoz-industrial-1" },
    select: { id: true },
  });

  let written = 0;

  for (const [index, qualifier] of QUALIFIERS.entries()) {
    const business = await db.business.findUnique({
      where: { slug: qualifier.slug },
      select: { id: true },
    });
    if (!business) continue;

    /*
       No `responseTimeMedianMs` here, deliberately.

       Non-negotiable 6: response time is measured, never claimed. Writing the
       column would be a claim, and `deriveResponseTimes` runs after this and
       would overwrite it with the truth anyway — which is the mechanism doing
       exactly what it was built to do. The reply times below are produced by
       giving each enquiry a real `firstReplyAt`, and the median falls out.
    */
    await db.business.update({
      where: { id: business.id },
      data: {
        claimStatus: "claimed",
        planId: qualifier.plan,
      },
    });

    for (let i = 0; i < REVIEWS; i += 1) {
      const ref = `ENQ-BEST-${index}-${i}`;
      const existing = await db.enquiry.findUnique({ where: { ref }, select: { id: true } });
      if (existing) continue;

      const buyer = await db.user.create({
        data: { id: uuid(500 + index * REVIEWS + i), fullName: `Best List Buyer ${index}-${i}`, roles: ["buyer"] },
        select: { id: true },
      });
      // Inside the measurement window, spread over the month so the median is
      // a median of something rather than fifteen copies of one number.
      const sentAt = new Date(now.getTime() - (5 + (i % 25)) * 86_400_000);
      const enquiry = await db.enquiry.create({
        data: {
          ref,
          buyerId: buyer.id,
          requirement: "Ducting run for a chilled water riser, drawn and dimensioned.",
          closesAt: new Date(sentAt.getTime() + 14 * 86_400_000),
          createdAt: sentAt,
        },
        select: { id: true },
      });
      /*
         Delivered inside the 90-day window `windowStart` uses, and answered
         `replyMs` later. This pair is what `medianResponseMs` reads, so the
         number on the listing is derived from timestamps rather than asserted.
      */
      const deliveredAt = new Date(sentAt.getTime());
      await db.enquiryRecipient.create({
        // `quoted` is the state a review follows from — a buyer can only
        // review a supplier who actually answered them.
        data: {
          enquiryId: enquiry.id,
          businessId: business.id,
          state: "quoted",
          createdAt: deliveredAt,
          firstReplyAt: new Date(deliveredAt.getTime() + qualifier.replyMs),
        },
      });
      await db.review.create({
        data: {
          businessId: business.id,
          buyerId: buyer.id,
          enquiryId: enquiry.id,
          // Varied rather than uniform — a page of straight fives reads as
          // fabricated, which is the opposite of the point of this list.
          overall: 4 + ((i + index) % 2),
          quotedAccurate: 4 + (i % 2),
          onTime: 4 + ((i + 1) % 2),
          asDescribed: 5,
          responsiveness: 4 + (i % 2),
          body: "Quoted against the drawing the same day and delivered on the date they gave.",
          editableUntil: new Date(sentAt.getTime() + 28 * 86_400_000),
          createdAt: new Date(sentAt.getTime() + 3 * 86_400_000),
        },
      });
      written += 1;
    }
  }

  const intro = `
Al Quoz Industrial 1 has more HVAC suppliers than anywhere else in Dubai, which is useful
right up until the point where you have to choose one. This list is what is left when three
rules are applied to all of them, and the rules are printed above the names rather than
hidden behind a sales team.

The rules are not ours to bend. They are applied on every page load rather than at the moment
somebody decided to write the page, so a supplier whose median reply drifts past four hours
comes off the list without a meeting about it, and one who fixes it goes back on. Nobody is
told in advance and nobody can appeal.

What is deliberately absent is anything a supplier can buy. There is no paid position on this
page, no field in our system that could hold one, and no arrangement under which a name moves
up. Two of the suppliers below are on paid subscriptions and two are not, and you cannot tell
which from the order — because the order does not know.

The one thing that lifts a supplier is a verified trade licence: the number on the listing
checked against the issuing authority, DED or the relevant free zone, and re-checked when it
expires. That check is ours, it is not for sale, and it is the only weighted rule.
`.trim();

  await db.curatedList.upsert({
    where: { slug: "hvac-suppliers-al-quoz" },
    create: {
      slug: "hvac-suppliers-al-quoz",
      title: "HVAC suppliers in Al Quoz that answer quickly",
      intro,
      categoryId: category.id,
      areaId: area.id,
      publishedAt: new Date(Date.UTC(2026, 6, 5)),
    },
    update: { intro, publishedAt: new Date(Date.UTC(2026, 6, 5)) },
  });

  console.log(`   ${written} reviews written across ${QUALIFIERS.length} listings`);
  console.log("   hvac-suppliers-al-quoz: published");
}

/** The same deterministic uuid the main seed uses, so ids never collide. */
function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}
