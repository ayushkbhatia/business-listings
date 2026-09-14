import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import {
  discardRun,
  parseLicenceDate,
  publishRun,
  rollbackPreview,
  rollbackRun,
  stageRun,
} from "@/lib/ingest/service";
import {
  categorisationQueue,
  categoriseRecords,
  forgetActivityMapping,
} from "@/lib/ingest/queue";
import { orderRaw, rejectsCsv, runOverview } from "@/lib/ingest/read";
import { activityKey } from "@/lib/ingest/classify";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 12a — the licence importer, end to end against a real database.
 *
 * Criterion 1 at the number it names — "an import run of 8,000 records stages
 * without publishing, categorises what it can, queues what it cannot, and lists
 * rejections by countable reason" — and then the board-level acceptance
 * criteria underneath it:
 *
 *   1  a run of 8,000+ records stages without publishing anything
 *   2  outcome buckets sum to the file; rejection reasons sum to the rejected count
 *   3  rejection reasons come from a closed enum and export with the raw row
 *   4  no record publishes without a category
 *   5  rolling back leaves every claimed listing, its verification and its
 *      subscription intact
 *   6  licence expiry reaches the published listing, not only the import filter
 *   7  categorisation shows the resolved tradeKind and flags a null one
 *   8  duplicates route to 12b and cannot be published from this screen
 *   9  upload, approve and roll back are each logged with a staff user and a
 *      written reason
 *
 * The 8,000-row fixture is generated rather than committed:
 * `scripts/make-licence-fixture.mts` is deterministic. Everything else stages a
 * small file written here, so each assertion names the records it is about.
 */

/**
 * Every run this suite stages is under a filename starting `it-` — the handle
 * `removeFixtures` collects by.
 */
const PREFIX = "it-";

/** Unique to this run of the suite, so phrases and licences collide with nothing seeded. */
const TAG = String(Date.now()).slice(-6);

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLead: Actor;
let moderator: Actor;
let fieldOfficer: Actor;
let valvesId: string;
let gateValvesId: string;
let csv8000: string;
let csv60: string;
let tempRootId: string | null = null;

const REASON = "Monthly DED export, checked against last month's run before approving.";

async function removeFixtures() {
  const runs = await prisma.licenceImportRun.findMany({
    where: { filename: { startsWith: PREFIX } },
    select: { id: true },
  });
  const runIds = runs.map((row) => row.id);

  // `AuditEvent.subject` is a string, not a foreign key — nothing cascades it.
  await prisma.auditEvent.deleteMany({
    where: {
      OR: [
        { subject: { in: runIds.map((id) => `LicenceImportRun:${id}`) } },
        { subject: { startsWith: "LicenceActivity:" }, reason: { contains: TAG } },
      ],
    },
  });
  await prisma.licenceActivityMapping.deleteMany({ where: { activityKey: { contains: TAG } } });

  /*
   * The order is forced. `staged_listing_published_has_a_business` is a CHECK:
   * a published row must hold a business, and `StagedListing.business` is
   * SetNull — so deleting a listing first would null the column and the check
   * refuses. The staged rows go first, then the listings, then the runs.
   */
  if (runIds.length > 0) {
    await prisma.stagedListing.deleteMany({ where: { runId: { in: runIds } } });
    await prisma.business.deleteMany({ where: { licenceImportRunId: { in: runIds } } });
    await prisma.licenceImportRun.deleteMany({ where: { id: { in: runIds } } });
  }
  if (tempRootId) {
    await prisma.category.deleteMany({ where: { id: tempRootId } });
    tempRootId = null;
  }
}

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "tsx", "scripts/make-licence-fixture.mts", "8000", "tmp/it-8000.csv"], {
    stdio: "pipe",
  });
  execFileSync("pnpm", ["exec", "tsx", "scripts/make-licence-fixture.mts", "60", "tmp/it-60.csv"], {
    stdio: "pipe",
  });
  csv8000 = readFileSync("tmp/it-8000.csv", "utf8");
  csv60 = readFileSync("tmp/it-60.csv", "utf8");

  const staff = async (role: Role) =>
    (
      await prisma.user.findFirstOrThrow({
        where: { roles: { has: role } },
        // One of two seeded ops leads, and always the same one.
        orderBy: { id: "asc" },
        select: { id: true },
      })
    ).id;
  opsLead = actor(await staff("staff_ops_lead"), "staff_ops_lead");
  moderator = actor(await staff("staff_moderator"), "staff_moderator");
  fieldOfficer = actor(await staff("staff_field"), "staff_field");

  valvesId = (await prisma.category.findUniqueOrThrow({ where: { slug: "valves-and-fittings" } })).id;
  gateValvesId = (await prisma.category.findUniqueOrThrow({ where: { slug: "gate-valves" } })).id;

  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

