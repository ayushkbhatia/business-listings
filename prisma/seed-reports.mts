import type { PrismaClient } from "../lib/db/generated/client.js";
import { DEFAULT_DETECTOR_RULES } from "../lib/reports/detector-rules.js";
import { runReportDetectorsIn } from "../lib/reports/detectors.js";
import { evidenceLine } from "../lib/reports/evidence.js";
import { subjectValueKey } from "../lib/reports/value-key.js";

/**
 * Board 4h — the queue as a working morning leaves it, and ninety days of
 * decisions behind it.
 *
 * Four things this file is for, and each of them is a state no other fixture
 * produces:
 *
 *   1. **A collapsed group.** Three people reporting one telephone number, so
 *      the queue renders one row reading `3 separate reports` and deciding it
 *      closes all three (`B6`).
 *   2. **An escalated row**, still open and unassigned, which is what `B2` puts
 *      where the board drew `Suspend`.
 *   3. **An owner on a row**, so the owner column and the *Assigned to me*
 *      filter have something to show (`B4`).
 *   4. **Decided reports across the window**, so the outcomes rail computes
 *      real shares rather than rendering an empty state on a seeded database.
 *
 * The two detector-fed kinds are **not** written here. `seedReportDetectors`
 * runs the sweep — the same function the nightly job calls — so what the queue
 * shows is what the detector actually produces against this data. A seed that
 * hand-wrote the detector's output would be a copy that stopped matching the
 * first time the rule moved, which is the trap `prisma/seed.mts` already
 * carries a note about for the response-time job.
 *
 * Every row is a **new** fixture on businesses the seed already creates.
 * Nothing here repurposes an existing report: a spec that reads "the first row"
 * is a spec that eats another spec's fixture.
 */

type Db = PrismaClient;

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * The landline three listings share, below. Named once so the three buyers'
 * reports carry the value key the detector will group on — board 13c `B2` — and
 * the detector's finding and theirs land in one value group, as a real report
 * filed through the form would.
 */
const SHARED_NUMBER = "+97143472290";

