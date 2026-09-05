import type { PrismaClient } from "../lib/db/generated/client.js";
/*
   The pure half only. `audit.ts` is `server-only` and the seed runs in plain
   node, so it cannot call the service — but it must not write a member the
   service would have refused either, or the fixture proves nothing about the
   bar. `failures` is the same predicate `auditList` applies, and it lives in the
   pure module for exactly this kind of caller.
*/
import { DEFAULT_CRITERIA, failures, MIN_MEMBERS } from "../lib/seo/curated/criteria.js";

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

/** Matches `MIN_REVIEWS` in lib/seo/curated/criteria.ts. A test keeps them in step. */
const REVIEWS = 15;

const FAST_MS = 90 * 60_000;
const SLOW_MS = 7 * 3_600_000;

interface Qualifier {
  slug: string;
  replyMs: number;
  /** Deliberately on a paid plan, to prove the plan buys nothing here. */
  plan: string | null;
  /**
   * The hand-written half. `null` on the one who fails, because there is
   * nothing to write about a supplier who is not on the list.
   *
   * Board 6b is explicit that this page does not scale and is not supposed to:
   * *"twelve hand-written entries, each with a `BEST FOR:` line and a paragraph
   * of prose that only a person who has read the reviews and the quotes could
   * write. Do not build a generator for this page."* So the seed is twelve
   * written entries, not twelve generated ones — a fixture produced by a loop
   * would be a fixture that proves the loop.
   */
  entry: { bestFor: string; prose: string; extra?: [string, string] } | null;
}

/**
 * Twelve who qualify, and one who cannot.
 *
 * The reply times ascend, so the editorial order the entries are written in is
 * also the order the RFQ card will pick its eight from — which is what lets
 * entry 03's prose say "slower to reply than the two above" and stay true.
 */