/* ── A small file, written per test ─────────────────────────────────────── */

const HEADER = ["Trade Name", "Licence No", "Authority", "Expiry Date", "Emirate", "Area", "Activity", "Phone"];

interface Row {
  name?: string;
  licence?: string;
  authority?: string;
  expiry?: string;
  emirate?: string;
  area?: string;
  activity?: string;
  phone?: string;
}

let serial = 0;
/** A licence number nothing seeded carries. */
const licence = () => `DED-9${TAG}${String((serial += 1)).padStart(3, "0")}`;
const inYears = (years: number) => `${new Date().getUTCFullYear() + years}-06-30`;

/**
 * A name no other row shares a word with.
 *
 * Since board 12b a staged record is matched against every listing, including
 * the ones earlier tests in this file published — and rows that shared a name,
 * a phone and an area with them would pair as duplicates and never publish.
 * Letters from the serial give each row its own identifying word.
 */
const word = (n: number) =>
  `Q${[...String(n * 7919 + Number(TAG))].map((d) => "bcdfghjklm"[Number(d)]).join("")}`;

function row(over: Row = {}): Row {
  const licenceNumber = licence();
  return {
    name: `Summit ${word(serial)} Trading LLC`,
    licence: licenceNumber,
    authority: "",
    expiry: inYears(1),
    emirate: "Dubai",
    area: "Al Quoz Industrial 1",
    activity: "Trading in Valves & Pipe Fittings",
    phone: `04${String(3_000_000 + serial * 37 + (Number(TAG) % 1000)).slice(-7)}`,
    ...over,
  };
}

function file(rows: Row[]): string {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return [
    HEADER.join(","),
    ...rows.map((r) =>
      [r.name, r.licence, r.authority, r.expiry, r.emirate, r.area, r.activity, r.phone]
        .map((value) => cell(value ?? ""))
        .join(","),
    ),
  ].join("\n");
}

