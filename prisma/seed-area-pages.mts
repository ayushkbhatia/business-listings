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

/**
 * A second published area, so the link graph is not a page pointing at nothing.
 *
 * Board 6a §3's nearby-areas card and §6's sibling columns are the reason a new
 * area page gets crawled at all, and both render **only published pages**. With
 * one published page in the seed they were correctly empty, which is the honest
 * cold-start state and is also a state in which nothing about the link graph is
 * exercised — by a person looking at it or by the acceptance tests.
 *
 * Jebel Ali rather than another Al Quoz: the areas have coordinates, the
 * nearby-areas card orders by real travel proximity from the geo table, and two
 * pages in the same industrial estate would not tell anybody whether that
 * ordering works.
 */
const SECOND = { areaSlug: "jebel-ali-free-zone", categorySlug: "hvac-and-ventilation", listings: 61, verified: 22 };

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
against the issuing authority. That check is ours, it is not sold, and it renders the same on
every listing here.
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

interface FaqSeed {
  question: string;
  answer: string;
  scopeSpecific: boolean;
  liveToken: string | null;
}

interface Recruit {
  areaSlug: string;
  categorySlug: string;
  listings: number;
  verified: number;
  intro: string;
  /** §SEO's one written sentence. Absent on the blocked pair, as it would be. */
  metaDescription?: string;
  /** Board 6a's fourth publish condition. */
  faq: FaqSeed[];
  relatedSearches: { label: string; href: string }[];
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

  /*
     Some of them filed under a subcategory, which is what a directory looks
     like and what board 6a §3's chip row is built from.

     Every listing here used to carry the parent trade, so `subcategoryChips`
     found nothing anywhere and the chip row never rendered — a whole section of
     the board that could not be seen on the running site or caught by a test.
     It also made the scope count and the chip counts trivially agree, which is
     the least interesting version of that arithmetic.

     A third of them, spread deterministically across the children the taxonomy
     already has. `landingState` counts the parent and its children together, so
     the page total does not move: 62 is 62 whether they are filed at one level
     or two, which is the property the chips depend on.
  */
  const children = await db.category.findMany({
    where: { parentId: category.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
    take: 4,
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
        /*
           Every third listing goes to a child trade, the rest stay on the
           parent. Deterministic from the index so two seeds agree, and the
           chip counts come out uneven — which is what a real one looks like.
        */
        primaryCategoryId:
          children.length > 0 && i % 3 === 0
            ? (children[Math.floor(i / 3) % children.length]?.id ?? category.id)
            : category.id,
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
            /*
               Hours on four in five, and the stat line depends on the other one.

               Board 6a §3 puts "41 open now" in the hero, computed by
               `lib/trade/open-now.ts` from what board 2d's onboarding step
               writes here — the third caller of that function, not a fourth copy
               of the working week. A branch with none answers "unknown", and a
               scope where nobody has filled them in drops the stat entirely
               rather than rendering nought.

               So one in five is left blank on purpose: it is the real state of
               the data, and it is what makes the count a measurement rather
               than a headcount. Two shift patterns rather than one, so the
               number moves through the day instead of being all or nothing.
            */
            ...(i % 5 === 4
              ? {}
              : {
                  hours:
                    i % 2 === 0
                      ? {
                          sat: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "19:00" }],
                          sun: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "19:00" }],
                          mon: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "19:00" }],
                          tue: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "19:00" }],
                          wed: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "19:00" }],
                          thu: [{ open: "08:00", close: "13:00" }, { open: "16:00", close: "17:00" }],
                          fri: [],
                        }
                      : {
                          // The 24-hour callout counters the intro names.
                          sat: [{ open: "00:00", close: "23:59" }],
                          sun: [{ open: "00:00", close: "23:59" }],
                          mon: [{ open: "00:00", close: "23:59" }],
                          tue: [{ open: "00:00", close: "23:59" }],
                          wed: [{ open: "00:00", close: "23:59" }],
                          thu: [{ open: "00:00", close: "23:59" }],
                          fri: [{ open: "00:00", close: "23:59" }],
                        },
                }),
          },
        },
      },
    });
  }

  /*
     `contentUpdatedAt` is fixed rather than `new Date()`.

     Board 6a §Freshness: the date on the page is a claim about when the content
     changed, and a seed that stamped today would have every seeded page
     claiming to have been updated the morning somebody ran `db:seed`. The
     render deliberately reads 21 Aug 2026 for the same reason, and the e2e
     spec asserts the date does not move on a reseed.
  */
  const page = await db.areaPage.upsert({
    where: { areaId_categoryId: { areaId: area.id, categoryId: category.id } },
    create: {
      areaId: area.id,
      categoryId: category.id,
      intro: spec.intro,
      metaDescription: spec.metaDescription ?? null,
      contentUpdatedAt: new Date(Date.UTC(2026, 7, 21)),
      publishedAt: spec.publish ? new Date(Date.UTC(2026, 6, 1)) : null,
    },
    update: {
      intro: spec.intro,
      metaDescription: spec.metaDescription ?? null,
      contentUpdatedAt: new Date(Date.UTC(2026, 7, 21)),
      publishedAt: spec.publish ? new Date(Date.UTC(2026, 6, 1)) : null,
    },
    select: { id: true },
  });

  // Replaced wholesale, as the service does: `position` is unique per page and
  // updating rows individually walks through a state where two share one.
  await db.landingFaq.deleteMany({ where: { areaPageId: page.id } });
  for (const [position, row] of spec.faq.entries()) {
    await db.landingFaq.create({ data: { areaPageId: page.id, position, ...row } });
  }

  await db.landingRelatedSearch.deleteMany({ where: { areaPageId: page.id } });
  for (const [position, row] of spec.relatedSearches.entries()) {
    await db.landingRelatedSearch.create({
      data: { areaPageId: page.id, position, ...row },
    });
  }

  const words = spec.intro.trim().split(/\s+/).filter(Boolean).length;
  const local = spec.faq.filter((row) => row.scopeSpecific).length;
  console.log(
    `   ${spec.areaSlug}/${spec.categorySlug}: ${spec.listings} listings, ${spec.verified} verified, ${words} words, ${spec.faq.length} questions (${local} local)${spec.publish ? ", published" : ", held back"}`,
  );
}

