import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { publishRun, rollbackPreview, rollbackRun, stageRun } from "@/lib/ingest/service";
import { activityKey } from "@/lib/ingest/classify";
import { dedupeCounts, manualQueue, ownerBranches, PENDING, todayTally } from "@/lib/dedupe/queue";
import {
  bulkMerge,
  decideBranch,
  resolvePair,
  reverseBatch,
  reversePair,
} from "@/lib/dedupe/resolve";
import { BANDS_SETTING_KEY } from "@/lib/dedupe/source";
import { applyTuning, previewTuning } from "@/lib/dedupe/tuning";
import { mergeBusinesses } from "@/lib/dedupe/service";
import { purgeAuditRows } from "./audit-cleanup";

/**
 * Board 12b — the dedupe queue, against a real database.
 *
 *   1  the claimed or paying record is always the merge parent
 *   2  all three outcomes resolve the pair; skip leaves it pending
 *   3  bulk merge is one transaction, one audit entry, reversible as a unit
 *   4  a run rollback either unwinds merges sourced from that run or refuses, naming them
 *   5  every resolution is logged with the acting staff user
 *   6  (keyboard — the e2e spec)
 *   7  re-tuning the band previews the resulting queue size before applying
 *   8  a merged branch keeps its own licence number
 *   9  reversal within 30 days restores both records exactly
 *
 * The pairs come the way production's do: a file staged through `stageRun`,
 * against listings this file creates. The board's own pair is the first
 * fixture — a claimed, paying Gulf Cool against its branch licence from a run.
 */

const TAG = String(Date.now()).slice(-6);
const SLUG = `dd12b-${TAG}-`;
const FILE = "it-dd12b-";
const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLead: Actor;
let moderator: Actor;
let owner: Actor;
let categoryId: string;
let quoz1: string;
let quoz3: string;
let serial = 0;

async function removeFixtures() {
  const runs = await prisma.licenceImportRun.findMany({ where: { filename: { startsWith: FILE } }, select: { id: true } });
  const listings = await prisma.business.findMany({ where: { slug: { startsWith: SLUG } }, select: { id: true } });
  const runIds = runs.map((row) => row.id);
  const listingIds = listings.map((row) => row.id);
  const batches = await prisma.mergeCandidate.findMany({
    where: { OR: [{ sourceRunId: { in: runIds } }, { keepId: { in: listingIds } }], batchId: { not: null } },
    select: { batchId: true },
  });

  await purgeAuditRows({
    OR: [
      { subject: { in: runIds.map((id) => `LicenceImportRun:${id}`) } },
      { subject: { in: listingIds.map((id) => `Business:${id}`) } },
      { subject: { in: batches.map((row) => `MergeBatch:${row.batchId}`) } },
      { subject: `PlatformSetting:${BANDS_SETTING_KEY}`, reason: { contains: TAG } },
    ],
  });
  await prisma.location.updateMany({ where: { businessId: { in: listingIds } }, data: { addedByCandidateId: null } });
  await prisma.mergeCandidate.deleteMany({
    where: { OR: [{ sourceRunId: { in: runIds } }, { keepId: { in: listingIds } }, { absorbId: { in: listingIds } }] },
  });
  await prisma.businessMerge.deleteMany({
    where: { OR: [{ keepId: { in: listingIds } }, { absorbId: { in: listingIds } }] },
  });
  await prisma.mergeBatch.deleteMany({ where: { id: { in: batches.map((row) => row.batchId!) } } });
  await prisma.stagedListing.deleteMany({ where: { runId: { in: runIds } } });
  await prisma.subscription.deleteMany({ where: { businessId: { in: listingIds } } });
  await prisma.redirect.deleteMany({ where: { fromPath: { startsWith: `/b/${SLUG}` } } });
  await prisma.business.deleteMany({
    where: { OR: [{ id: { in: listingIds } }, { licenceImportRunId: { in: runIds } }] },
  });
  await prisma.licenceImportRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.platformSetting.deleteMany({ where: { key: BANDS_SETTING_KEY } });
}

