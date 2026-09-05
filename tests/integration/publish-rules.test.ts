import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  approveRuleChange,
  closeRuleChange,
  previewRuleChange,
  proposeRuleChange,
} from "@/lib/content/publish-rule";
import { recordScopeDemand } from "@/lib/content/demand";
import { holdLandingPage, releaseLandingPage } from "@/lib/content/hold";
import { generateDrafts } from "@/lib/content/drafts";
import { areaMatrix } from "@/lib/content/matrix";
import { thresholdsFor } from "@/lib/taxonomy/service";

/**
 * Board 6f §5 — the rules panel, under dual control.
 *
 * The threshold cases that used to live in `spec-library.test.ts` are here,
 * because `editCategory` no longer writes a rule column: every number that
 * decides whether a page exists goes through an impact preview and a second
 * approver, and a single-approver path to the same columns would have made the
 * approver a formality.
 *
 * Two ops leads, by id rather than by luck. `findFirst` has no defined order,
 * and the whole subject of this file is that two different people are involved.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let firstLead: string;
let secondLead: string;
let moderatorId: string;
let categoryId: string;
let restore: {
  publishThreshold: number;
  verifiedShareMin: number;
  demandPerThousand: number;
  holdShare: number;
  minIntroWords: number;
  minLiveDays: number;
  humanReviewRequired: boolean;
};

beforeAll(async () => {
  const leads = await prisma.user.findMany({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  expect(
    leads.length,
    "dual control needs two seeded ops leads; the seed creates them",
  ).toBeGreaterThanOrEqual(2);
  firstLead = leads[0]!.id;
  secondLead = leads[1]!.id;

  moderatorId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_moderator" } },
      select: { id: true },
    })
  ).id;

  const category = await prisma.category.findFirstOrThrow({
    where: { parentId: null },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      publishThreshold: true,
      verifiedShareMin: true,
      demandPerThousand: true,
      holdShare: true,
      minIntroWords: true,
      minLiveDays: true,
      humanReviewRequired: true,
    },
  });
  const { id, ...values } = category;
  categoryId = id;
  restore = values;
});

afterAll(async () => {
  await prisma.publishRuleChange.deleteMany({ where: { categoryId } });
  await prisma.category.update({ where: { id: categoryId }, data: restore });
  await prisma.$disconnect();
});

const lead = () => actor(firstLead, "staff_ops_lead");
const second = () => actor(secondLead, "staff_ops_lead");

describe("the impact preview", () => {
  it("writes nothing and names the pages that would move", async () => {
    const before = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { publishThreshold: true },
    });

    const result = await previewRuleChange(lead(), categoryId, { publishThreshold: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // A count is the size of the change; the list is whether it matters.
    expect(Array.isArray(result.impact.publishing)).toBe(true);
    expect(Array.isArray(result.impact.unpublishing)).toBe(true);
    expect(result.impact.publishes).toBe(result.impact.publishing.length);

    const after = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { publishThreshold: true },
    });
    expect(after.publishThreshold).toBe(before.publishThreshold);
    expect(await prisma.publishRuleChange.count({ where: { categoryId } })).toBe(0);
  }, 120_000);

  it("refuses a change that changes nothing", async () => {
    const same = await previewRuleChange(lead(), categoryId, {
      publishThreshold: restore.publishThreshold,
    });
    expect(same).toMatchObject({ ok: false, error: "no_change" });
  }, 60_000);

  it("refuses a value outside its bounds", async () => {
    expect(await previewRuleChange(lead(), categoryId, { verifiedShareMin: 30 })).toMatchObject({
      ok: false,
      error: "out_of_range",
    });
    expect(await previewRuleChange(lead(), categoryId, { holdShare: 0 })).toMatchObject({
      ok: false,
      error: "out_of_range",
    });
  }, 60_000);

  it("refuses a seat that is not an ops lead, before it computes anything", async () => {
    // `previewRename` on the categories board asks for no capability at all, so
    // any staff seat can ask it how many addresses a rename moves. This one is
    // a map of the whole index's soft spots and is gated like the write.
    expect(
      await previewRuleChange(actor(moderatorId, "staff_moderator"), categoryId, {
        publishThreshold: 1,
      }),
    ).toMatchObject({ ok: false, error: "not_yours" });
  }, 60_000);
});

describe("dual control", () => {
  it("applies nothing until a second person approves, then applies exactly what was shown", async () => {
    // The audit log is append-only and this database is not reset between
    // runs, so the assertion below is scoped to rows this test wrote.
    const startedAt = new Date();

    const proposed = await proposeRuleChange(
      lead(),
      categoryId,
      { publishThreshold: 41 },
      "Opening this trade for the launch cohort while supply builds.",
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    // Still the live value. The matrix keeps computing on it.
    expect(
      (
        await prisma.category.findUniqueOrThrow({
          where: { id: categoryId },
          select: { publishThreshold: true },
        })
      ).publishThreshold,
    ).toBe(restore.publishThreshold);

    // The person who proposed it cannot approve it.
    expect(await approveRuleChange(lead(), proposed.id, "Approving my own.")).toMatchObject({
      ok: false,
      error: "same_person",
    });

    const approved = await approveRuleChange(
      second(),
      proposed.id,
      "Agreed for the launch cohort; revisit at the end of the quarter.",
    );
    expect(approved.ok).toBe(true);

    const after = await prisma.category.findUniqueOrThrow({
      where: { id: categoryId },
      select: { publishThreshold: true },
    });
    expect(after.publishThreshold).toBe(41);
    expect(thresholdsFor({ ...restore, publishThreshold: 41 }).minListings).toBe(41);

    // Two audit rows, two people, two written reasons.
    const rows = await prisma.auditEvent.findMany({
      where: {
        subject: `Category:${categoryId}`,
        action: { in: ["rule_proposed", "rule_approved"] },
        createdAt: { gte: startedAt },
      },
      orderBy: { createdAt: "asc" },
      select: { action: true, actorId: true, reason: true },
    });
    expect(rows.map((row) => row.action)).toEqual(["rule_proposed", "rule_approved"]);
    expect(new Set(rows.map((row) => row.actorId)).size).toBe(2);
    expect(rows.every((row) => row.reason.trim().length >= 4)).toBe(true);
  }, 120_000);

  it("refuses a second proposal while one is waiting", async () => {
    const first = await proposeRuleChange(lead(), categoryId, { minIntroWords: 300 }, "Longer copy.");
    expect(first.ok).toBe(true);

    expect(
      await proposeRuleChange(lead(), categoryId, { minIntroWords: 320 }, "Longer still."),
    ).toMatchObject({ ok: false, error: "already_pending" });

    if (first.ok) {
      const closed = await closeRuleChange(lead(), first.id, "Withdrawing, wrong trade.");
      expect(closed).toMatchObject({ ok: true, state: "withdrawn" });
    }
  }, 120_000);

  it("lets a proposer withdraw their own, and a second person reject somebody else's", async () => {
    // The second-approver rule is scoped to approval on purpose. A constraint
    // covering every exit from `proposed` would leave a mistyped proposal stuck
    // in the queue until somebody else signed it off.
    const mine = await proposeRuleChange(lead(), categoryId, { minLiveDays: 45 }, "Longer grace.");
    expect(mine.ok).toBe(true);
    if (mine.ok) {
      expect(await closeRuleChange(lead(), mine.id, "Changed my mind.")).toMatchObject({
        ok: true,
        state: "withdrawn",
      });
    }

    const theirs = await proposeRuleChange(lead(), categoryId, { minLiveDays: 60 }, "Longer again.");
    expect(theirs.ok).toBe(true);
    if (theirs.ok) {
      expect(await closeRuleChange(second(), theirs.id, "Sixty days is too long.")).toMatchObject({
        ok: true,
        state: "rejected",
      });
      expect(
        await approveRuleChange(second(), theirs.id, "Trying again after rejecting."),
      ).toMatchObject({ ok: false, error: "not_pending" });
    }
  }, 120_000);

  it("refuses an approval whose rules have moved underneath it", async () => {
    const stale = await proposeRuleChange(
      lead(),
      categoryId,
      { publishThreshold: 55 },
      "Back towards the default.",
    );
    expect(stale.ok).toBe(true);

    // Somebody else's approved change lands first.
    await prisma.category.update({ where: { id: categoryId }, data: { publishThreshold: 44 } });

    if (stale.ok) {
      expect(await approveRuleChange(second(), stale.id, "Approving the stale one.")).toMatchObject({
        ok: false,
        error: "stale",
      });
      await closeRuleChange(lead(), stale.id, "Superseded; proposing again.");
    }
  }, 120_000);

  it("refuses a moderator outright", async () => {
    await expect(
      proposeRuleChange(
        actor(moderatorId, "staff_moderator"),
        categoryId,
        { publishThreshold: 10 },
        "Not mine to change.",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("recorded demand", () => {
  const PREFIX = "demand-test-";
  let areaId: string;

  beforeAll(async () => {
    const area = await prisma.area.create({
      data: { emirate: "dubai", name: `${PREFIX}zone`, slug: `${PREFIX}zone` },
      select: { id: true },
    });
    areaId = area.id;
  });

  afterAll(async () => {
    await prisma.scopeDemand.deleteMany({ where: { areaId } });
    await prisma.areaPage.deleteMany({ where: { areaId } });
    await prisma.area.delete({ where: { id: areaId } });
  });

  it("raises the need, and carries where the figure came from", async () => {
    const before = await areaMatrix({ categoryId, emirate: "dubai", perPage: 5_000 });
    const beforeRow = before.rows.find((row) => row.areaId === areaId);
    expect(beforeRow?.needBasis).toBe("absolute");
    expect(beforeRow?.monthlySearches).toBeNull();

    const saved = await recordScopeDemand({
      actor: lead(),
      categoryId,
      emirate: "dubai",
      areaId,
      monthlySearches: 8_000,
      source: "Keyword export, UAE",
      capturedAt: new Date("2026-08-01T00:00:00.000Z"),
      reason: "Recording third-party volume for the recruitment plan.",
    });
    expect(saved.ok).toBe(true);

    const after = await areaMatrix({ categoryId, emirate: "dubai", perPage: 5_000 });
    const row = after.rows.find((entry) => entry.areaId === areaId);
    // 25 per 1,000 against 8,000 searches, on a category whose absolute floor
    // is below that.
    expect(row?.needBasis).toBe("demand");
    expect(row?.need).toBeGreaterThan(beforeRow?.need ?? 0);
    expect(row?.demandSource).toBe("Keyword export, UAE");
    expect(row?.demandCapturedAt).not.toBeNull();
    expect(row?.status).toBe("recruit");
    expect(row?.shortfall).toBe(row!.need - row!.listings);
  }, 120_000);

  it("refuses a figure with no source, and one outside its bounds", async () => {
    expect(
      await recordScopeDemand({
        actor: lead(),
        categoryId,
        emirate: "dubai",
        areaId,
        monthlySearches: 100,
        source: " ",
        capturedAt: new Date(),
        reason: "No source given.",
      }),
    ).toMatchObject({ ok: false, error: "bad_source" });

    expect(
      await recordScopeDemand({
        actor: lead(),
        categoryId,
        emirate: "dubai",
        areaId,
        monthlySearches: -1,
        source: "Keyword export",
        reason: "Negative searches.",
        capturedAt: new Date(),
      }),
    ).toMatchObject({ ok: false, error: "out_of_range" });
  }, 60_000);

  it("holds a page by hand, and does not publish it again on release", async () => {
    /*
       An intro, because `area_page_published_has_intro` refuses a published row
       without one — the constraint that stops a page going live with an empty
       template. The hold is about a page that is otherwise fine.
    */
    await prisma.areaPage.create({
      data: {
        areaId,
        categoryId,
        intro: Array.from({ length: 60 }, () => "Industrial supply for contractors.").join(" "),
        publishedAt: new Date(),
        firstPublishedAt: new Date(),
      },
    });

    const held = await holdLandingPage({
      actor: lead(),
      areaId,
      categoryId,
      reason: "Legal are looking at a claim in the copy.",
    });
    expect(held.ok).toBe(true);

    const matrix = await areaMatrix({ categoryId, emirate: "dubai", perPage: 5_000 });
    const row = matrix.rows.find((entry) => entry.areaId === areaId);
    expect(row?.status).toBe("held_editorial");
    expect(row?.live).toBe(false);

    expect(
      await holdLandingPage({
        actor: lead(),
        areaId,
        categoryId,
        reason: "Holding it twice.",
      }),
    ).toMatchObject({ ok: false, error: "already_held" });

    const released = await releaseLandingPage({
      actor: lead(),
      areaId,
      categoryId,
      reason: "Legal are content.",
    });
    expect(released.ok).toBe(true);

    // Releasing restores the arithmetic. It does not publish a page that has
    // never cleared its floors.
    const after = await areaMatrix({ categoryId, emirate: "dubai", perPage: 5_000 });
    expect(after.rows.find((entry) => entry.areaId === areaId)?.live).toBe(false);
  }, 120_000);
});

describe("generate drafts", () => {
  it("creates a row for every scope waiting on copy, and never publishes one", async () => {
    const before = await areaMatrix({ perPage: 100_000 });
    const queued = before.rows.filter((row) => row.status === "queued_copy" && row.intro === null);

    const result = await generateDrafts(lead(), undefined, "Assigning this week's writing.");
    if (queued.length === 0) {
      expect(result).toMatchObject({ ok: false, error: "none_queued" });
      return;
    }

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Criterion 9: the count matches the `Queued · copy` row count.
    expect(result.created).toBe(queued.length);

    const created = await prisma.areaPage.findMany({
      where: {
        OR: queued.map((row) => ({ areaId: row.areaId, categoryId: row.categoryId })),
      },
      select: { publishedAt: true, intro: true },
    });
    expect(created.every((row) => row.publishedAt === null)).toBe(true);
    expect(created.every((row) => row.intro === null)).toBe(true);

    await prisma.areaPage.deleteMany({
      where: { OR: queued.map((row) => ({ areaId: row.areaId, categoryId: row.categoryId })) },
    });
  }, 180_000);
});