/**
 * Board 6a's fourth publish condition, seeded.
 *
 *   FAQ rows ≥ 4, at least 2 specific to this scope
 *
 * Two of these four could only be asked about Al Quoz Industrial 1 — the third
 * names its Civil Defence position and the fourth names the neighbourhoods it
 * actually serves and sends the wrong buyer somewhere else. That fourth one is
 * the board's own model for what "specific to this scope" means, and it is the
 * question a shared list with the area name substituted in cannot ask.
 *
 * The first carries `quote_range`, which is the one live token. Open question 2
 * is undecided, so `public_quote_aggregates` is off, so that row does not
 * render — and criterion 11 is testable in both states because the row exists.
 * It still counts towards the gate: the gate is about whether a person wrote
 * four questions for this scope, and they did.
 */
const PUBLISHING_FAQ = [
  {
    question: "What does a chiller AMC cost in Al Quoz?",
    answer:
      "Annual maintenance contracts here run {quote_range}, depending on tonnage and whether spares are included. Comprehensive cover is typically around 40% more than labour-only, and a contract that does not say which it is will be labour-only.",
    scopeSpecific: false,
    liveToken: "quote_range",
  },
  {
    question: "Is the ductwork made here or brought in?",
    answer:
      "Made here. Sheet metal is fabricated to order within the area itself, so a duct run drawn on a Sunday is usually collectable by Wednesday. Chillers, large AHUs and VRF outdoor units come through a Jebel Ali or Port Rashid consignment and carry a lead time no supplier in Al Quoz can shorten — expect two delivery dates on a job that needs both.",
    scopeSpecific: true,
    liveToken: null,
  },
  {
    question: "Do HVAC contractors here need Civil Defence approval?",
    answer:
      "For fire-rated ducting and smoke extract work, yes. Ask to see the current approval certificate before the order rather than after — it is the document most often out of date, and a contractor without one cannot sign off the work.",
    scopeSpecific: false,
    liveToken: null,
  },
  {
    question: "Is Al Quoz Industrial 1 the right area for my job?",
    answer:
      "If your site is in Downtown, Business Bay, Al Barsha or along Sheikh Zayed Road, yes — the run is fifteen minutes and callout charges are lower for it. For Deira and Sharjah sites the travel time works against you and Ras Al Khor is the closer cluster.",
    scopeSpecific: true,
    liveToken: null,
  },
];

/**
 * The RELATED SEARCHES card. Five at most, every one a path of ours.
 *
 * Seeded pointing at pages that exist in the seed. A card of five links to
 * nothing is the padding rule broken in the crawler's direction.
 */
const PUBLISHING_RELATED = [
  { label: "HVAC & ventilation across Dubai", href: "/dubai/hvac-and-ventilation" },
  { label: "HVAC & ventilation in Jebel Ali", href: "/dubai/jebel-ali-free-zone/hvac-and-ventilation" },
  { label: "All HVAC & ventilation suppliers", href: "/c/hvac-and-ventilation" },
];

