import { Prisma, type PrismaClient } from "@/lib/db/generated/client";
import { formatPhone } from "@/lib/format/phone";
import { COOLING_DAYS, type DetectorRules } from "./detector-rules";
import { licenceWords } from "./evidence";
import { subjectValueKey } from "./value-key";

/**
 * Board 4h — the sweeps that fill 61% of this queue.
 *
 * The board's claim is that most of what a moderator works was found by the
 * platform rather than reported by a person, and until this file that was true
 * of exactly one kind: `lib/messaging/off-platform.ts` raises an
 * `off_platform_payment` report at the moment a message is written. Four of the
 * eight `ReportKind`s had no producer at all, and two of the board's own drawn
 * rows are things the platform can measure and was not:
 *
 *   - *"Phone number belongs to a different business — SAME NUMBER ON 4
 *     LISTINGS"*, found by three separate buyers.
 *   - *"Permanently closed — LICENCE EXPIRED 14 MONTHS AGO"*, found by two.
 *
 * Both of those are one indexed query. The spec calls the second a **symptom**:
 * `3e`'s expiry pass drops the verification tier the day a licence lapses and
 * then nobody asks whether the firm is still there, so a buyer drives to an
 * empty unit and tells us. This is the ask.
 *
 * ## No audit row, deliberately
 *
 * The same argument `lib/verification/expiry-job.ts` makes and CLAUDE.md
 * endorses: `AuditEvent.actorId` is NOT NULL because the log records decisions,
 * and a sweep following a published threshold has no actor to attribute. What
 * it produces is a queue item for a person to decide, and *that* decision is
 * audited. Nothing here changes a listing, a tier or a plan.
 *
 * ## It takes its client, and carries no `server-only` marker
 *
 * The same arrangement `lib/metrics/measure-response-times.ts` has, and for the
 * same reason: `app/api/jobs/daily` runs this on the app's client and the seed
 * runs it on its own, so there is one derivation and nowhere for a second to
 * drift. The seed used to be where a hand-written copy of a job's output went,
 * and a copy stops matching the rule the first time the rule moves.
 *
 * ## Idempotence, and the cooling window
 *
 * A sweep that runs nightly and files the same finding every night is a sweep
 * that buries the queue it is supposed to fill. So a detector never files while
 * one of its own findings about that business is open, and never refiles for
 * `COOLING_DAYS` after one was closed — a moderator who looked at a shared
 * number and decided it was a group with two trading names should not be asked
 * again tomorrow.
 */

type Db = PrismaClient;

const DAY_MS = 86_400_000;

export interface DetectorRun {
  sharedPhone: { groups: number; filed: number };
  licenceLongExpired: { found: number; filed: number };
}

/**
 * A phone number as its UAE national significant number: digits only, then the
 * international prefix, the country code and the trunk zero taken off.
 *
 * Board 13c found the rule this replaced — *the last nine digits* — wrong for
 * every landline. A Dubai landline is eight digits after the trunk zero, so
 * `04 227 8890` kept nine digits (`042278890`) and `+971 4 227 8890` kept a
 * different nine (`142278890`), and the two ways the licence registers print
 * one number never met. Mobiles are nine digits and happened to work, which is
 * why the sweep found anything at all.
 *
 * `subjectValueKey("phone")` in `./value-key.ts` is the same rule in TypeScript,
 * and a unit test holds the two to the same strings.
 */
const PHONE_KEY_SQL = Prisma.sql`regexp_replace(regexp_replace(l."phone", '[^0-9]', '', 'g'), '^(00)?(971)?0?', '')`;

interface PhoneGroup {
  key: string;
  listings: bigint;
  business_ids: string[];
  sample: string;
}

/**
 * One telephone number published on several different businesses.
 *
 * Counted across **businesses**, never across branches. A firm with one
 * switchboard on four of its own units is one number answering for one company,
 * which is ordinary; four companies behind one number is either a group that has
 * not said so or a listing farm, and both are worth a person looking.
 *
 * Only listings a buyer can reach: unpublished, suspended and closed rows are
 * excluded, because a report about a page nobody can see costs a moderator's
 * morning and changes nothing.
 */
