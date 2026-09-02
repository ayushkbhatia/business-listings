import type { PrismaClient } from "../lib/db/generated/client.js";

/**
 * Board 6a — enough supply in one area for a page to publish, and one that
 * cannot.
 *
 * The step 3 checkpoint is "show me a page blocked by the threshold and the
 * same page publishing once seed data crosses it", and the threshold is 60
 * listings at 30% verified. The seed has 40 businesses across six trades and
 * four emirates, so before this every possible area page was blocked and the
 * publishing half of the checkpoint could not be shown at all.
 *
 * So: one pair — HVAC in Al Quoz Industrial 1 — recruited past the floor, and
 * a second pair left deliberately short. Both carry an intro over the 250-word
 * floor, so the only thing separating them is supply, which is the thing the
 * criterion is about.
 *
 * Deterministic and PRNG-free, like `seed-subcategories.mts` and for the same
 * reason: the main seed's random draw is a sequence, and taking one from it
 * renames every business generated afterwards.
 */

/** Comfortably past 60, with 24 of them verified — 38%, over the 30% floor. */
const PUBLISHING = { areaSlug: "al-quoz-industrial-1", categorySlug: "hvac-and-ventilation", listings: 62, verified: 24 };

/** Deliberately short. The other half of the checkpoint. */
const BLOCKED = { areaSlug: "ras-al-khor-industrial-2", categorySlug: "safety-and-ppe", listings: 9, verified: 4 };

const PUBLISHING_INTRO = `
Al Quoz Industrial 1 is where Dubai's HVAC trade actually sits. The cluster grew around the
sheet-metal fabricators on Street 6 and the chiller service yards behind them, and it stayed
because a contractor collecting a replacement AHU coil at seven in the morning can be on a
site in Business Bay before the shift starts. That fifteen-minute run is the whole reason the
area matters, and it is why a supplier here will quote a same-day collection that one in
Jebel Ali cannot.

What is in the area is mostly ducting, air handling and controls rather than plant. Sheet
metal is fabricated to order within the area itself, so a duct run drawn on a Sunday is
usually collectable by Wednesday; anything imported — chillers, large AHUs, VRF outdoor units
— comes through a Jebel Ali or Port Rashid consignment and carries a longer lead time no
supplier in Al Quoz can shorten. Buyers who need both on one order should expect two delivery
dates, and a supplier who promises one is worth a second question.

Trade counters here keep normal Dubai industrial hours: Saturday through Thursday, most from
eight until six, with a break in the early afternoon during Ramadan. A few of the larger
stockists run a Friday morning counter for emergency call-outs, which is worth knowing when a
plant room fails on a Thursday night.

Prices are not published on this page and never will be. Ductwork is priced by the metre
against a drawing, coils are priced against a schedule, and neither is a number that means
anything until a supplier has seen what you need. Send the specification and the suppliers
below will quote against it directly.

The listings on this page are the businesses with premises in Al Quoz Industrial 1 whose
primary trade is HVAC and ventilation. The verified ones have had their trade licence checked
against the issuing authority, and in some cases have had our field team stand in the
building. That check is ours, it is not sold, and it renders the same on every listing here.
`.trim();

const BLOCKED_INTRO = `
Ras Al Khor Industrial 2 is a working area rather than a trading one. It is dominated by
fabrication and vehicle workshops, and the safety supply that exists here is mostly counters
attached to those businesses rather than dedicated PPE stockists — which is why the listings
below are few, and why this page is not one we put in front of a search engine yet.

The businesses that are here tend to hold the consumable end: gloves, coveralls, basic eye
protection and the harnesses a fabrication shop gets through. Anything certified to a
specific standard — arc flash, gas detection, fall arrest rated for a particular anchor — is
generally ordered rather than collected, and most of the counters here will point a buyer at
a Deira or Sharjah supplier for it rather than pretend otherwise.

Delivery across the creek into Business Bay and Downtown is quick, and that is the area's
real advantage for a site running short mid-shift. For a planned order, the depth is
elsewhere.

Buyers who need volume, or a specific standard, should widen the search to Dubai as a whole
rather than working from this page. The enquiry form sends one requirement to up to eight
suppliers at once, which is a faster route to a real answer than calling counters in an area
that does not specialise in what you need.

Prices are between you and the supplier. We do not publish them, we never see them, and no
supplier pays us for a position in this list. What we check is the trade licence, and the
badge on each listing says what was checked and when.
`.trim();

interface Recruit {
  areaSlug: string;
  categorySlug: string;
  listings: number;
  verified: number;
  intro: string;
  publish: boolean;
}