const SECOND_INTRO = `
Jebel Ali is where the plant arrives. Chillers, large air handling units and VRF outdoor
condensers come into the country through the port a few hundred metres from most of these
counters, which is why the importers are here and why the ducting fabricators are not: a
coil line needs a sheet-metal shop and a sheet-metal shop needs to be close to the sites it
delivers to, and Jebel Ali is forty minutes from Business Bay in traffic that does not
improve.

What that means for a buyer is a different conversation from the one in Al Quoz. A supplier
here quotes against a schedule with a lead time attached to it, because the unit is on water
or in a bonded warehouse rather than on a shelf. Ask for the consignment date rather than the
delivery date — the two are different by however long clearance takes, and a supplier who
quotes only the second has not told you where the risk sits.

The free zone status matters more here than anywhere else in this trade. A JAFZA company
invoices without VAT into another free zone and with it onto the mainland, and a buyer whose
own entity is mainland should say so before the quote rather than after. Several of the
counters below hold both a free zone licence and a mainland branch for exactly this reason,
and the ones that do will say which entity is quoting.

Delivery across Dubai is scheduled rather than same-day for most of these suppliers. A
handful run their own flatbeds and will put a unit on site the following morning; the rest
book a third-party run and quote two to three working days. Neither is worse — it is the
difference between a stockist and an importer, and the price reflects it.

Prices are not published on this page and never will be. A chiller is priced against a
schedule of duty, refrigerant, controls and commissioning, and none of those is a number that
means anything before a supplier has read the specification.
`.trim();

const SECOND_FAQ = [
  {
    question: "Why is the plant here rather than in Al Quoz?",
    answer:
      "The port. Chillers, large AHUs and VRF outdoor units arrive by sea and clear a few hundred metres from these counters, so the importers sit next to the clearance rather than next to the sites. The ducting fabricators went the other way for the same reason in reverse.",
    scopeSpecific: true,
    liveToken: null,
  },
  {
    question: "Does the free zone licence change my invoice?",
    answer:
      "Yes, and it is worth saying which entity you are buying as before the quote rather than after. A JAFZA company invoices without VAT into another free zone and with it onto the mainland. Several suppliers here hold both a free zone licence and a mainland branch, and those will tell you which one is quoting.",
    scopeSpecific: true,
    liveToken: null,
  },
  {
    question: "How long is delivery across Dubai?",
    answer:
      "Scheduled rather than same-day for most. A few run their own flatbeds and will put a unit on site the following morning; the rest book a third-party run at two to three working days.",
    scopeSpecific: false,
    liveToken: null,
  },
  {
    question: "What should I ask for on a lead time?",
    answer:
      "The consignment date, not only the delivery date. The two differ by however long clearance takes, and a quote that gives only the second has not said where that risk sits.",
    scopeSpecific: false,
    liveToken: null,
  },
];

const SECOND_RELATED = [
  { label: "HVAC & ventilation in Al Quoz Industrial 1", href: "/dubai/al-quoz-industrial-1/hvac-and-ventilation" },
  { label: "HVAC & ventilation across Dubai", href: "/dubai/hvac-and-ventilation" },
  { label: "All HVAC & ventilation suppliers", href: "/c/hvac-and-ventilation" },
];

const SECOND_META =
  "HVAC and ventilation importers and stockists in Jebel Ali Free Zone, where the plant clears the port. Compare verified licences, lead times and reply times.";

const PUBLISHING_META =
  "HVAC and ventilation companies with premises in Al Quoz Industrial 1, the cluster that supplies Downtown and Business Bay. Compare verified licences and reply times.";

/**
 * The blocked pair gets one question, not four.
 *
 * It is short on listings *and* short on questions, which is the honest state
 * of a scope nobody has written for yet. It also means the integration tests
 * can watch the fourth condition fail on its own by topping up supply without
 * topping up copy.
 */
const BLOCKED_FAQ = [
  {
    question: "What safety supply is actually stocked here?",
    answer:
      "The consumable end: gloves, coveralls, basic eye protection and the harnesses a fabrication shop gets through. Anything certified to a specific standard is generally ordered rather than collected.",
    scopeSpecific: true,
    liveToken: null,
  },
];