export async function sweepSharedPhones(
  db: Db,
  rules: DetectorRules,
  now: Date,
): Promise<DetectorRun["sharedPhone"]> {
  if (!rules.sweeps.shared_phone) return { groups: 0, filed: 0 };

  const groups = await db.$queryRaw<PhoneGroup[]>(Prisma.sql`
    SELECT ${PHONE_KEY_SQL} AS key,
           count(DISTINCT l."business_id") AS listings,
           array_agg(DISTINCT l."business_id") AS business_ids,
           min(l."phone") AS sample
      FROM "location" l
      JOIN "business" b ON b."id" = l."business_id"
     WHERE l."phone" IS NOT NULL
       AND length(${PHONE_KEY_SQL}) >= 8
       AND b."published_at" IS NOT NULL
       AND b."suspended_at" IS NULL
       AND b."closed_at" IS NULL
     GROUP BY 1
    HAVING count(DISTINCT l."business_id") >= ${rules.sharedPhoneListings}
     ORDER BY 1
  `);

  let filed = 0;
  for (const group of groups) {
    const businessIds = [...new Set(group.business_ids)].sort();
    const listings = Number(group.listings);
    const named = await db.business.findMany({
      where: { id: { in: businessIds } },
      orderBy: [{ displayName: "asc" }, { id: "asc" }],
      select: { id: true, displayName: true },
    });

    for (const business of named) {
      const others = named.filter((row) => row.id !== business.id).map((row) => row.displayName);
      const written = await fileFinding(db, {
        businessId: business.id,
        detector: "shared_phone",
        kind: "wrong_details",
        subjectField: "phone",
        /*
           Board 13c `B2`. The group key, so a person reporting this number on
           any of these listings joins the finding rather than starting beside
           it. `PHONE_KEY_SQL` and `subjectValueKey("phone")` are one rule,
           pinned by a test.
        */
        subjectValueKey: group.key,
        subjectValue: group.sample,
        evidence: `Same number on ${listings} listings`,
        /*
           The other listings by name, because that is the question a moderator
           opens the row with. Not the number itself beyond its printed form:
           it is already public on every one of those pages, and repeating it
           into a queue row adds nothing a moderator cannot see by clicking.
        */
        detail: `${formatPhone(group.sample)} is published on ${listings} listings. The others are ${others.join(", ")}.`,
        now,
      });
      if (written) filed += 1;
    }
  }

  return { groups: groups.length, filed };
}

/**
 * A trade licence long past expiry on a listing still in the directory.
 *
 * Not the same question as `3e`'s expiry pass, which runs on the day and drops
 * the verification tier. This one runs months later and asks a different thing:
 * the licence has not been renewed, nobody has claimed or corrected the listing,
 * and buyers are still enquiring into it. `closureRequestedAt` excludes the
 * businesses already being closed by board 11i's notice — a report about a firm
 * we have already written to is a second route to a decision that has one.
 */
export async function sweepLongExpiredLicences(
  db: Db,
  rules: DetectorRules,
  now: Date,
): Promise<DetectorRun["licenceLongExpired"]> {
  if (!rules.sweeps.licence_long_expired) return { found: 0, filed: 0 };

  const cutoff = new Date(now.getTime() - rules.licenceExpiredDays * DAY_MS);
  const businesses = await db.business.findMany({
    where: {
      licenceExpiry: { lt: cutoff },
      publishedAt: { not: null },
      suspendedAt: null,
      closedAt: null,
      closureRequestedAt: null,
    },
    orderBy: [{ licenceExpiry: "asc" }, { id: "asc" }],
    select: { id: true, displayName: true, licenceExpiry: true, licenceNumber: true },
  });

  let filed = 0;
  for (const business of businesses) {
    const written = await fileFinding(db, {
      businessId: business.id,
      detector: "licence_long_expired",
      kind: "closed",
      subjectField: "licence",
      subjectValueKey: subjectValueKey("licence", business.licenceNumber),
      subjectValue: business.licenceNumber,
      /*
         Board 13c. One rule for what the licence record says, read here and by
         `evidenceLine` on the public form — a buyer's *permanently closed* and
         this sweep now collapse into one work item, and two rows in one group
         whose licence clause disagreed about the month would be two readings of
         one date.
      */
      evidence: licenceWords(business.licenceExpiry, now),
      detail:
        `The trade licence expired on ${business.licenceExpiry.toISOString().slice(0, 10)} and no renewal has been recorded. ` +
        `The listing is still published and still taking enquiries.`,
      now,
    });
    if (written) filed += 1;
  }

  return { found: businesses.length, filed };
}

/**
 * File one finding, unless this detector already has something to say about
 * this business.
 *
 * Returns whether a row was written, so a caller can report what it did rather
 * than what it looked at.
 */
async function fileFinding(
  db: Db,
  input: {
    businessId: string;
    detector: "shared_phone" | "licence_long_expired";
    kind: "wrong_details" | "closed";
    subjectField: string;
    subjectValueKey: string | null;
    subjectValue: string | null;
    evidence: string;
    detail: string;
    now: Date;
  },
): Promise<boolean> {
  const cooledSince = new Date(input.now.getTime() - COOLING_DAYS * DAY_MS);
  const recent = await db.supplierReport.findFirst({
    where: {
      subjectBusinessId: input.businessId,
      detector: input.detector,
      OR: [{ outcome: null }, { resolvedAt: { gte: cooledSince } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (recent) return false;

  await db.supplierReport.create({
    data: {
      subjectBusinessId: input.businessId,
      reporterId: null,
      detector: input.detector,
      kind: input.kind,
      subjectField: input.subjectField,
      subjectValueKey: input.subjectValueKey,
      subjectValue: input.subjectValueKey ? input.subjectValue : null,
      evidence: input.evidence,
      detail: input.detail,
      createdAt: input.now,
    },
    select: { id: true },
  });
  return true;
}

/**
 * Both sweeps, in one step.
 *
 * Sequential rather than parallel on purpose: they write to the same table, and
 * `fileFinding` reads that table to decide whether to write. Running them at
 * once would let each one's read miss the other's write.
 */
export async function runReportDetectorsIn(
  db: Db,
  rules: DetectorRules,
  now: Date,
): Promise<DetectorRun> {
  return {
    sharedPhone: await sweepSharedPhones(db, rules, now),
    licenceLongExpired: await sweepLongExpiredLicences(db, rules, now),
  };
}