async function recruit(db: PrismaClient, spec: Recruit) {
  const area = await db.area.findUniqueOrThrow({
    where: { slug: spec.areaSlug },
    select: { id: true, emirate: true, lat: true, lng: true },
  });
  const category = await db.category.findUniqueOrThrow({
    where: { slug: spec.categorySlug },
    select: { id: true },
  });

  const prefix = `${spec.areaSlug.split("-")[0]}-${spec.categorySlug.split("-")[0]}`;

  const existing = await db.business.count({
    where: {
      primaryCategoryId: category.id,
      locations: { some: { areaId: area.id, published: true } },
      suspendedAt: null,
      publishedAt: { not: null },
      mergedIntoId: null,
    },
  });

  for (let i = existing; i < spec.listings; i += 1) {
    const n = String(i + 1).padStart(3, "0");
    // Verified ones first, so the share is exact rather than approximate.
    const tier = i < spec.verified ? 2 : 0;

    await db.business.create({
      data: {
        tradeName: `${prefix.toUpperCase()} Supplies ${n} LLC`,
        displayName: `${prefix.toUpperCase()} Supplies ${n}`,
        slug: `${prefix}-${n}`,
        licenceNumber: `DED-9${n}${prefix.length}${i}`,
        licenceAuthority: "DED",
        // Fixed, not relative: a licence that expires while the suite runs
        // would drop the tier and take the page below the verified floor
        // halfway through a test run.
        licenceExpiry: new Date(Date.UTC(2027, 11, 31)),
        primaryCategoryId: category.id,
        /*
           A line of the seller's own words.

           Board 1b's result row is built around one: name, trade, then two
           sentences saying what they actually stock. Without it the card is a
           name and a rating with a hole where the reason to click goes, and
           sixty of these rows are most of what the HVAC page shows.
        */
        description:
          `Trade counter and scheduled delivery across ${emirateName(area.emirate)}. ` +
          `Stocked lines ex-shelf, everything else to order with a confirmed lead time.`,
        claimStatus: "unclaimed",
        publishedAt: new Date(Date.UTC(2026, 0, 1)),
        verificationTier: tier,
        verifiedAt: tier > 0 ? new Date(Date.UTC(2026, 5, 1)) : null,
        source: "licence_import",
        /*
           The facts board 1b's row puts on a card as chips.

           All three come off a licence or a phone call, which is why they are
           set here and `ratingOverall` is not: a rating is derived from reviews
           by `recomputeDerived`, and inventing one would put "4.5 · 15 reviews"
           on a card with no reviews behind it. A trust signal nobody earned is
           the one thing this directory cannot seed.

           Deterministic from the index, so two runs agree.
        */
        establishedYear: 1996 + (i % 27),
        trn: `100${String(400000000 + i * 7919).padStart(9, "0")}${String(100 + (i % 900))}`.slice(0, 15),
        locations: {
          create: {
            type: "trade_counter",
            emirate: area.emirate,
            areaId: area.id,
            addressLine: `Warehouse ${n}, Street 6`,
            published: true,
            /*
               A number on two in three, and verified on those.

               `Location.whatsapp` is only ever shown to a buyer when
               `phoneVerified` — the schema says so and the results row honours
               it — so seeding one without the flag would seed a button nobody
               can ever press.
            */
            ...(i % 3 === 2
              ? {}
              : {
                  phone: `+9714${String(2000000 + i * 37).slice(0, 7)}`,
                  whatsapp: `+9715${String(2000000 + i * 37).slice(0, 7)}`,
                  phoneVerified: true,
                }),
            /*
               Scattered around the area centre on a fixed lattice — the map is
               part of board 6a and a page whose every pin sits on one point is
               not a map. Deterministic, so two seeds put them in the same
               places and a screenshot diff shows real changes only.

               One in seven is left unpinned, because that is the real state of
               the data and the map says how many it is holding back.
            */
            ...(i % 7 === 6 || area.lat === null || area.lng === null
              ? {}
              : {
                  lat: area.lat + ((i % 9) - 4) * 0.0016,
                  lng: area.lng + ((Math.floor(i / 9) % 9) - 4) * 0.0016,
                }),
          },
        },
      },
    });
  }

  await db.areaPage.upsert({
    where: { areaId_categoryId: { areaId: area.id, categoryId: category.id } },
    create: {
      areaId: area.id,
      categoryId: category.id,
      intro: spec.intro,
      publishedAt: spec.publish ? new Date(Date.UTC(2026, 6, 1)) : null,
    },
    update: {
      intro: spec.intro,
      publishedAt: spec.publish ? new Date(Date.UTC(2026, 6, 1)) : null,
    },
  });

  const words = spec.intro.trim().split(/\s+/).filter(Boolean).length;
  console.log(
    `   ${spec.areaSlug}/${spec.categorySlug}: ${spec.listings} listings, ${spec.verified} verified, ${words} words${spec.publish ? ", published" : ", held back"}`,
  );
}

/** "abu_dhabi" reads as "Abu Dhabi" in a sentence, not as an enum. */
function emirateName(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function seedAreaPages(db: PrismaClient) {
  await recruit(db, { ...PUBLISHING, intro: PUBLISHING_INTRO, publish: true });
  await recruit(db, { ...BLOCKED, intro: BLOCKED_INTRO, publish: false });
}