export async function seedReports(db: Db, now: Date): Promise<void> {
  console.log("→ reports, flags and disputes, for board 4h");

  const [moderator, opsLead] = await Promise.all([
    db.user.findFirst({
      where: { roles: { has: "staff_moderator" } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
    db.user.findFirst({
      where: { roles: { has: "staff_ops_lead" } },
      orderBy: { id: "asc" },
      select: { id: true },
    }),
  ]);
  const buyers = await db.user.findMany({
    where: { roles: { has: "buyer" } },
    orderBy: { id: "asc" },
    take: 3,
    select: { id: true },
  });
  if (!moderator || !opsLead || buyers.length < 2) {
    console.log("   skipped — this seed has no staff roster or no buyers");
    return;
  }

  /*
     Businesses that carry no report yet. `claimed[5]`, `[6]` and `[7]` already
     hold one each from the trust fixtures, so these are picked by slug from the
     other end of the directory and skipped where a slug is absent.
  */
  const wanted = [
    "sharjah-steel-fabricators",
    "al-bariq-trading-llc",
    "al-manara-equipment-trading-llc",
  ];
  const businesses = await db.business.findMany({
    where: { slug: { in: wanted } },
    orderBy: { slug: "asc" },
    select: { id: true, slug: true, displayName: true },
  });
  const bySlug = new Map(businesses.map((row) => [row.slug, row]));

  const shared = bySlug.get("sharjah-steel-fabricators");
  const escalated = bySlug.get("al-bariq-trading-llc");
  const owned = bySlug.get("al-manara-equipment-trading-llc");

  /* 1 · Three people, one telephone number, one work item. */
  if (shared) {
    const said = [
      "Called the number on the listing and reached a car rental company in Al Quoz. They said they have had the number for two years.",
      "The landline goes to a different business. The mobile on their website is right.",
      "Rang twice on Sunday, both times answered as a different company.",
    ];
    for (const [index, detail] of said.entries()) {
      await db.supplierReport.create({
        data: {
          subjectBusinessId: shared.id,
          reporterId: buyers[index % buyers.length]!.id,
          kind: "wrong_details",
          subjectField: "phone",
          subjectValueKey: subjectValueKey("phone", SHARED_NUMBER),
          subjectValue: SHARED_NUMBER,
          detail,
          createdAt: new Date(now.getTime() - (3 * DAY - index * 6 * HOUR)),
        },
      });
    }
  }

  /*
     2 · Escalated and still open.

     An off-platform payment report a moderator has put in front of an ops lead.
     It is not suspended and it is not resolved: escalation moves who owns the
     decision and nothing else, which is the whole of `B2`.
  */
  if (escalated) {
    await db.supplierReport.create({
      data: {
        subjectBusinessId: escalated.id,
        reporterId: null,
        detector: "off_platform_message",
        kind: "off_platform_payment",
        subjectField: "message",
        evidence: "IBAN shared before contact release",
        detail:
          'Matched iban, transfer_instruction. Message: "Send 30% advance to AE07 0331 2345 6789 0123 456 and we will release the stock this week."',
        escalatedAt: new Date(now.getTime() - 4 * HOUR),
        escalatedById: moderator.id,
        escalationReason:
          "Second thread from this account in a fortnight asking for an advance off the record. Needs a decision about the account, not about the message.",
        createdAt: new Date(now.getTime() - 20 * HOUR),
      },
    });
  }

  /* 3 · A row with an owner, for the column and the *Assigned to me* filter. */
  if (owned) {
    await db.supplierReport.create({
      data: {
        subjectBusinessId: owned.id,
        reporterId: buyers[0]!.id,
        kind: "content",
        subjectField: "photo",
        detail:
          "The third photograph on their catalogue page is from another supplier's listing — it still has their watermark in the bottom right.",
        assigneeId: moderator.id,
        assignedAt: new Date(now.getTime() - 2 * HOUR),
        assignedById: opsLead.id,
        createdAt: new Date(now.getTime() - 2 * DAY),
      },
    });
  }

  /*
     4 · The ninety days behind the rail.

     Spread across the window and across all four outcomes, including the
     duplicate that the board's closed set of three had nowhere to put. Written
     with `resolvedById` so the board can say who decided, and with a reason on
     every one, because a resolved report with no reason is the state the check
     constraint and the audit rule both exist to prevent.
  */
  const target = businesses[0];
  if (target) {
    const decided = [
      { ago: 72, days: 2, outcome: "seller_corrected" as const, field: "address", reason: "Seller moved to Ras Al Khor in July and had not updated the listing. Corrected and confirmed against the tenancy contract." },
      { ago: 61, days: 1, outcome: "seller_corrected" as const, field: "hours", reason: "Opening hours were the pre-Ramadan set. Seller updated them the same day." },
      { ago: 54, days: 4, outcome: "upheld" as const, field: "photo", reason: "Image match against another supplier's catalogue confirmed. Photograph removed." },
      { ago: 40, days: 3, outcome: "no_action" as const, field: "category", reason: "They do carry out this work — checked the licence activities and two of their own product pages." },
      { ago: 33, days: 2, outcome: "seller_corrected" as const, field: "website", reason: "Domain had lapsed. Seller supplied the new one." },
      { ago: 21, days: 1, outcome: "duplicate" as const, field: "website", reason: "The same lapsed domain, reported by a second buyer. Decided with the first." },
      { ago: 12, days: 5, outcome: "seller_corrected" as const, field: "name", reason: "Trading name on the listing was the old one. Corrected from the licence." },
    ];

    let previous: string | null = null;
    for (const row of decided) {
      const createdAt = new Date(now.getTime() - row.ago * DAY);
      const resolvedAt = new Date(createdAt.getTime() + row.days * DAY);
      const created: { id: string; outcome: string | null } = await db.supplierReport.create({
        data: {
          subjectBusinessId: target.id,
          reporterId: buyers[0]!.id,
          kind: "wrong_details",
          subjectField: row.field,
          detail: "Reported from the listing page.",
          outcome: row.outcome,
          outcomeReason: row.reason,
          resolvedAt,
          resolvedById: row.outcome === "upheld" ? opsLead.id : moderator.id,
          ...(row.outcome === "duplicate" && previous ? { duplicateOfId: previous } : {}),
          createdAt,
        },
        select: { id: true, outcome: true },
      });
      /*
         The duplicate points at the report before it, which is the only shape
         the check constraint accepts: a duplicate with nothing to point at
         would be a decision about nothing.
      */
      if (created.outcome !== "duplicate") previous = created.id;
    }
  }

  /*
     One genuine shared number, for the detector to find.

     Board 4h's row 3 — *"Phone number belongs to a different business · SAME
     NUMBER ON 4 LISTINGS"* — is a state the platform can measure, and it needs
     something to measure. Two published listings are given one landline here,
     deliberately and in the open, so `seedReportDetectors` files a real finding
     from the real rule rather than the seed writing the finding itself.

     A third listing already carries the number for `shared` above, which is why
     the group reads three rather than two: the three buyers who reported it
     were right.
  */
  if (shared) {
    const sharing = await db.business.findMany({
      where: {
        publishedAt: { not: null },
        suspendedAt: null,
        closedAt: null,
        slug: { in: ["al-bariq-trading-llc", "al-manara-equipment-trading-llc"] },
      },
      orderBy: { slug: "asc" },
      select: { id: true, locations: { orderBy: { id: "asc" }, take: 1, select: { id: true } } },
    });
    const number = SHARED_NUMBER;
    for (const business of [...sharing, shared]) {
      const location =
        "locations" in business
          ? business.locations[0]
          : await db.location.findFirst({
              where: { businessId: business.id },
              orderBy: { id: "asc" },
              select: { id: true },
            });
      if (!location) continue;
      await db.location.update({
        where: { id: location.id },
        data: { phone: number, phoneVerified: true },
      });
    }
  }

  await seedReportCapture(db, now, shared ?? null);

  const open = await db.supplierReport.count({ where: { outcome: null } });
  console.log(`   ${open} open reports, and ninety days of decisions behind the rail`);
}

/**
 * Board 13c — what the report modal captures, in the shapes the writer leaves.
 *
 * Three rows no earlier fixture produces, each filed the way
 * `fileListingReport` files a signed-out report — a `reporterKey` digest in
 * place of an account, the value read from the listing, the licence clause in
 * the evidence line:
 *
 *   1. **A fourth source on the shared number**, anonymous, with the
 *      correction a reporter offers (`B1`). With the three buyers and the
 *      detector's findings it makes the value group the queue flags.
 *   2. **A closure report with an address to write back to** (`B4`), on an
 *      unclaimed listing — the modal's drawn case — so the detail screen shows
 *      *An email they left, used once*.
 *   3. **Not this trade, with the trade it should be** (`B9`).
 *
 * Every row a new fixture. The keys are fixed strings rather than digests of
 * anything, because nothing reads them back except the dedupe, and a seed that
 * hashed a made-up address would be pretending to know one.
 */
async function seedReportCapture(
  db: Db,
  now: Date,
  shared: { id: string } | null,
): Promise<void> {
  const unclaimed = await db.business.findMany({
    where: {
      claimStatus: "unclaimed",
      publishedAt: { not: null },
      suspendedAt: null,
      closedAt: null,
      reports: { none: {} },
    },
    orderBy: [{ slug: "desc" }, { id: "asc" }],
    take: 2,
    select: { id: true, licenceNumber: true, licenceExpiry: true, primaryCategoryId: true },
  });

  if (shared) {
    await db.supplierReport.create({
      data: {
        subjectBusinessId: shared.id,
        reporterId: null,
        reporterKey: "seed-13c-shared-number",
        kind: "wrong_details",
        subjectField: "phone",
        subjectValueKey: subjectValueKey("phone", SHARED_NUMBER),
        subjectValue: SHARED_NUMBER,
        suggestedValue: "+971 6 554 1180",
        detail: "The number on their delivery van is different. That one answered as the fabricators.",
        evidence: evidenceLine({ field: "phone", listings: 3, licenceExpiry: null, now }),
        createdAt: new Date(now.getTime() - 5 * HOUR),
      },
    });
  }

  const [closed, miscategorised] = unclaimed;
  if (closed) {
    await db.supplierReport.create({
      data: {
        subjectBusinessId: closed.id,
        reporterId: null,
        reporterKey: "seed-13c-closed",
        reporterEmail: "reporter@example.ae",
        kind: "closed",
        subjectField: "licence",
        subjectValueKey: subjectValueKey("licence", closed.licenceNumber),
        subjectValue: closed.licenceNumber,
        detail: "Shutters down and a to-let sign on the unit. The neighbours say they left in the spring.",
        evidence: evidenceLine({ field: "licence", listings: 1, licenceExpiry: closed.licenceExpiry, now }),
        createdAt: new Date(now.getTime() - 26 * HOUR),
      },
    });
  }

  if (miscategorised) {
    const other = await db.category.findFirst({
      where: { showInIndex: true, parentId: { not: null }, id: { not: miscategorised.primaryCategoryId } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    await db.supplierReport.create({
      data: {
        subjectBusinessId: miscategorised.id,
        reporterId: null,
        reporterKey: "seed-13c-trade",
        kind: "wrong_trade",
        subjectField: "category",
        suggestedCategoryId: other?.id ?? null,
        detail: null,
        evidence: evidenceLine({
          field: "category",
          listings: 1,
          licenceExpiry: miscategorised.licenceExpiry,
          now,
        }),
        createdAt: new Date(now.getTime() - 9 * HOUR),
      },
    });
  }
}

/**
 * Board 4h `B11` — the detector-fed rows, produced by the detector.
 *
 * The sweep itself, on the seed's own client and the shipped defaults, which is
 * the same call `app/api/jobs/daily` makes every night. Nothing here writes a
 * `shared_phone` or a `licence_long_expired` report by hand: a fixture that
 * did would be a copy of the rule that stopped matching the day the rule moved,
 * and this board's whole claim is that most of the queue is measured rather
 * than asserted.
 *
 * Runs last, after every listing and location the seed creates, because both
 * sweeps read the directory as it stands.
 */
export async function seedReportDetectors(db: Db, now: Date): Promise<void> {
  console.log("→ report detectors, the nightly sweep, for board 4h");
  const run = await runReportDetectorsIn(db, DEFAULT_DETECTOR_RULES, now);
  console.log(
    `   ${run.sharedPhone.filed} filed from ${run.sharedPhone.groups} shared numbers, ` +
      `${run.licenceLongExpired.filed} from ${run.licenceLongExpired.found} lapsed licences`,
  );
}