/** "abu_dhabi" reads as "Abu Dhabi" in a sentence, not as an enum. */
function emirateName(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The emirate class — `/dubai/hvac-and-ventilation`, one of board 6c's 84.
 *
 * Seeded because board 6a is one template serving two page classes and the
 * second had no live instance: every emirate cell on `/categories` rendered as
 * plain text, the sibling column that reaches this class was always empty, and
 * nobody looking at the running site could see the class at all.
 *
 * No extra listings. The trade already has 60-odd published suppliers with a
 * Dubai location between the two area pages above, which is what an emirate
 * page counts — that is the point of it being a wider scope than an area.
 */
const EMIRATE_INTRO = `
HVAC and ventilation in Dubai splits into two trades that a buyer often thinks is one. Ducting,
air handling and controls are fabricated and serviced inside the city, mostly around Al Quoz
Industrial and Al Qusais, where a sheet-metal shop can be at a site in Business Bay before the
shift starts. Plant — chillers, large air handling units, VRF outdoor condensers — arrives
through Jebel Ali and is sold by importers sitting next to the clearance rather than next to
the sites.

Knowing which of the two a job needs decides where to send the enquiry, and it decides what a
realistic answer looks like. A duct run drawn on a Sunday is genuinely collectable by
Wednesday. A 400-tonne chiller is not, whatever anybody quotes, and a supplier who offers a
delivery date without a consignment date behind it has not told you where the risk is.

The emirate's own rules apply on both sides of that split. Fire-rated ducting and smoke
extract work needs Civil Defence approval, and the certificate is the document most often
found to be out of date once the work has started. Free zone status changes the invoice
rather than the trade: a JAFZA company invoices without VAT into another free zone and with it
onto the mainland, and several of the larger suppliers hold both a free zone licence and a
mainland branch so they can do either.

Reply time is worth as much as price on this trade and it is the thing most often claimed and
least often measured. Every supplier on this page carries a median measured from enquiry to
first reply through this platform. Where a supplier has answered nothing yet there is no band
at all, because a number drawn from no enquiries is not a number.

Prices are not published on this page and never will be. Ductwork is priced by the metre
against a drawing, plant against a schedule of duty, refrigerant, controls and commissioning.
Send the specification and the suppliers here will quote against it directly.
`.trim();

const EMIRATE_FAQ = [
  {
    question: "Where in Dubai does each half of the trade sit?",
    answer:
      "Ducting, air handling and controls around Al Quoz Industrial and Al Qusais, close to the sites. Plant through Jebel Ali, next to the port it clears at. Sending a chiller enquiry to a sheet-metal shop gets a slower answer than sending it two junctions further west.",
    scopeSpecific: true,
    liveToken: null,
  },
  {
    question: "Do I need Civil Defence approval for this work?",
    answer:
      "For fire-rated ducting and smoke extract, yes. Ask for the current certificate before the order — it is the document most often out of date, and a contractor without one cannot sign the work off.",
    scopeSpecific: true,
    liveToken: null,
  },
  {
    question: "What does a verified licence mean here?",
    answer:
      "The trade licence number on the listing has been checked against the issuing authority, DED or the relevant free zone, and re-checked when it expires. It is the only thing on the listing we check, and it is not for sale.",
    scopeSpecific: false,
    liveToken: null,
  },
  {
    question: "How fast do suppliers reply?",
    answer:
      "Measured from enquiry to first reply through this platform, never claimed by the supplier. A supplier who has answered nothing yet carries no band at all rather than a placeholder.",
    scopeSpecific: false,
    liveToken: null,
  },
];

const EMIRATE_RELATED = [
  { label: "HVAC & ventilation in Al Quoz Industrial 1", href: "/dubai/al-quoz-industrial-1/hvac-and-ventilation" },
  { label: "HVAC & ventilation in Jebel Ali", href: "/dubai/jebel-ali-free-zone/hvac-and-ventilation" },
  { label: "All HVAC & ventilation suppliers", href: "/c/hvac-and-ventilation" },
];

const EMIRATE_META =
  "HVAC and ventilation companies across Dubai, from the Al Quoz ducting shops to the Jebel Ali plant importers. Compare verified licences and measured reply times.";

async function seedEmiratePage(db: PrismaClient) {
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "hvac-and-ventilation" },
    select: { id: true },
  });

  const page = await db.emiratePage.upsert({
    where: { emirate_categoryId: { emirate: "dubai", categoryId: category.id } },
    create: {
      emirate: "dubai",
      categoryId: category.id,
      intro: EMIRATE_INTRO,
      metaDescription: EMIRATE_META,
      contentUpdatedAt: new Date(Date.UTC(2026, 7, 21)),
      publishedAt: new Date(Date.UTC(2026, 6, 1)),
    },
    update: {
      intro: EMIRATE_INTRO,
      metaDescription: EMIRATE_META,
      contentUpdatedAt: new Date(Date.UTC(2026, 7, 21)),
      publishedAt: new Date(Date.UTC(2026, 6, 1)),
    },
    select: { id: true },
  });

  await db.landingFaq.deleteMany({ where: { emiratePageId: page.id } });
  for (const [position, row] of EMIRATE_FAQ.entries()) {
    await db.landingFaq.create({ data: { emiratePageId: page.id, position, ...row } });
  }

  await db.landingRelatedSearch.deleteMany({ where: { emiratePageId: page.id } });
  for (const [position, row] of EMIRATE_RELATED.entries()) {
    await db.landingRelatedSearch.create({
      data: { emiratePageId: page.id, position, ...row },
    });
  }

  const words = EMIRATE_INTRO.trim().split(/\s+/).filter(Boolean).length;
  const local = EMIRATE_FAQ.filter((row) => row.scopeSpecific).length;
  console.log(
    `   dubai/hvac-and-ventilation: ${words} words, ${EMIRATE_FAQ.length} questions (${local} local), published`,
  );
}