beforeAll(async () => {
  const staff = async (role: Role) =>
    (await prisma.user.findFirstOrThrow({ where: { roles: { has: role } }, orderBy: { id: "asc" }, select: { id: true } })).id;
  opsLead = actor(await staff("staff_ops_lead"), "staff_ops_lead");
  moderator = actor(await staff("staff_moderator"), "staff_moderator");
  owner = actor(await staff("seller_owner"), "seller_owner");
  categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: "hvac-and-ventilation" } })).id;
  quoz1 = (await prisma.area.findFirstOrThrow({ where: { name: "Al Quoz Industrial 1" } })).id;
  quoz3 = (await prisma.area.findFirstOrThrow({ where: { name: "Al Quoz Industrial 3" } })).id;
  await removeFixtures();
});

afterAll(async () => {
  await removeFixtures();
});

const unique = () => {
  serial += 1;
  return `${TAG}${String(serial).padStart(2, "0")}`;
};
const word = (seed: string) => `Z${[...seed].map((d) => "bcdfghjklm"[Number(d)]).join("")}`;

/** A live listing with its head office in Al Quoz Industrial 3. */
async function listing(over: { claimed?: boolean; paying?: boolean; name?: string; licence?: string; phone?: string } = {}) {
  const id = unique();
  const name = over.name ?? `${word(id)} Cooling Services LLC`;
  const business = await prisma.business.create({
    data: {
      tradeName: name,
      displayName: name.replace(/ LLC$/, ""),
      slug: `${SLUG}${id}`,
      licenceNumber: over.licence ?? `DED-5${id}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 400 * 86_400_000),
      licenceActivity: "Air Conditioning Equipment Trading",
      primaryCategoryId: categoryId,
      claimStatus: over.claimed ? "claimed" : "unclaimed",
      publishedAt: new Date(Date.now() - 86_400_000),
      planId: over.paying ? "pro" : null,
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId: quoz3,
          addressLine: "W/H 7",
          phone: over.phone ?? `04${id.slice(-7)}`,
          published: true,
        },
      },
    },
    select: { id: true, licenceNumber: true, slug: true, displayName: true },
  });
  if (over.paying) {
    await prisma.subscription.create({
      data: { businessId: business.id, planId: "pro", renewsAt: new Date(Date.now() + 30 * 86_400_000) },
    });
  }
  return business;
}

interface Row {
  name: string;
  licence: string;
  area?: string;
  phone?: string;
  activity?: string;
}

async function stage(rows: Row[]) {
  const csv = [
    "Trade Name,Licence No,Expiry Date,Emirate,Area,Activity,Phone",
    ...rows.map((row) =>
      [
        row.name,
        row.licence,
        `${new Date().getUTCFullYear() + 1}-06-30`,
        "Dubai",
        row.area ?? "Al Quoz Industrial 1",
        row.activity ?? "Air Conditioning Equipment Trading",
        row.phone ?? "",
      ].join(","),
    ),
  ].join("\n");
  const result = await stageRun({
    actor: opsLead,
    source: "DED",
    filename: `${FILE}${unique()}.csv`,
    text: csv,
    reason: `Dedupe fixture ${TAG}.`,
  });
  if (!result.ok) throw new Error(result.message);
  return result.runId;
}

async function pairFor(recordRow: number, runId: string) {
  const record = await prisma.stagedListing.findFirstOrThrow({ where: { runId, rowNumber: recordRow }, select: { id: true } });
  return prisma.mergeCandidate.findFirstOrThrow({
    where: { stagedListingId: record.id },
    select: { id: true, state: true, band: true, score: true, keepId: true, stagedListingId: true },
  });
}

/** The board's pair: a claimed, paying listing and a branch licence from a run. */
async function boardPair() {
  const parent = await listing({ claimed: true, paying: true });
  const runId = await stage([
    {
      name: `${parent.displayName} (Branch)`,
      licence: `${parent.licenceNumber}-01`,
      phone: (await prisma.location.findFirstOrThrow({ where: { businessId: parent.id } })).phone!,
    },
  ]);
  return { parent, runId, pair: await pairFor(1, runId) };
}

const REASON = `Licence root and phone agree; the -01 suffix is a branch ${TAG}.`;

/* ── Staging produces pairs ─────────────────────────────────────────────── */

describe("a run's records arrive as pairs", () => {
  it("pairs a branch licence with its parent in the manual band, not the bulk one", async () => {
    const { parent, runId, pair } = await boardPair();
    expect(pair).toMatchObject({ state: "pending", band: "probable", keepId: parent.id });

    const record = await prisma.stagedListing.findUniqueOrThrow({
      where: { id: pair.stagedListingId! },
      select: { disposition: true, duplicateOfId: true },
    });
    expect(record).toEqual({ disposition: "duplicate", duplicateOfId: parent.id });

    const queue = await manualQueue({ runId });
    expect(queue.total).toBe(1);
    expect(queue.pair).toMatchObject({
      kind: "record",
      a: { id: parent.id, claimed: true, paying: true },
      b: { kind: "record", licenceNumber: `${parent.licenceNumber}-01` },
      hint: { kind: "branch_suffix", suffix: "01" },
    });
    expect(queue.pair!.signals.map((signal) => signal.key)).toEqual(
      expect.arrayContaining(["licence_root", "phone", "trade_name", "nearby_area", "activity"]),
    );
  });

  it("puts a re-sent licence above the certain line", async () => {
    const existing = await listing();
    const runId = await stage([{ name: existing.displayName, licence: existing.licenceNumber, area: "Al Quoz Industrial 3" }]);
    const pair = await pairFor(1, runId);
    expect(pair.band).toBe("certain");
    const counts = await dedupeCounts({ runId });
    expect(counts).toMatchObject({ pending: 1, certain: 1, probable: 0 });
  });

  it("counts a record that shares a licence root and scored under the floor (B10)", async () => {
    const existing = await listing();
    const runId = await stage([{ name: `${word(unique())} Unrelated Supplies`, licence: `${existing.licenceNumber}-07`, activity: "Packaging Materials Trading" }]);
    const run = await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId }, select: { belowFloorCount: true } });
    expect(run.belowFloorCount).toBe(1);
    const record = await prisma.stagedListing.findFirstOrThrow({ where: { runId }, select: { disposition: true } });
    expect(record.disposition).not.toBe("duplicate");
  });
});

/* ── The three outcomes ─────────────────────────────────────────────────── */

describe("criteria 2, 5 and 8 — three outcomes, each logged", () => {
  it("adds a branch that keeps its own licence number, held for a claimed listing's owner", async () => {
    const { parent, pair } = await boardPair();

    const result = await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    expect(result).toMatchObject({ ok: true, outcome: "merge", heldForOwner: true });

    const branch = await prisma.location.findFirstOrThrow({
      where: { businessId: parent.id, addedByCandidateId: pair.id },
      select: { licenceNumber: true, published: true, areaId: true },
    });
    // B9, and Q2: its own licence, and not live until the owner says so.
    expect(branch).toEqual({ licenceNumber: `${parent.licenceNumber}-01`, published: false, areaId: quoz1 });

    const row = await prisma.mergeCandidate.findUniqueOrThrow({
      where: { id: pair.id },
      select: { state: true, resolvedById: true, ownerConfirmation: true, reversibleUntil: true },
    });
    expect(row).toMatchObject({ state: "merged", resolvedById: opsLead.id, ownerConfirmation: "awaiting" });
    expect(await prisma.stagedListing.findUniqueOrThrow({ where: { id: pair.stagedListingId! }, select: { disposition: true, businessId: true } }))
      .toEqual({ disposition: "merged", businessId: parent.id });

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { subject: `Business:${parent.id}`, action: "pair_merged" },
      select: { actorId: true, reason: true, after: true },
    });
    expect(audit).toMatchObject({ actorId: opsLead.id, reason: REASON, after: { candidateId: pair.id, outcome: "merge" } });
  });

  it("keeps a record separate: it goes back to its run to publish, and is not paired again", async () => {
    const { parent, runId, pair } = await boardPair();
    const result = await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "separate", reason: `Trades under its own name ${TAG}.` });
    expect(result.ok).toBe(true);

    const record = await prisma.stagedListing.findUniqueOrThrow({
      where: { id: pair.stagedListingId! },
      select: { disposition: true, duplicateOfId: true, categoryId: true },
    });
    // "Air Conditioning Equipment Trading" is a keyword the importer reads.
    expect(record).toEqual({ disposition: "ready", duplicateOfId: null, categoryId: expect.any(String) });

    // Publishes from its run as a listing of its own.
    const published = await publishRun({ actor: opsLead, runId, reason: `Separate company ${TAG}.` });
    expect(published).toMatchObject({ ok: true, created: 1 });

    // Next month's file re-sends it: the separation is remembered (B2).
    const next = await stage([
      { name: `${parent.displayName} (Branch)`, licence: `${parent.licenceNumber}-01` },
    ]);
    const nextPairs = await prisma.mergeCandidate.findMany({
      where: { sourceRunId: next, keepId: parent.id },
      select: { id: true },
    });
    expect(nextPairs).toEqual([]);
  });

  it("discards a record as a source error", async () => {
    const { pair } = await boardPair();
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "discard", reason: `Registry typo ${TAG}.` });
    expect(await prisma.stagedListing.findUniqueOrThrow({ where: { id: pair.stagedListingId! }, select: { disposition: true } }))
      .toEqual({ disposition: "discarded" });
    expect((await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id } })).state).toBe("discarded");
  });

  it("a skip writes nothing: the pair is still pending and still first", async () => {
    const { runId, pair } = await boardPair();
    const before = await manualQueue({ runId });
    // The screen's skip only moves the cursor. Nothing on the server changed.
    const after = await manualQueue({ runId, position: 2 });
    expect(before.pair!.id).toBe(pair.id);
    expect(after.pair!.id).toBe(pair.id); // clamped: one pair in this run
    expect((await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id } })).state).toBe("pending");
  });

  it("refuses a moderator and a blank reason, and resolves nothing", async () => {
    const { pair } = await boardPair();
    await expect(resolvePair({ actor: moderator, candidateId: pair.id, outcome: "merge", reason: REASON })).rejects.toBeInstanceOf(PermissionError);
    await expect(resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: " " })).rejects.toBeInstanceOf(AuditReasonError);
    expect((await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id } })).state).toBe("pending");
    expect(await prisma.location.count({ where: { addedByCandidateId: pair.id } })).toBe(0);
  });

  it("asks for the area when the register's is not one we list", async () => {
    const parent = await listing({ claimed: false });
    const runId = await stage([{ name: `${parent.displayName} (Branch)`, licence: `${parent.licenceNumber}-02`, area: "Somewhere Unmapped", phone: (await prisma.location.findFirstOrThrow({ where: { businessId: parent.id } })).phone! }]);
    const pair = await pairFor(1, runId);
    expect(await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON })).toMatchObject({ ok: false, error: "area_needed" });
    const done = await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON, areaId: quoz1 });
    // An unclaimed parent has no owner to wait for: live straight away.
    expect(done).toMatchObject({ ok: true, heldForOwner: false });
    expect(await prisma.location.findFirstOrThrow({ where: { addedByCandidateId: pair.id }, select: { published: true } })).toEqual({ published: true });
  });
});

/* ── Two listings ───────────────────────────────────────────────────────── */

describe("criterion 1 — the claimed, paying record is always the parent", () => {
  async function listingPair(a: Parameters<typeof listing>[0], b: Parameters<typeof listing>[0]) {
    const phone = `04${unique().slice(-7)}`;
    const name = `${word(unique())} Chillers LLC`;
    const left = await listing({ ...a, name, phone });
    const right = await listing({ ...b, name, phone });
    // Stored the wrong way round on purpose: the unclaimed side as record A.
    return prisma.mergeCandidate.create({
      data: { keepId: right.id, absorbId: left.id, score: 0.8, band: "probable", signals: [] },
      select: { id: true, keepId: true, absorbId: true },
    }).then((pair) => ({ pair, left, right }));
  }

  it("merges the unclaimed listing into the claimed one, whichever side it was stored on", async () => {
    const { pair, left: claimed, right: unclaimed } = await listingPair({ claimed: true, paying: true }, {});
    const result = await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    expect(result).toMatchObject({ ok: true, parentName: claimed.displayName });
    expect(await prisma.business.findUniqueOrThrow({ where: { id: unclaimed.id }, select: { mergedIntoId: true } })).toEqual({ mergedIntoId: claimed.id });
    expect(await prisma.business.findUniqueOrThrow({ where: { id: claimed.id }, select: { mergedIntoId: true } })).toEqual({ mergedIntoId: null });

    // B9: the arrived location carries the absorbed listing's licence.
    const moved = await prisma.location.findFirstOrThrow({ where: { businessId: claimed.id, licenceNumber: unclaimed.licenceNumber } });
    expect(moved.published).toBe(false); // held for the owner (Q2)
  });

  it("will not merge or discard two claimed listings (Q3)", async () => {
    const { pair } = await listingPair({ claimed: true }, { claimed: true });
    expect(await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON })).toMatchObject({ ok: false, error: "both_claimed" });
    expect(await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "discard", reason: REASON })).toMatchObject({ ok: false, error: "both_claimed" });
    expect(await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "separate", reason: REASON })).toMatchObject({ ok: true });
  });

  it("criterion 9: reversal restores both listings exactly", async () => {
    const { pair, left: claimed, right: unclaimed } = await listingPair({ claimed: true }, {});
    const before = await prisma.business.findUniqueOrThrow({ where: { id: unclaimed.id }, select: { publishedAt: true } });
    const locationBefore = await prisma.location.findFirstOrThrow({ where: { businessId: unclaimed.id }, select: { id: true, licenceNumber: true, published: true } });

    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    const reversed = await reversePair({ actor: opsLead, candidateId: pair.id, reason: `Not the same company ${TAG}.` });
    expect(reversed).toEqual({ ok: true });

    expect(await prisma.business.findUniqueOrThrow({ where: { id: unclaimed.id }, select: { publishedAt: true, mergedIntoId: true } }))
      .toEqual({ publishedAt: before.publishedAt, mergedIntoId: null });
    expect(await prisma.location.findUniqueOrThrow({ where: { id: locationBefore.id }, select: { businessId: true, licenceNumber: true, published: true } }))
      .toEqual({ businessId: unclaimed.id, licenceNumber: locationBefore.licenceNumber, published: locationBefore.published });
    expect(await prisma.location.count({ where: { businessId: claimed.id } })).toBe(1);
    expect((await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id } })).state).toBe("pending");
    expect(await prisma.auditEvent.count({ where: { action: "pair_reversed", subject: `Business:${unclaimed.id}` } })).toBe(1);
  });

  it("withdraws a pair when one side is merged elsewhere, with the reason", async () => {
    const { pair, left, right } = await listingPair({}, {});
    const third = await listing();
    await mergeBusinesses({ actor: opsLead, keepId: third.id, absorbId: right.id, reason: REASON });
    const row = await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id }, select: { state: true, withdrawnReason: true } });
    expect(row).toEqual({ state: "withdrawn", withdrawnReason: "merged_elsewhere" });
    void left;
  });
});

/* ── The owner ──────────────────────────────────────────────────────────── */

describe("Q2 — the owner confirms or rejects a branch", () => {
  it("confirming publishes the branch, and nobody on the dedupe screen can take it back", async () => {
    const { parent, pair } = await boardPair();
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    const [branch] = await ownerBranches(parent.id);
    expect(branch).toMatchObject({ confirmation: "awaiting", published: false, licenceNumber: `${parent.licenceNumber}-01` });

    expect(await decideBranch({ actor: owner, businessId: parent.id, locationId: branch!.locationId, decision: "confirm" })).toEqual({ ok: true, decision: "confirm" });
    expect(await prisma.location.findUniqueOrThrow({ where: { id: branch!.locationId }, select: { published: true } })).toEqual({ published: true });
    expect(await ownerBranches(parent.id)).toEqual([]);

    expect(await reversePair({ actor: opsLead, candidateId: pair.id, reason: `Trying ${TAG}.` })).toMatchObject({ ok: false, error: "owner_confirmed" });
  });

  it("rejecting removes the branch and keeps the record separate, against the owner's name", async () => {
    const { parent, pair } = await boardPair();
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    const [branch] = await ownerBranches(parent.id);

    expect(await decideBranch({ actor: owner, businessId: parent.id, locationId: branch!.locationId, decision: "reject" })).toEqual({ ok: true, decision: "reject" });
    expect(await prisma.location.findUnique({ where: { id: branch!.locationId } })).toBeNull();
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id }, select: { state: true, ownerConfirmation: true, resolvedById: true } }))
      .toEqual({ state: "separated", ownerConfirmation: "rejected", resolvedById: owner.id });
    expect((await prisma.stagedListing.findUniqueOrThrow({ where: { id: pair.stagedListingId! } })).disposition).toBe("ready");
  });

  it("refuses a branch that is not on the owner's listing", async () => {
    const { pair } = await boardPair();
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    const branch = await prisma.location.findFirstOrThrow({ where: { addedByCandidateId: pair.id } });
    const other = await listing({ claimed: true });
    expect(await decideBranch({ actor: owner, businessId: other.id, locationId: branch.id, decision: "confirm" })).toMatchObject({ ok: false, error: "not_found" });
  });
});

/* ── Bulk ───────────────────────────────────────────────────────────────── */

describe("criterion 3 — a bulk merge is one transaction, one audit entry, one reversal", () => {
  it("merges every certain pair of a run and puts them all back together", async () => {
    const one = await listing();
    const two = await listing({ claimed: true });
    const runId = await stage([
      { name: one.displayName, licence: one.licenceNumber, area: "Al Quoz Industrial 1" },
      { name: two.displayName, licence: two.licenceNumber, area: "Al Quoz Industrial 1" },
    ]);
    expect((await dedupeCounts({ runId })).certain).toBe(2);

    const result = await bulkMerge({ actor: opsLead, reason: `Monthly re-send ${TAG}.`, runId });
    expect(result).toMatchObject({ ok: true, merged: 2, skippedArea: 0 });
    if (!result.ok) return;

    expect(await prisma.auditEvent.count({ where: { subject: `MergeBatch:${result.batchId}`, action: "pairs_bulk_merged" } })).toBe(1);
    const pairs = await prisma.mergeCandidate.findMany({ where: { sourceRunId: runId }, select: { state: true, batchId: true, ownerConfirmation: true, keepId: true } });
    expect(pairs.every((pair) => pair.state === "merged" && pair.batchId === result.batchId)).toBe(true);
    // A bulk branch on a claimed listing is live; its owner is told, and may reject.
    expect(pairs.find((pair) => pair.keepId === two.id)!.ownerConfirmation).toBe("informed");
    expect(await prisma.location.count({ where: { businessId: { in: [one.id, two.id] }, addedByCandidateId: { not: null }, published: true } })).toBe(2);

    const reversed = await reverseBatch({ actor: opsLead, batchId: result.batchId, reason: `Wrong file ${TAG}.` });
    expect(reversed).toEqual({ ok: true, restored: 2, kept: 0 });
    expect(await prisma.location.count({ where: { businessId: { in: [one.id, two.id] }, addedByCandidateId: { not: null } } })).toBe(0);
    expect(await prisma.mergeCandidate.count({ where: { sourceRunId: runId, ...PENDING } })).toBe(2);
    expect(await prisma.stagedListing.count({ where: { runId, disposition: "duplicate" } })).toBe(2);
  });
});

/* ── Rollback ───────────────────────────────────────────────────────────── */

describe("criterion 4 — a run rollback unwinds its merges, or refuses and names them", () => {
  async function publishedRunWithMerge() {
    const parent = await listing();
    const runId = await stage([
      { name: `${word(unique())} Fresh Company`, licence: `DED-6${unique()}`, activity: "Packaging Materials Trading" },
      { name: `${parent.displayName} (Branch)`, licence: `${parent.licenceNumber}-03`, phone: (await prisma.location.findFirstOrThrow({ where: { businessId: parent.id } })).phone! },
    ]);
    const pair = await pairFor(2, runId);
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    await publishRun({ actor: opsLead, runId, reason: `Publishing ${TAG}.` });
    return { parent, runId, pair };
  }

  it("unwinds a branch added from the run before withdrawing the run's listings", async () => {
    const { parent, runId, pair } = await publishedRunWithMerge();
    const preview = await rollbackPreview(runId);
    expect(preview.unwind).toEqual([parent.displayName]);

    const result = await rollbackRun({ actor: opsLead, runId, reason: `Bad file ${TAG}.` });
    expect(result).toMatchObject({ ok: true, unwound: 1, withdrawn: 1 });
    expect(await prisma.location.count({ where: { addedByCandidateId: pair.id } })).toBe(0);
    expect(await prisma.location.count({ where: { businessId: parent.id } })).toBe(1);
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id }, select: { state: true, withdrawnReason: true } }))
      .toEqual({ state: "withdrawn", withdrawnReason: "run_rolled_back" });
  });

  it("refuses when an owner confirmed a branch from the run, naming the listing", async () => {
    const parent = await listing({ claimed: true });
    const runId = await stage([
      { name: `${word(unique())} Fresh Company`, licence: `DED-6${unique()}`, activity: "Packaging Materials Trading" },
      { name: `${parent.displayName} (Branch)`, licence: `${parent.licenceNumber}-04`, phone: (await prisma.location.findFirstOrThrow({ where: { businessId: parent.id } })).phone! },
    ]);
    const pair = await pairFor(2, runId);
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "merge", reason: REASON });
    const branch = await prisma.location.findFirstOrThrow({ where: { addedByCandidateId: pair.id } });
    await decideBranch({ actor: owner, businessId: parent.id, locationId: branch.id, decision: "confirm" });
    await publishRun({ actor: opsLead, runId, reason: `Publishing ${TAG}.` });

    const result = await rollbackRun({ actor: opsLead, runId, reason: `Bad file ${TAG}.` });
    expect(result).toMatchObject({ ok: false, error: "merges_confirmed" });
    expect(!result.ok && result.message).toContain(parent.displayName);
    expect((await prisma.licenceImportRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("approved");
  });

  it("refuses a moderator's rollback that would undo merges", async () => {
    const { runId } = await publishedRunWithMerge();
    expect(await rollbackRun({ actor: actor(moderator.id, "staff_moderator"), runId, reason: `Bad file ${TAG}.` }))
      .toMatchObject({ ok: false, error: "merges_need_merge_role" });
  });
});

/* ── Tuning and the rail ────────────────────────────────────────────────── */

describe("criterion 7 — re-tuning previews the queue before applying", () => {
  it("states the withdrawn count, and applying does exactly that", async () => {
    const { pair } = await boardPair();
    const preview = await previewTuning({ actor: opsLead, bands: { floor: 0.88, certain: 0.95 } });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.after.withdrawn).toBeGreaterThanOrEqual(1);

    const applied = await applyTuning({ actor: opsLead, bands: { floor: 0.88, certain: 0.95 }, reason: `Floor too low ${TAG}.` });
    expect(applied).toMatchObject({ ok: true, after: { withdrawn: preview.after.withdrawn } });
    expect(await prisma.mergeCandidate.findUniqueOrThrow({ where: { id: pair.id }, select: { state: true, withdrawnReason: true } }))
      .toEqual({ state: "withdrawn", withdrawnReason: "below_floor" });
    expect(await prisma.auditEvent.count({ where: { action: "matching_tuned", reason: `Floor too low ${TAG}.` } })).toBe(1);

    await prisma.platformSetting.deleteMany({ where: { key: BANDS_SETTING_KEY } });
  }, 120_000);

  it("refuses a certain line that would let circumstance bulk-merge", async () => {
    expect(await previewTuning({ actor: opsLead, bands: { floor: 0.6, certain: 0.8 } })).toEqual({ ok: false, problem: "certain_too_low" });
  });
});

describe("B6 — the today rail reads the log", () => {
  it("counts this person's decisions by outcome", async () => {
    const before = await todayTally(opsLead.id);
    const { pair } = await boardPair();
    await resolvePair({ actor: opsLead, candidateId: pair.id, outcome: "discard", reason: `Counting ${TAG}.` });
    const after = await todayTally(opsLead.id);
    expect(after.discarded).toBe(before.discarded + 1);
    expect(after.reviewed).toBe(before.reviewed + 1);
    void activityKey;
  });
});