const QUALIFIERS: Qualifier[] = [
  {
    slug: "al-hvac-001",
    replyMs: FAST_MS,
    plan: null,
    entry: {
      bestFor: "Chiller AMC on a tight building",
      prose:
        "The sheet metal shop is on the same plot as the office, which is why their ducting lead times are days rather than weeks. They quote in about an hour and the quotes come with the datasheets attached, which saves a round trip when you need Civil Defence approval. Reviews consistently mention that the engineer who surveys is the engineer who returns.",
      extra: ["Catalogue", "312 products"],
    },
  },
  {
    slug: "al-hvac-002",
    replyMs: FAST_MS + 12 * 60_000,
    plan: "pro",
    entry: {
      bestFor: "Restaurants and cold rooms",
      prose:
        "Almost all of their work is F&B — walk-ins, blast chillers, display cabinets. They keep compressors and controllers in stock, so a failed cold room on a Friday is a same-day fix rather than a two-week wait for parts. Their AMC includes a written temperature log, which matters if you are inspected.",
      extra: ["Callout", "24 hours"],
    },
  },
  {
    slug: "al-hvac-003",
    replyMs: FAST_MS + 24 * 60_000,
    plan: null,
    entry: {
      bestFor: "Ducting to drawing, at volume",
      prose:
        "A fabricator rather than a contractor — you send drawings, they send ducting. A coil line and a plasma cutter on site mean a fit-out package that would take three weeks elsewhere lands in eight days. Slower to reply than the two above, so send a complete drawing set first time.",
      extra: ["Catalogue", "184 products"],
    },
  },
  {
    slug: "al-hvac-004",
    replyMs: FAST_MS + 36 * 60_000,
    plan: "basic",
    entry: {
      bestFor: "Controls and BMS retrofits",
      prose:
        "The only one on this list whose engineers write control strategies rather than only wiring them. Useful on a building where the plant is sound and the sequencing is not. They will quote against an existing BMS rather than insisting on a rip-out, which nobody else here offers.",
    },
  },
  {
    slug: "al-hvac-006",
    replyMs: FAST_MS + 48 * 60_000,
    plan: null,
    entry: {
      bestFor: "Smoke extract and fire-rated work",
      prose:
        "Holds a current Civil Defence approval and will show it before you ask, which is unusual — it is the document most often found to have lapsed once the work has started. Fire-rated ducting is most of what they make, so the detailing is right the first time.",
      extra: ["Callout", "12 hours"],
    },
  },
  {
    slug: "al-hvac-008",
    replyMs: FAST_MS + 60 * 60_000,
    plan: null,
    entry: {
      bestFor: "Villa and small-site splits",
      prose:
        "The only supplier here who will take a two-unit job without loading the price for it. Reviews from domestic buyers are unusually specific about tidiness and about the crew arriving when they said, which is what the job turns on at this size.",
    },
  },
  {
    slug: "al-hvac-009",
    replyMs: FAST_MS + 72 * 60_000,
    plan: "basic",
    entry: {
      bestFor: "AHU refurbishment rather than replacement",
      prose:
        "They rebuild coils and change bearings on units other suppliers quote to replace, which is worth a conversation before you sign a capital request. Expect them to ask for photographs of the plate before quoting; the ones who do not ask are guessing.",
      extra: ["Catalogue", "96 products"],
    },
  },
  {
    slug: "al-hvac-010",
    replyMs: FAST_MS + 84 * 60_000,
    plan: null,
    entry: {
      bestFor: "Kitchen ventilation and grease extract",
      prose:
        "Grease ducting and canopy work, mostly for hotel kitchens. They fabricate to the run rather than to a catalogue size, so the ceiling void does not have to be rebuilt around the duct. Reviews mention them working nights to avoid closing a kitchen, which nobody else here offers.",
    },
  },
  {
    slug: "al-hvac-011",
    replyMs: FAST_MS + 96 * 60_000,
    plan: null,
    entry: {
      bestFor: "Testing, balancing and commissioning",
      prose:
        "A commissioning specialist rather than an installer, which is the right call when the plant is in and the building still will not hold temperature. They issue readings as a signed report rather than a spreadsheet, and will re-test after remedial work without a second mobilisation charge.",
    },
  },
  {
    slug: "al-hvac-012",
    replyMs: FAST_MS + 108 * 60_000,
    plan: null,
    entry: {
      bestFor: "Emergency plant hire",
      prose:
        "Holds portable chillers and spot coolers on the yard, which is the difference between a shut kitchen and an open one while a repair runs. Priced by the week rather than the day, so a two-day failure costs the same as a five-day one — worth knowing before you call.",
      extra: ["Callout", "6 hours"],
    },
  },
  {
    slug: "al-hvac-013",
    replyMs: FAST_MS + 120 * 60_000,
    plan: null,
    entry: {
      bestFor: "Water treatment on chilled water systems",
      prose:
        "Dosing, side-stream filtration and the sampling that tells you whether either is working. The narrowest specialism on this list and the one most often left out of an AMC, which is why a system that was cleaned two years ago is running four degrees warm.",
    },
  },
  {
    slug: "al-hvac-015",
    replyMs: FAST_MS + 132 * 60_000,
    plan: null,
    entry: {
      bestFor: "Insulation and lagging",
      prose:
        "Pipe and duct insulation as a trade in its own right rather than as the last line of somebody else's quote. They will price off a schedule and a drawing alone, which makes them useful for a budget before the detail is settled.",
    },
  },
  /*
     The one that proves the rule. Everything a supplier can buy, and one thing
     they cannot: a reply time under four hours. It is measured from real
     enquiry timestamps and there is no field for it, so this listing is off the
     list no matter what it pays — and it has no entry written for it, because
     an entry for a supplier who fails the criteria is the thing `auditList`
     refuses.
  */
  { slug: "al-hvac-005", replyMs: SLOW_MS, plan: "pro", entry: null },
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

The rules are not ours to bend, and every figure on this page is dated. The list was read
against them on the day in the header and the numbers you see were measured that day — a
supplier whose median reply drifts afterwards is flagged for the next audit rather than
quietly dropped, because the entries are written by hand and reordering them would make the
sentences around them wrong. Nobody is told in advance and nobody can appeal.

What is deliberately absent is anything a supplier can buy. There is no paid position on this
page, no field in our system that could hold one, and no arrangement under which a name moves
up. Three of the suppliers below are on paid subscriptions and nine are not, and you cannot tell
which from the order — because the order does not know.

The one thing that gets a supplier onto this page is meeting all three rules on the day it was
audited: a trade licence checked against the issuing authority, a median first reply under four
hours measured from real enquiries, and fifteen reviews from buyers who actually sent one. That
check is ours and it is not for sale.
`.trim();

  /*
     Board 6b Q1: the H1 carries the query and the year.

     The board drew "The 12 HVAC contractors in Al Quoz we'd call ourselves",
     while board 6a's READ NEXT card called the same page "12 best HVAC
     contractors in Al Quoz, 2026" — two titles for one page. The
     recommendation is that the H1 takes the query and the editorial voice
     moves to the standfirst, because this is the one page whose job is
     acquisition and the voice is worth less than the ranking.

     6a's card renders `CuratedList.title` directly, so fixing it here fixes it
     there: the two cannot say different things about one page.
  */
  const title = "The 12 best HVAC contractors in Al Quoz, 2026";

  // The defaults, as a plain structure Prisma will take as Json. The shape is
  // validated on the way out by `readCriteria`, so a hand-edited row degrades to
  // the defaults rather than rendering a criterion nothing enforces.
  const CRITERIA_JSON = DEFAULT_CRITERIA.map((criterion) => ({
    key: criterion.key,
    kind: criterion.kind,
  }));

  /*
     §2: the criteria in a sentence, then "No one paid to be here." Four words,
     own sentence, load-bearing — never softened, never merged into the clause
     before it, never below the fold.
  */
  const standfirst =
    "Chosen from 218 listed companies on verified licence, quote-response time and review substance. No one paid to be here.";

  await db.curatedList.upsert({
    where: { slug: "hvac-suppliers-al-quoz" },
    create: {
      slug: "hvac-suppliers-al-quoz",
      title,
      standfirst,
      intro,
      criteria: CRITERIA_JSON,
      categoryId: category.id,
      areaId: area.id,
      publishedAt: new Date(Date.UTC(2026, 6, 5)),
    },
    update: {
      title,
      standfirst,
      intro,
      criteria: CRITERIA_JSON,
      publishedAt: new Date(Date.UTC(2026, 6, 5)),
    },
  });

  console.log(`   ${written} reviews written across ${QUALIFIERS.length} listings`);
}

/**
 * The audit, which has to run **after** the medians are derived.
 *
 * `seedCurated` above writes the enquiries and the replies; `recomputeDerived`
 * turns those timestamps into `responseTimeMedianMs`, and that column is one of
 * the three criteria. Run in one pass, every candidate was refused on "reply
 * never measured" — which is the gate working, on a fixture that had not yet
 * measured anything.
 *
 * Two functions rather than writing the median here: non-negotiable 6 says
 * response time is measured and never claimed, and a seed that wrote the column
 * to make its own fixture pass would be claiming it.
 */
export async function auditCuratedLists(db: PrismaClient) {
  const category = await db.category.findUniqueOrThrow({
    where: { slug: "hvac-and-ventilation" },
    select: { id: true },
  });
  const area = await db.area.findUniqueOrThrow({
    where: { slug: "al-quoz-industrial-1" },
    select: { id: true },
  });
  const list = await db.curatedList.findUniqueOrThrow({
    where: { slug: "hvac-suppliers-al-quoz" },
    select: { id: true },
  });

  /*
     The snapshot, taken the way an audit takes one — and refusing anybody the
     audit service would refuse.

     The seed is the easiest place in the product to write a member who fails
     the criteria, and a fixture that skipped the bar would be a fixture that
     proves nothing about it. So every candidate goes through `failures`, the
     same pure predicate `auditList` applies, and one that does not pass is
     dropped with a line in the log rather than written quietly.
  */
  const auditedAt = new Date(Date.UTC(2026, 7, 14));
  const editor = await db.user.findFirst({
    where: { roles: { has: "staff_ops_lead" } },
    select: { id: true },
  });

  const record: unknown[] = [];
  let position = 0;
  let refused = 0;

  await db.curatedListMember.deleteMany({ where: { listId: list.id } });

  for (const qualifier of QUALIFIERS) {
    if (!qualifier.entry) continue;

    const business = await db.business.findUnique({
      where: { slug: qualifier.slug },
      select: {
        id: true,
        slug: true,
        displayName: true,
        verificationTier: true,
        responseTimeMedianMs: true,
        ratingOverall: true,
        establishedYear: true,
        reviews: { where: { removedAt: null, heldAt: null }, select: { id: true } },
      },
    });
    if (!business) continue;

    const failed = failures(
      {
        verificationTier: business.verificationTier,
        responseTimeMedianMs: business.responseTimeMedianMs,
        reviewCount: business.reviews.length,
      },
      DEFAULT_CRITERIA,
      2,
    );
    if (failed.length > 0) {
      console.log(
        `   refused ${qualifier.slug}: ${failed.map((f) => `${f.key} ${f.have} needs ${f.need}`).join(", ")}`,
      );
      refused += 1;
      continue;
    }

    await db.curatedListMember.create({
      data: {
        listId: list.id,
        businessId: business.id,
        position,
        bestFor: qualifier.entry.bestFor,
        prose: qualifier.entry.prose,
        snapshotAt: auditedAt,
        snapRatingOverall: business.ratingOverall,
        snapReviewCount: business.reviews.length,
        snapResponseMs: business.responseTimeMedianMs ?? 0,
        snapEstablishedYear: business.establishedYear,
        extraLabel: qualifier.entry.extra?.[0] ?? null,
        extraValue: qualifier.entry.extra?.[1] ?? null,
      },
    });
    record.push({
      position,
      businessId: business.id,
      slug: business.slug,
      displayName: business.displayName,
      bestFor: qualifier.entry.bestFor,
      verificationTier: business.verificationTier,
      responseTimeMedianMs: business.responseTimeMedianMs,
      reviewCount: business.reviews.length,
      ratingOverall: business.ratingOverall,
    });
    position += 1;
  }

  const considered = await db.business.count({
    where: {
      suspendedAt: null,
      publishedAt: { not: null },
      mergedIntoId: null,
      primaryCategoryId: category.id,
      locations: { some: { areaId: area.id, published: true } },
    },
  });

  // Below the floor a list does not publish. Said out loud rather than left as
  // a page that renders four names under a headline promising twelve.
  const publishes = position >= MIN_MEMBERS;

  await db.curatedList.update({
    where: { id: list.id },
    data: {
      auditedAt,
      editorId: editor?.id ?? null,
      consideredCount: considered,
      entryRemovedAt: null,
      reauditDueAt: new Date(auditedAt.getTime() + 90 * 86_400_000),
      publishedAt: publishes ? new Date(Date.UTC(2026, 6, 5)) : null,
    },
  });

  await db.curatedListAudit.deleteMany({ where: { listId: list.id } });
  await db.curatedListAudit.create({
    data: {
      listId: list.id,
      auditedAt,
      editorId: editor?.id ?? null,
      consideredCount: considered,
      memberCount: position,
      record: record as never,
    },
  });

  console.log(
    `   hvac-suppliers-al-quoz: ${position} entries from ${considered} considered` +
      `${refused > 0 ? `, ${refused} refused` : ""}${publishes ? ", published" : ", held below the floor"}`,
  );
}

/** The same deterministic uuid the main seed uses, so ids never collide. */
function uuid(n: number): string {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}
