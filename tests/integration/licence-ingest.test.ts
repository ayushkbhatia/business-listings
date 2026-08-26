import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { approveRun, runSummary, stageRun, parseLicenceDate } from "@/lib/ingest/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criterion 1, at the number it names:
 *
 *   "An import run of 8,000 records stages without publishing, categorises what
 *    it can, queues what it cannot, and lists rejections by countable reason."
 *
 * Eight thousand is not decoration. It is the difference between an importer
 * that works and one that falls over — `createMany` with 8,000 rows in a single
 * statement exceeds what Postgres will bind, and finding that out at 8,000
 * rather than at 40 is the whole point of the criterion naming a real number.
 *
 * The fixture is generated rather than committed: `scripts/make-licence-fixture.mts`
 * is deterministic, so the counts below are stable.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let fieldOfficerId: string;
let csv: string;
let smallCsv: string;

beforeAll(() => {
  execFileSync("pnpm", ["exec", "tsx", "scripts/make-licence-fixture.mts", "8000", "tmp/it-8000.csv"], {
    stdio: "pipe",
  });
  execFileSync("pnpm", ["exec", "tsx", "scripts/make-licence-fixture.mts", "60", "tmp/it-60.csv"], {
    stdio: "pipe",
  });
  csv = readFileSync("tmp/it-8000.csv", "utf8");
  smallCsv = readFileSync("tmp/it-60.csv", "utf8");
});

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  fieldOfficerId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_field" } },
      select: { id: true },
    })
  ).id;
});

const REASON = "Monthly DED export, checked against last month's run before approving.";

describe("a date, from whatever an authority wrote", () => {
  it("reads ISO", () => {
    expect(parseLicenceDate("2027-03-01")?.toISOString().slice(0, 10)).toBe("2027-03-01");
  });

  it("reads day-first, because every authority here writes day-first", () => {
    // Read as American, 03/08/2027 is five months out — enough to push a live
    // licence over the 24-month floor and reject a real supplier.
    expect(parseLicenceDate("03/08/2027")?.toISOString().slice(0, 10)).toBe("2027-08-03");
    expect(parseLicenceDate("3-8-2027")?.toISOString().slice(0, 10)).toBe("2027-08-03");
  });

  it("returns null rather than a wrong date", () => {
    expect(parseLicenceDate("")).toBeNull();
    expect(parseLicenceDate("next March")).toBeNull();
  });
});

describe("staging eight thousand records", () => {
  it("stages them all, and publishes nothing", async () => {
    const before = await prisma.business.count();

    const result = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-8000.csv",
      text: csv,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.totals.rows).toBe(8000);
    // The load-bearing half of criterion 1.
    expect(await prisma.business.count()).toBe(before);

    const rows = await prisma.stagedListing.count({ where: { runId: result.runId } });
    expect(rows).toBe(8000);

    const published = await prisma.stagedListing.count({
      where: { runId: result.runId, disposition: "published" },
    });
    expect(published).toBe(0);
  }, 120_000);

  it("categorises what it can and queues what it cannot", async () => {
    const result = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!result.ok) throw new Error("staging failed");

    const { totals } = result;
    expect(totals.categorised).toBeGreaterThan(0);
    expect(totals.queued).toBeGreaterThan(0);
    expect(totals.rejected).toBeGreaterThan(0);
    // Everything is in exactly one bucket.
    expect(totals.categorised + totals.queued + totals.rejected).toBe(totals.rows);

    const queued = await prisma.stagedListing.findMany({
      where: { runId: result.runId, disposition: "needs_category" },
      select: { categoryId: true, rejectionGround: true },
      take: 5,
    });
    for (const row of queued) {
      expect(row.categoryId).toBeNull();
      expect(row.rejectionGround).toBeNull();
    }
  }, 60_000);

  it("lists rejections by countable reason", async () => {
    const result = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!result.ok) throw new Error("staging failed");

    const summary = await runSummary(result.runId);
    expect(summary).not.toBeNull();
    expect(summary!.byGround.length).toBeGreaterThan(0);

    // Every ground is one of the four the README fixes, and they add up.
    const grounds = new Set(summary!.byGround.map((row) => row.ground));
    for (const ground of grounds) {
      expect([
        "licence_expired_24_months",
        "no_readable_trade_name",
        "activity_out_of_scope",
        "address_outside_uae",
      ]).toContain(ground);
    }
    const counted = summary!.byGround.reduce((sum, row) => sum + row.count, 0);
    expect(counted).toBe(summary!.rejectedCount);
  }, 60_000);

  it("keeps every row as it arrived, so a rejection can be argued with", async () => {
    const result = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!result.ok) throw new Error("staging failed");

    const rejected = await prisma.stagedListing.findFirstOrThrow({
      where: { runId: result.runId, disposition: "rejected" },
      select: { raw: true, rejectionGround: true },
    });
    expect(rejected.rejectionGround).toBeTruthy();
    expect(Object.keys(rejected.raw as Record<string, unknown>)).toContain("Trade Name");
  }, 60_000);

  it("refuses a file with no trade-name column", async () => {
    const result = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "wrong.csv",
      text: "Licence No,Emirate\nDED-1,Dubai\n",
    });
    expect(result).toMatchObject({ ok: false, error: "no_trade_name_column" });
  });
});