/**
 * Board 6f — recorded search volume, so the demand column is a number.
 *
 * Three rows, chosen so the seeded state shows three of the five statuses and
 * moves none of the pages that are already published.
 *
 * The two published HVAC areas carry 62 and 61 listings, so their figures have
 * to keep `25 × searches / 1000` under 60 or the flagship page in every
 * acceptance test would unpublish itself the moment this seeded. 1,900 gives a
 * demand need of 48, which loses to the absolute floor — the column is
 * populated and the rule is unchanged, which is the honest demonstration.
 *
 * The third row carries the board's own worked figure — 3,940 searches a month,
 * a need of 99 — against Al Quoz Industrial 3, which has a handful of HVAC
 * listings. That is the `Recruit` state, and the row states a shortfall a
 * recruiter can act on. The board names Business Bay; the seed has no such area
 * because every seeded area is industrial, and inventing an office district to
 * match a worked example would be a row that exists for a screenshot.
 *
 * The source is named and the date is real. A keyword figure with no provenance
 * is a number nobody can check deciding which pages exist.
 */
const DEMAND = [
  { areaSlug: "al-quoz-industrial-1", categorySlug: "hvac-and-ventilation", monthlySearches: 1_900 },
  { areaSlug: "jebel-ali-free-zone", categorySlug: "hvac-and-ventilation", monthlySearches: 1_450 },
  { areaSlug: "al-quoz-industrial-3", categorySlug: "hvac-and-ventilation", monthlySearches: 3_940 },
] as const;

const DEMAND_SOURCE = "Keyword export, UAE English + Arabic";
const DEMAND_CAPTURED = new Date("2026-08-01T00:00:00.000Z");

async function seedDemand(db: PrismaClient) {
  for (const row of DEMAND) {
    const area = await db.area.findUnique({
      where: { slug: row.areaSlug },
      select: { id: true, emirate: true },
    });
    const category = await db.category.findUnique({
      where: { slug: row.categorySlug },
      select: { id: true },
    });
    if (!area || !category) continue;

    const existing = await db.scopeDemand.findFirst({
      where: { categoryId: category.id, emirate: area.emirate, areaId: area.id },
      select: { id: true },
    });
    const data = {
      monthlySearches: row.monthlySearches,
      source: DEMAND_SOURCE,
      capturedAt: DEMAND_CAPTURED,
    };
    if (existing) {
      await db.scopeDemand.update({ where: { id: existing.id }, data });
    } else {
      await db.scopeDemand.create({
        data: { ...data, categoryId: category.id, emirate: area.emirate, areaId: area.id },
      });
    }
    console.log(`   ${row.areaSlug}/${row.categorySlug}: ${row.monthlySearches} searches a month`);
  }
}

export async function seedAreaPages(db: PrismaClient) {
  await recruit(db, {
    ...SECOND,
    intro: SECOND_INTRO,
    metaDescription: SECOND_META,
    faq: SECOND_FAQ,
    relatedSearches: SECOND_RELATED,
    publish: true,
  });
  await recruit(db, {
    ...PUBLISHING,
    intro: PUBLISHING_INTRO,
    metaDescription: PUBLISHING_META,
    faq: PUBLISHING_FAQ,
    relatedSearches: PUBLISHING_RELATED,
    publish: true,
  });
  await recruit(db, {
    ...BLOCKED,
    intro: BLOCKED_INTRO,
    faq: BLOCKED_FAQ,
    relatedSearches: [],
    publish: false,
  });
  // Last, because it counts the listings the two published areas above created.
  await seedEmiratePage(db);
  await seedDemand(db);
}