async function stage(rows: Row[], name = "small") {
  const result = await stageRun({
    actor: opsLead,
    source: "DED",
    filename: `${PREFIX}${name}.csv`,
    text: file(rows),
    reason: `Staging a test file ${TAG}.`,
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

/* ── Staging ────────────────────────────────────────────────────────────── */

describe("a date, from whatever an authority wrote", () => {
  it("reads ISO and day-first", () => {
    expect(parseLicenceDate("2027-03-01")?.toISOString().slice(0, 10)).toBe("2027-03-01");
    expect(parseLicenceDate("03/08/2027")?.toISOString().slice(0, 10)).toBe("2027-08-03");
    expect(parseLicenceDate("3-8-2027")?.toISOString().slice(0, 10)).toBe("2027-08-03");
  });

  it("returns null rather than a wrong date", () => {
    expect(parseLicenceDate("")).toBeNull();
    expect(parseLicenceDate("next March")).toBeNull();
    // Date.UTC(2027, 1, 31) is the third of March. A typing error in the export
    // must not become a real-looking expiry a month later.
    expect(parseLicenceDate("31/02/2027")).toBeNull();
  });
});

describe("criterion 1 — eight thousand records stage and nothing publishes", () => {
  it("stages them all, whole, and publishes nothing", async () => {
    const before = await prisma.business.count();

    const result = await stageRun({
      actor: opsLead,
      source: "DED",
      filename: `${PREFIX}8000.csv`,
      text: csv8000,
      reason: `The 8,000-row fixture ${TAG}.`,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totals.rows).toBe(8000);
    expect(await prisma.business.count()).toBe(before);

    const [rows, published, run] = await Promise.all([
      prisma.stagedListing.count({ where: { runId: result.runId } }),
      prisma.stagedListing.count({ where: { runId: result.runId, disposition: "published" } }),
      prisma.licenceImportRun.findUniqueOrThrow({
        where: { id: result.runId },
        select: { status: true, headers: true },
      }),
    ]);
    expect(rows).toBe(8000);
    expect(published).toBe(0);
    // `parsing` is never visible outside the transaction that stages the file.
    expect(run.status).toBe("staged");
    expect(run.headers).toEqual(HEADER);
  }, 180_000);

  it("categorises what it can, queues what it cannot, and the buckets sum to the file", async () => {
    const result = await stageRun({
      actor: opsLead,
      source: "DED",
      filename: `${PREFIX}60.csv`,
      text: csv60,
      reason: `The 60-row fixture ${TAG}.`,
    });
    if (!result.ok) throw new Error("staging failed");

    const overview = (await runOverview(result.runId))!;
    expect(overview.categorised).toBeGreaterThan(0);
    expect(overview.queued).toBeGreaterThan(0);
    expect(overview.rejected).toBeGreaterThan(0);
    // Criterion 2.
    expect(overview.newListings + overview.duplicates + overview.rejected).toBe(overview.rowCount);
    expect(overview.byGround.reduce((sum, row) => sum + row.count, 0)).toBe(overview.rejected);
    // All four grounds are rows, including any with nothing in them.
    expect(overview.byGround).toHaveLength(4);
  }, 60_000);

  it("refuses a file with no trade-name column", async () => {
    const result = await stageRun({
      actor: opsLead,
      source: "DED",
      filename: `${PREFIX}wrong.csv`,
      text: "Licence No,Emirate\nDED-1,Dubai\n",
      reason: "A file with the wrong columns.",
    });
    expect(result).toMatchObject({ ok: false, error: "no_trade_name_column" });
  });
});

describe("criterion 9 — the upload is logged", () => {
  it("writes an audit row naming the uploader and the reason", async () => {
    const { runId } = await stage([row()], "audit-upload");
    const events = await prisma.auditEvent.findMany({
      where: { subject: `LicenceImportRun:${runId}` },
      select: { actorId: true, reason: true, action: true },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: opsLead.id, action: "queue_decided" });
    expect(events[0]!.reason).toContain(TAG);
  });

  it("refuses a blank reason, and stages nothing", async () => {
    const before = await prisma.licenceImportRun.count();
    await expect(
      stageRun({ actor: opsLead, source: "DED", filename: `${PREFIX}blank.csv`, text: file([row()]), reason: " " }),
    ).rejects.toBeInstanceOf(AuditReasonError);
    expect(await prisma.licenceImportRun.count()).toBe(before);
  });

  it("refuses a field verifier before reading the file", async () => {
    await expect(
      stageRun({
        actor: fieldOfficer,
        source: "DED",
        filename: `${PREFIX}field.csv`,
        text: file([row()]),
        reason: "Not a decision this role holds.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("criterion 8 — duplicates are handed to dedupe", () => {
  it("marks a licence the directory already lists, by its authority and digits", async () => {
    const listed = await prisma.business.findFirstOrThrow({
      where: { licenceAuthority: "KIZAD", mergedIntoId: null },
      select: { id: true, licenceNumber: true },
    });
    const digits = listed.licenceNumber.replace(/\D/g, "");

    const { runId, totals } = await stage(
      [
        // The export writes the digits alone; the authority column says whose.
        row({ licence: digits, authority: "KIZAD", emirate: "Abu Dhabi" }),
        row(),
      ],
      "dup-listed",
    );

    const duplicate = await prisma.stagedListing.findFirstOrThrow({
      where: { runId, rowNumber: 1 },
      select: { disposition: true, duplicateOfId: true, categoryId: true },
    });
    expect(duplicate).toEqual({ disposition: "duplicate", duplicateOfId: listed.id, categoryId: null });
    expect(totals.duplicates).toBe(1);
  });

  it("marks a licence the same file repeats, and keeps the first", async () => {
    const same = licence();
    const { runId } = await stage([row({ licence: same }), row({ licence: same })], "dup-repeat");
    const rows = await prisma.stagedListing.findMany({
      where: { runId },
      orderBy: { rowNumber: "asc" },
      select: { disposition: true, duplicateOfRow: true },
    });
    expect(rows).toEqual([
      { disposition: "ready", duplicateOfRow: null },
      { disposition: "duplicate", duplicateOfRow: 1 },
    ]);
  });

  it("never publishes a duplicate", async () => {
    const same = licence();
    const { runId } = await stage([row({ licence: same }), row({ licence: same })], "dup-publish");
    const result = await publishRun({ actor: opsLead, runId, reason: REASON });
    expect(result).toMatchObject({ ok: true, created: 1 });
    expect(await prisma.stagedListing.count({ where: { runId, disposition: "duplicate", businessId: { not: null } } })).toBe(0);
  });

  it("catches a licence another run published between staging and approval", async () => {
    const same = licence();
    const first = await stage([row({ licence: same })], "dup-race-a");
    const second = await stage([row({ licence: same })], "dup-race-b");

    await publishRun({ actor: opsLead, runId: first.runId, reason: REASON });
    const result = await publishRun({ actor: opsLead, runId: second.runId, reason: REASON });

    expect(result).toMatchObject({ ok: true, created: 0, duplicates: 1 });
    expect(await prisma.business.count({ where: { licenceNumber: same } })).toBe(1);
  });
});

/* ── Publishing ─────────────────────────────────────────────────────────── */

describe("criteria 4 and 6 — what publishes, and what it carries", () => {
  it("publishes only complete, categorised records, live and unclaimed at tier 0", async () => {
    const lapsed = new Date();
    lapsed.setUTCMonth(lapsed.getUTCMonth() - 3);
    const { runId } = await stage(
      [
        row({ name: `Complete ${word(9001)} Valves LLC` }),
        row({ activity: `Marine Rigging ${TAG}` }), // no category
        row({ expiry: "" }), // no expiry
        row({ licence: "" }), // no licence number
        row({ authority: "XFZ" }), // an authority with no code
        row({ name: `Late ${word(9002)} Renewal LLC`, expiry: lapsed.toISOString().slice(0, 10) }),
      ],
      "publish",
    );

    const result = await publishRun({ actor: opsLead, runId, reason: REASON });
    expect(result).toMatchObject({ ok: true, created: 2, held: 4 });

    const listings = await prisma.business.findMany({
      where: { licenceImportRunId: runId },
      orderBy: { tradeName: "asc" },
      select: {
        displayName: true,
        publishedAt: true,
        verificationTier: true,
        claimStatus: true,
        source: true,
        licenceExpiry: true,
        licenceActivity: true,
        searchText: true,
        locations: { select: { type: true, emirate: true, published: true, addressLine: true } },
      },
    });
    expect(listings).toHaveLength(2);
    for (const listing of listings) {
      expect(listing.publishedAt).not.toBeNull();
      expect(listing.verificationTier).toBe(0);
      expect(listing.claimStatus).toBe("unclaimed");
      expect(listing.source).toBe("licence_import");
      expect(listing.licenceActivity).toBe("Trading in Valves & Pipe Fittings");
      expect(listing.searchText).toContain("valves");
      expect(listing.locations).toEqual([
        { type: "head_office", emirate: "dubai", published: true, addressLine: "Al Quoz Industrial 1" },
      ]);
    }

    // Criterion 6: the register's date, expired or not — never an invented one.
    const late = listings.find((listing) => listing.displayName.startsWith("Late "))!;
    expect(late.licenceExpiry.toISOString().slice(0, 10)).toBe(lapsed.toISOString().slice(0, 10));
    expect(late.licenceExpiry.getTime()).toBeLessThan(Date.now());

    // Criterion 4: the four held records are still exactly where they were.
    expect(
      await prisma.stagedListing.count({
        where: { runId, disposition: { in: ["ready", "needs_category"] }, businessId: null },
      }),
    ).toBe(4);
  });

  it("opens the thirty-day window and records who decided", async () => {
    const { runId } = await stage([row()], "window");
    const before = Date.now();
    await publishRun({ actor: moderator, runId, reason: REASON });

    const run = await prisma.licenceImportRun.findUniqueOrThrow({
      where: { id: runId },
      select: { status: true, decidedById: true, decisionReason: true, reversibleUntil: true },
    });
    expect(run).toMatchObject({ status: "approved", decidedById: moderator.id, decisionReason: REASON });
    const days = (run.reversibleUntil!.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
  });

  it("publishes again from the same run once its queue clears, keeping the window", async () => {
    const phrase = `Rope Access Equipment ${TAG}`;
    const { runId } = await stage([row(), row({ activity: phrase })], "republish");

    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({ ok: true, created: 1 });
    const window = (await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } })).reversibleUntil;

    // Approval did not strand the queued record: it can still be filed and published.
    const filed = await categoriseRecords({
      actor: opsLead,
      categoryId: valvesId,
      reason: `Rope access suppliers file under valves for this test ${TAG}.`,
      target: { kind: "activities", keys: [activityKey(phrase)] },
      remember: false,
      confirmInherited: false,
    });
    expect(filed).toMatchObject({ ok: true, records: 1 });

    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({ ok: true, created: 1 });

    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("approved");
    expect(run.reversibleUntil).toEqual(window);
    expect(await prisma.business.count({ where: { licenceImportRunId: runId } })).toBe(2);
    expect(
      await prisma.auditEvent.count({ where: { subject: `LicenceImportRun:${runId}`, action: "queue_decided" } }),
    ).toBe(4); // upload, publish, categorise, publish
  });

  it("refuses to publish a run whose records are all still waiting", async () => {
    const { runId } = await stage([row({ activity: `Marine Chandlery ${TAG}` })], "waiting");
    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({
      ok: false,
      error: "nothing_ready",
    });
    expect((await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("staged");
  });

  it("approves a file with nothing new, and opens no window", async () => {
    const { runId } = await stage([row({ emirate: "Riyadh" }), row({ name: "N/A" })], "nothing-new");
    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({ ok: true, created: 0 });
    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.status).toBe("approved");
    expect(run.reversibleUntil).toBeNull();
  });

  it("refuses a field verifier and a blank reason, creating nothing", async () => {
    const { runId } = await stage([row()], "refusals");
    const before = await prisma.business.count();
    await expect(publishRun({ actor: fieldOfficer, runId, reason: REASON })).rejects.toBeInstanceOf(PermissionError);
    await expect(publishRun({ actor: opsLead, runId, reason: "  " })).rejects.toThrow();
    expect(await prisma.business.count()).toBe(before);
  });
});

/* ── Categorising ───────────────────────────────────────────────────────── */

describe("criterion 7 — categorisation, as a screen-set decision", () => {
  it("files every waiting record with a phrase, across runs, and logs the kind per run", async () => {
    const phrase = `Industrial Hoses ${TAG}`;
    const a = await stage([row({ activity: phrase }), row({ activity: phrase.toUpperCase() })], "cat-a");
    const b = await stage([row({ activity: `  ${phrase}  ` })], "cat-b");

    const queue = await categorisationQueue({ query: `industrial hoses ${TAG}` });
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]).toMatchObject({ key: activityKey(phrase), records: 3 });
    expect(queue.totalRecords).toBe(3);

    const result = await categoriseRecords({
      actor: moderator,
      categoryId: valvesId,
      reason: `Hose suppliers here are valve stockists ${TAG}.`,
      target: { kind: "activities", keys: [activityKey(phrase)] },
      remember: false,
      confirmInherited: false,
    });
    expect(result).toMatchObject({ ok: true, records: 3, runs: 2, kind: "goods", from: "own" });

    const filed = await prisma.stagedListing.findMany({
      where: { runId: { in: [a.runId, b.runId] } },
      select: { disposition: true, categoryId: true, categorySource: true, categorisedById: true },
    });
    for (const record of filed) {
      expect(record).toEqual({
        disposition: "ready",
        categoryId: valvesId,
        categorySource: "staff",
        categorisedById: moderator.id,
      });
    }

    const events = await prisma.auditEvent.findMany({
      where: { subject: { in: [`LicenceImportRun:${a.runId}`, `LicenceImportRun:${b.runId}`] }, actorId: moderator.id },
      select: { after: true },
    });
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.after).toMatchObject({ categoryId: valvesId, tradeKind: "goods", tradeKindFrom: "own" });
    }

    // The stored counts moved with the records.
    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: a.runId } });
    expect(run).toMatchObject({ queuedCount: 0, categorisedCount: 2 });
  });

  it("asks for confirmation where the kind is only inherited, and records that it was given", async () => {
    const phrase = `Lifting Gear Stockist ${TAG}`;
    const { runId } = await stage([row({ activity: phrase })], "cat-inherited");
    const target = { kind: "activities" as const, keys: [activityKey(phrase)] };
    const reason = `Lifting gear stockists ${TAG}.`;

    const refused = await categoriseRecords({
      actor: opsLead,
      categoryId: gateValvesId,
      reason,
      target,
      remember: false,
      confirmInherited: false,
    });
    expect(refused).toMatchObject({ ok: false, error: "trade_kind_unconfirmed" });
    expect(await prisma.stagedListing.count({ where: { runId, disposition: "needs_category" } })).toBe(1);

    const confirmed = await categoriseRecords({
      actor: opsLead,
      categoryId: gateValvesId,
      reason,
      target,
      remember: false,
      confirmInherited: true,
    });
    expect(confirmed).toMatchObject({ ok: true, records: 1, from: "inherited" });
  });

  it("refuses a category whose kind nothing above it sets", async () => {
    const root = await prisma.category.create({
      data: { name: `Unsorted ${TAG}`, slug: `unsorted-${TAG}`, code: "UN" },
      select: { id: true },
    });
    tempRootId = root.id;

    const phrase = `Unsorted Supply ${TAG}`;
    await stage([row({ activity: phrase })], "cat-default");
    const result = await categoriseRecords({
      actor: opsLead,
      categoryId: root.id,
      reason: `Filing into a category with no kind ${TAG}.`,
      target: { kind: "activities", keys: [activityKey(phrase)] },
      remember: true,
      confirmInherited: true,
    });
    expect(result).toMatchObject({ ok: false, error: "trade_kind_unset" });

    await prisma.category.delete({ where: { id: root.id } });
    tempRootId = null;
  });

  it("scopes a decision to one run unless it is remembered", async () => {
    const phrase = `Scaffold Couplers ${TAG}`;
    const a = await stage([row({ activity: phrase })], "cat-scope-a");
    const b = await stage([row({ activity: phrase })], "cat-scope-b");

    await categoriseRecords({
      actor: opsLead,
      categoryId: valvesId,
      reason: `Only run A's ${TAG}.`,
      target: { kind: "activities", keys: [activityKey(phrase)], runId: a.runId },
      remember: false,
      confirmInherited: false,
    });
    expect(await prisma.stagedListing.count({ where: { runId: b.runId, disposition: "needs_category" } })).toBe(1);
  });

  it("remembers a decision, applies it at the next staging, and forgets it on request", async () => {
    const phrase = `Mooring Equipment ${TAG}`;
    const first = await stage([row({ activity: phrase })], "remember-a");

    const result = await categoriseRecords({
      actor: opsLead,
      categoryId: valvesId,
      reason: `Mooring equipment licences are valve suppliers ${TAG}.`,
      target: { kind: "records", ids: [(await prisma.stagedListing.findFirstOrThrow({ where: { runId: first.runId } })).id] },
      remember: true,
      confirmInherited: false,
    });
    expect(result).toMatchObject({ ok: true, remembered: 1 });

    const mapping = await prisma.licenceActivityMapping.findUniqueOrThrow({
      where: { activityKey: activityKey(phrase) },
    });
    expect(mapping).toMatchObject({ categoryId: valvesId, activity: phrase, actorId: opsLead.id });
    expect(
      await prisma.auditEvent.count({ where: { subject: `LicenceActivity:${activityKey(phrase)}` } }),
    ).toBe(1);

    // B5: next month's file arrives already filed.
    const next = await stage([row({ activity: phrase.toLowerCase() })], "remember-b");
    expect(
      await prisma.stagedListing.findFirstOrThrow({
        where: { runId: next.runId },
        select: { disposition: true, categoryId: true, categorySource: true },
      }),
    ).toEqual({ disposition: "ready", categoryId: valvesId, categorySource: "mapping" });

    expect(
      await forgetActivityMapping({ actor: opsLead, mappingId: mapping.id, reason: `Wrong call ${TAG}.` }),
    ).toEqual({ ok: true });
    const after = await stage([row({ activity: phrase })], "remember-c");
    expect(
      (await prisma.stagedListing.findFirstOrThrow({ where: { runId: after.runId } })).disposition,
    ).toBe("needs_category");
  });

  it("leaves a discarded run's records alone", async () => {
    const phrase = `Discarded Phrase ${TAG}`;
    const { runId } = await stage([row({ activity: phrase })], "cat-discarded");
    await discardRun({ actor: opsLead, runId, reason: `Wrong file ${TAG}.` });

    const result = await categoriseRecords({
      actor: opsLead,
      categoryId: valvesId,
      reason: `Trying to file a discarded run ${TAG}.`,
      target: { kind: "activities", keys: [activityKey(phrase)] },
      remember: false,
      confirmInherited: false,
    });
    expect(result).toMatchObject({ ok: false, error: "nothing_to_categorise" });
  });

  it("refuses a field verifier", async () => {
    await expect(
      categoriseRecords({
        actor: fieldOfficer,
        categoryId: valvesId,
        reason: "Not a decision this role holds.",
        target: { kind: "activities", keys: ["general trading"] },
        remember: false,
        confirmInherited: false,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });
});

/* ── Discarding ─────────────────────────────────────────────────────────── */

describe("discarding a run", () => {
  it("closes a staged run with a reason and publishes nothing", async () => {
    const { runId } = await stage([row()], "discard");
    expect(await discardRun({ actor: moderator, runId, reason: `July's file, not August's ${TAG}.` })).toEqual({
      ok: true,
    });
    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: "discarded", decidedById: moderator.id });
    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({ ok: false, error: "not_open" });
    // B5: the records stay, raw rows and all.
    expect(await prisma.stagedListing.count({ where: { runId } })).toBe(1);
  });

  it("refuses a run that has published", async () => {
    const { runId } = await stage([row()], "discard-approved");
    await publishRun({ actor: opsLead, runId, reason: REASON });
    expect(await discardRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({
      ok: false,
      error: "not_staged",
    });
  });
});

/* ── Rolling back ───────────────────────────────────────────────────────── */

describe("criterion 5 — a rollback detaches, and never takes a claimed listing", () => {
  it("withdraws unclaimed listings, keeps a claimed one whole, and deletes nothing", async () => {
    const { runId } = await stage([row(), row(), row()], "rollback");
    await publishRun({ actor: opsLead, runId, reason: REASON });

    const [claimed, ...unclaimed] = await prisma.business.findMany({
      where: { licenceImportRunId: runId },
      orderBy: { slug: "asc" },
      select: { id: true },
    });

    // A claim lands the day after the run: verified, subscribed.
    const verifiedAt = new Date();
    await prisma.business.update({
      where: { id: claimed!.id },
      data: { claimStatus: "claimed", verificationTier: 1, verifiedAt, planId: "basic" },
    });
    await prisma.subscription.create({
      data: { businessId: claimed!.id, planId: "basic", renewsAt: new Date(Date.now() + 30 * 86_400_000) },
    });

    expect(await rollbackPreview(runId)).toMatchObject({ withdraw: 2, kept: 1, keptBecause: { claimed: 1 } });

    const result = await rollbackRun({ actor: opsLead, runId, reason: `The extract repeated August ${TAG}.` });
    expect(result).toEqual({ ok: true, withdrawn: 2, kept: 1, unwound: 0 });

    const kept = await prisma.business.findUniqueOrThrow({
      where: { id: claimed!.id },
      select: {
        publishedAt: true,
        claimStatus: true,
        verificationTier: true,
        verifiedAt: true,
        subscription: { select: { status: true } },
      },
    });
    expect(kept.publishedAt).not.toBeNull();
    expect(kept).toMatchObject({ claimStatus: "claimed", verificationTier: 1, verifiedAt, subscription: { status: "active" } });

    for (const listing of unclaimed) {
      const row = await prisma.business.findUnique({ where: { id: listing.id }, select: { publishedAt: true } });
      // Unpublished, not deleted.
      expect(row).toEqual({ publishedAt: null });
    }

    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ status: "rolled_back", rolledBackById: opsLead.id });
    expect(run.rollbackManifest).toEqual({
      withdrawn: expect.arrayContaining(unclaimed.map((listing) => listing.id)),
      kept: [{ id: claimed!.id, why: "claimed" }],
    });

    const overview = (await runOverview(runId))!;
    expect(overview.rollback).toMatchObject({ withdrawn: 2, kept: 1 });
    expect(overview.live).toBe(1);
  });

  it("is logged, is terminal, and cannot be taken twice", async () => {
    const { runId } = await stage([row()], "rollback-twice");
    await publishRun({ actor: opsLead, runId, reason: REASON });
    await rollbackRun({ actor: opsLead, runId, reason: `First rollback ${TAG}.` });

    expect(await rollbackRun({ actor: opsLead, runId, reason: `Second ${TAG}.` })).toMatchObject({
      ok: false,
      error: "not_approved",
    });
    expect(await publishRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({ ok: false, error: "not_open" });
    expect(
      await prisma.auditEvent.count({ where: { subject: `LicenceImportRun:${runId}`, action: "queue_decided" } }),
    ).toBe(3); // upload, publish, rollback
  });

  it("closes after thirty days, as a refusal rather than a warning", async () => {
    const { runId } = await stage([row()], "rollback-late");
    await publishRun({ actor: opsLead, runId, reason: REASON });
    const late = new Date(Date.now() + 31 * 86_400_000);
    expect(await rollbackRun({ actor: opsLead, runId, reason: REASON }, late)).toMatchObject({
      ok: false,
      error: "window_closed",
    });
    expect((await runOverview(runId, late))!.reversible).toBe(false);
  });

  it("refuses a run that never published", async () => {
    const { runId } = await stage([row()], "rollback-staged");
    expect(await rollbackRun({ actor: opsLead, runId, reason: REASON })).toMatchObject({
      ok: false,
      error: "not_approved",
    });
  });
});

/* ── Export ─────────────────────────────────────────────────────────────── */

describe("criterion 3 — rejects export with the raw row", () => {
  it("writes one line per rejection, its ground and action, and the file's columns in order", async () => {
    const { runId } = await stage(
      [row(), row({ emirate: "Doha" }), row({ name: "-" }), row({ activity: "Ladies Beauty Salon" })],
      "export",
    );
    const file = await rejectsCsv(runId, {
      ground: (ground) => `ground:${ground}`,
      action: (action) => `action:${action}`,
      headers: ["Row", "Code", "Reason", "Action"],
    });
    expect(file).not.toBeNull();
    const lines = file!.body.split("\r\n");
    expect(lines[0]).toBe(["Row", "Code", "Reason", "Action", ...HEADER].join(","));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("address_outside_uae,ground:address_outside_uae,action:discard");
    expect(lines[1]).toContain(",Doha,");
    expect(file!.filename).toMatch(/^run-\d+-ded-rejects\.csv$/);
  });

  it("orders a raw row by the file's headers, and falls back to reading order without them", () => {
    const raw = { Phone: "1", "Trade Name": "A", Extra: "x", "Licence No": "2" };
    expect(orderRaw(raw, ["Licence No", "Trade Name", "Phone", "Extra"]).map(([h]) => h)).toEqual([
      "Licence No",
      "Trade Name",
      "Phone",
      "Extra",
    ]);
    expect(orderRaw(raw, []).map(([h]) => h)).toEqual(["Trade Name", "Licence No", "Phone", "Extra"]);
  });
});