describe("approving a run", () => {
  it("creates listings only from the categorised rows, and only on approval", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    const ready = await prisma.stagedListing.count({
      where: { runId: staged.runId, disposition: "ready" },
    });
    const before = await prisma.business.count();

    const approved = await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;

    // Only the ready rows, and only those whose authority we have a code for.
    expect(approved.created).toBeGreaterThan(0);
    expect(approved.created).toBeLessThanOrEqual(ready);
    expect(await prisma.business.count()).toBe(before + approved.created);

    // Queued rows are still waiting. That is what "queues what it cannot" means.
    const stillQueued = await prisma.stagedListing.count({
      where: { runId: staged.runId, disposition: "needs_category" },
    });
    expect(stillQueued).toBeGreaterThan(0);
  }, 60_000);

  it("creates them unpublished and at tier 0, because nothing has been checked", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });

    const created = await prisma.business.findMany({
      where: { licenceImportRunId: staged.runId },
      select: { publishedAt: true, verificationTier: true, claimStatus: true, source: true },
    });
    expect(created.length).toBeGreaterThan(0);
    for (const business of created) {
      expect(business.publishedAt).toBeNull();
      expect(business.verificationTier).toBe(0);
      expect(business.claimStatus).toBe("unclaimed");
      expect(business.source).toBe("licence_import");
    }
  }, 60_000);

  it("records where each listing came from", async () => {
    // `Business.importRunId` was a bare TEXT column with no FK and no reader
    // from the init migration. This is the column that means what that one's
    // name claimed.
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });

    const withProvenance = await prisma.licenceImportRun.findUniqueOrThrow({
      where: { id: staged.runId },
      select: { _count: { select: { businesses: true } } },
    });
    expect(withProvenance._count.businesses).toBeGreaterThan(0);
  }, 60_000);

  it("writes one audit row with the reason", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });

    const rows = await prisma.auditEvent.findMany({
      where: { action: "queue_decided", subject: `LicenceImportRun:${staged.runId}` },
      select: { reason: true, actorId: true },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reason).toBe(REASON);
  }, 60_000);

  it("refuses a second approval", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });
    const again = await approveRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      runId: staged.runId,
      reason: REASON,
    });
    expect(again).toMatchObject({ ok: false, error: "not_staged" });
  }, 60_000);

  it("refuses a field verifier — queue.decide is moderator or ops lead", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    await expect(
      approveRun({
        actor: actor(fieldOfficerId, "staff_field"),
        runId: staged.runId,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(PermissionError);

    const run = await prisma.licenceImportRun.findUniqueOrThrow({
      where: { id: staged.runId },
      select: { status: true },
    });
    expect(run.status).toBe("staged");
  }, 60_000);

  it("refuses a blank reason before anything is created", async () => {
    const staged = await stageRun({
      actor: actor(opsLeadId, "staff_ops_lead"),
      source: "DED",
      filename: "it-60.csv",
      text: smallCsv,
    });
    if (!staged.ok) throw new Error("staging failed");

    const before = await prisma.business.count();
    await expect(
      approveRun({
        actor: actor(opsLeadId, "staff_ops_lead"),
        runId: staged.runId,
        reason: "  ",
      }),
    ).rejects.toThrow();
    expect(await prisma.business.count()).toBe(before);
  }, 60_000);
});
