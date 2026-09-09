import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { boostListing, liveBoosts, liveBoostReach } from "@/lib/search/boosts";
import { runImpact } from "@/lib/search/impact";
import {
  discardDraft,
  draftState,
  liveBrowseRelevanceMode,
  liveWeights,
  markPreviewRunning,
  publishDraft,
  publishHistory,
  saveDraft,
  storePreview,
  validateWeights,
} from "@/lib/search/settings";
import { DEFAULT_WEIGHTS, MAX_BOOST_POINTS, redistribute } from "@/lib/search/ranking";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 12c, second pass — the four things it actually added.
 *
 * Save split from publish, an impact preview between them, publish refused on a
 * stale or running preview, and a history row per published change. Plus the
 * per-business boost budget, which is the one place the shipped behaviour was
 * knowingly unbounded.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let lead: Actor;
const madeBoosts: string[] = [];
/**
 * The publish rows that were here before this file ran.
 *
 * Cleaning up with `deleteMany({})` took the seed's own row with it, and the
 * board's history tab then read *"Nothing published yet"* on a freshly seeded
 * database — a fixture eaten by a test, which is a defect this project has
 * caught before and which is invisible until somebody opens the screen.
 */
let publishesBefore: string[] = [];

beforeAll(async () => {
  const opsLead = await prisma.user.findFirstOrThrow({
    where: { roles: { has: "staff_ops_lead" } },
    orderBy: { id: "asc" as const },
    select: { id: true },
  });
  lead = actor(opsLead.id, "staff_ops_lead");

  publishesBefore = (await prisma.rankingPublish.findMany({ select: { id: true } })).map(
    (row) => row.id,
  );
});

/**
 * Each test starts from the shipped defaults and its own boosts.
 *
 * The live weights are one row, so a test that published leaves the next one
 * asking for a vector that is already live — which `saveDraft` correctly
 * refuses as `nothing_changed`, and which would have read as a broken publish
 * rather than as a dirty fixture. Same for boosts: the budget is a sum, so a
 * boost left behind is 20 points the next test did not ask for.
 */
beforeEach(async () => {
  await prisma.rankingDraft.deleteMany({});
  if (madeBoosts.length > 0) {
    await prisma.listingBoost.deleteMany({ where: { id: { in: madeBoosts } } });
    madeBoosts.length = 0;
  }
  await prisma.rankingWeights.upsert({
    where: { id: "current" },
    create: { id: "current", ...DEFAULT_WEIGHTS, browseRelevanceMode: "redistribute" },
    update: { ...DEFAULT_WEIGHTS, browseRelevanceMode: "redistribute" },
  });
});

afterAll(async () => {
  await prisma.listingBoost.deleteMany({ where: { id: { in: madeBoosts } } });
  await prisma.rankingDraft.deleteMany({});
  await prisma.rankingPublish.deleteMany({ where: { id: { notIn: publishesBefore } } });
  await prisma.rankingWeights.update({ where: { id: "current" }, data: DEFAULT_WEIGHTS });
  await prisma.$disconnect();
});

/** Save a draft and run its preview, leaving it fresh and publishable. */
async function draftWithPreview(next = redistribute(DEFAULT_WEIGHTS, "responseTime", 24)) {
  const mode = await liveBrowseRelevanceMode();
  const saved = await saveDraft(lead, next, mode, "Leaning on reply time for a fortnight.");
  expect(saved).toMatchObject({ ok: true });

  const [live, liveMode] = await Promise.all([liveWeights(), liveBrowseRelevanceMode()]);
  const preview = await runImpact({ draft: next, draftMode: mode, live, liveMode });
  await storePreview(next, mode, preview);
  return { next, preview };
}

describe("criterion 5 — a draft changes nothing a buyer sees", () => {
  it("saves without moving the live weights", async () => {
    const before = await liveWeights();
    const next = redistribute(DEFAULT_WEIGHTS, "responseTime", 24);

    expect(await saveDraft(lead, next, "redistribute", "Trying reply time higher.")).toMatchObject({
      ok: true,
    });

    // The whole of criterion 5, structurally: the disclosure is derived from
    // the live vector moving, and this did not move it. There is no code path
    // that could tell a seller their ranking changed, because it has not.
    expect(await liveWeights()).toEqual(before);

    const draft = await draftState();
    expect(draft?.weights.responseTime).toBe(24);
    expect(draft?.previewState).toBe("none");
  }, 60_000);

  it("discards without ever having touched the live row", async () => {
    const before = await liveWeights();
    await saveDraft(lead, redistribute(DEFAULT_WEIGHTS, "relevance", 20), "redistribute", "A draft.");
    expect(await discardDraft(lead, "Thought better of it.")).toMatchObject({ ok: true });

    expect(await draftState()).toBeNull();
    expect(await liveWeights()).toEqual(before);
  }, 60_000);
});

describe("criterion 7 — publish is impossible on a stale or running preview", () => {
  it("refuses with no preview at all", async () => {
    await saveDraft(lead, redistribute(DEFAULT_WEIGHTS, "relevance", 30), "redistribute", "A draft.");
    expect(await publishDraft(lead, "Publishing blind.")).toMatchObject({
      ok: false,
      error: "preview_missing",
    });
  }, 60_000);

  it("refuses while one is running", async () => {
    await draftWithPreview();
    await markPreviewRunning();

    expect((await draftState())?.previewState).toBe("running");
    expect(await publishDraft(lead, "Publishing mid-run.")).toMatchObject({
      ok: false,
      error: "preview_running",
    });
  }, 120_000);

  it("goes stale the moment the draft moves past it, and refuses then too", async () => {
    await draftWithPreview();
    expect((await draftState())?.previewState).toBe("fresh");

    // The same draft with one weight moved. Staleness is a comparison, not a
    // timer: a count from a superseded draft is worse than no count, because it
    // is the only thing standing between a staff member and several hundred
    // dashboards.
    await saveDraft(
      lead,
      redistribute(DEFAULT_WEIGHTS, "responseTime", 26),
      await liveBrowseRelevanceMode(),
      "Moving it again after the preview ran.",
    );

    const draft = await draftState();
    expect(draft?.previewState).toBe("stale");
    // A stale preview is not shown as a result either.
    expect(draft?.preview).toBeNull();

    expect(await publishDraft(lead, "Publishing on a superseded count.")).toMatchObject({
      ok: false,
      error: "preview_stale",
    });
  }, 120_000);

  it("goes stale when only the browse mode moves", async () => {
    const { next } = await draftWithPreview();
    const other =
      (await liveBrowseRelevanceMode()) === "redistribute" ? "category_depth" : "redistribute";

    // No weight moved, and several hundred landing pages would reorder. A
    // preview that stayed fresh here would be describing a different platform.
    await saveDraft(lead, next, other, "Changing what relevance means without a query.");
    expect((await draftState())?.previewState).toBe("stale");
  }, 120_000);
});

describe("criterion 4 and 6 — the publish, and what it records", () => {
  it("promotes the draft, writes a history row, and clears the draft", async () => {
    const { next, preview } = await draftWithPreview();

    const published = await publishDraft(lead, "Reply time matters more than text match now.");
    expect(published).toMatchObject({ ok: true });

    expect(await liveWeights()).toEqual(next);
    expect(await draftState()).toBeNull();

    const [latest] = await publishHistory(1);
    expect(latest).toBeDefined();
    expect(latest?.weights).toEqual(next);
    expect(latest?.reason).toContain("Reply time matters more");
    expect(latest?.sellersTold).toBe(preview.sellersTold);
    expect(latest?.author.length).toBeGreaterThan(0);
  }, 120_000);

  it("keeps both publishes when two land on one day", async () => {
    // The spec asked for one row per day. Two publishes in an afternoon are two
    // decisions with two written reasons, and a row keyed by day keeps only the
    // second — which is the thing criterion 4 asks for, lost.
    await draftWithPreview(redistribute(DEFAULT_WEIGHTS, "responseTime", 24));
    await publishDraft(lead, "First move of the day.");

    await draftWithPreview(redistribute(DEFAULT_WEIGHTS, "responseTime", 26));
    await publishDraft(lead, "Second move of the day.");

    const history = await publishHistory(2);
    expect(history).toHaveLength(2);
    expect(history[0]?.reason).toContain("Second move");
    expect(history[1]?.reason).toContain("First move");
    // And the newer row says what moved relative to the older one.
    expect(history[0]?.moved).toBeTruthy();
  }, 180_000);

  it("records the browse mode, so a mode-only publish is not a blank row", async () => {
    const live = await liveWeights();
    const other =
      (await liveBrowseRelevanceMode()) === "redistribute" ? "category_depth" : "redistribute";

    const saved = await saveDraft(lead, live, other, "Changing only what relevance means.");
    expect(saved).toMatchObject({ ok: true });

    const preview = await runImpact({
      draft: live,
      draftMode: other,
      live,
      liveMode: await liveBrowseRelevanceMode(),
    });
    await storePreview(live, other, preview);

    expect(await publishDraft(lead, "Scoring category depth on the landing pages.")).toMatchObject({
      ok: true,
    });
    expect(await liveBrowseRelevanceMode()).toBe(other);

    const [latest] = await publishHistory(1);
    expect(latest?.browseMode).toBe(other);
  }, 120_000);

  it("refuses a publish with nothing behind it", async () => {
    expect(await publishDraft(lead, "Publishing an empty desk.")).toMatchObject({
      ok: false,
      error: "no_draft",
    });
  }, 60_000);
});

/**
 * Criterion 10, on the highest-stakes control on the board.
 *
 * The same defect class as `11c`'s *Send 8 requests* over two ticked buyers.
 * Here the count is the only thing standing between a staff member and several
 * hundred dashboards, so the invariant is asserted rather than eyeballed.
 */
describe("the impact preview", () => {
  it("never claims more sellers than the listings it is scoped to", async () => {
    const { preview } = await draftWithPreview(
      redistribute(DEFAULT_WEIGHTS, "verificationTier", 40),
    );

    // sellersTold ≤ sellersInScope ≤ scopedListings, and the button states the
    // first. The spec put the category's whole membership on the button; the
    // shipped attribution tells nobody whose position did not change, so the
    // number on the control is the movers and the label says "up to".
    expect(preview.sellersTold).toBeLessThanOrEqual(preview.sellersInScope);
    expect(preview.sellersInScope).toBeLessThanOrEqual(preview.scopedListings);
    expect(preview.sellersTold).toBe(preview.listingsMoved);
    // And every row's moving count is inside its own scope.
    for (const row of preview.rows) {
      expect(row.moving).toBeGreaterThan(0);
      expect(row.moving).toBeLessThanOrEqual(row.total);
    }
  }, 120_000);

  it("lists no category where nothing moves", async () => {
    const { preview } = await draftWithPreview(
      redistribute(DEFAULT_WEIGHTS, "verificationTier", 40),
    );
    expect(preview.rows.every((row) => row.moving > 0)).toBe(true);
    expect(preview.categoriesMoved).toBe(new Set(preview.rows.map((r) => r.categoryId)).size);
  }, 120_000);

  it("finds nothing to report when the draft is the live vector in another shape", async () => {
    // A draft that reorders nothing produces no rows, and the board says so
    // rather than padding the table out to look like an impact.
    const live = await liveWeights();
    const preview = await runImpact({
      draft: live,
      draftMode: await liveBrowseRelevanceMode(),
      live,
      liveMode: await liveBrowseRelevanceMode(),
    });
    expect(preview.rows).toHaveLength(0);
    expect(preview.listingsMoved).toBe(0);
    expect(preview.sellersTold).toBe(0);
  }, 120_000);
});

/**
 * `B9`, through the service rather than through the arithmetic.
 */
describe("the plan ceiling on the effective browse vector", () => {
  it("refuses a relevance move that lifts plan past the cap on landing pages", () => {
    const vector = {
      relevance: 50,
      verificationTier: 22,
      responseTime: 12,
      specCompleteness: 6,
      distance: 4,
      planTier: 6,
    };
    expect(validateWeights(vector, "redistribute")).toMatchObject({
      ok: false,
      error: "browse_plan_tier_too_high",
    });
    expect(validateWeights(vector, "category_depth")).toMatchObject({ ok: true });
  });
});

/**
 * Q7, answered: 25 points per business, counting the category boosts it falls
 * under. `liveBoosts` used to sum with no ceiling, so five stacked maximum
 * boosts was +125 against weights that total 100 — not a nudge but a
 * replacement of the ranking.
 */
describe("the boost budget", () => {
  it("refuses a second boost that would take one business past the cap", async () => {
    const business = await prisma.business.findFirstOrThrow({
      where: { publishedAt: { not: null } },
      select: { id: true },
    });

    const first = await boostListing({
      actor: lead,
      businessId: business.id,
      points: 20,
      reason: "Covering a bad reply-time figure while their phones were down.",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    });
    expect(first.ok).toBe(true);
    if (first.ok) madeBoosts.push(first.id);

    const second = await boostListing({
      actor: lead,
      businessId: business.id,
      points: 10,
      reason: "And a second one on top.",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    });
    expect(second).toMatchObject({ ok: false, error: "budget_exceeded" });
    if (!second.ok) {
      // The refusal names what is spending the budget, so an ops lead can see
      // how much is actually left rather than guessing.
      expect(second.breach?.held).toBe(20);
      expect(second.breach?.spentOn.length).toBeGreaterThan(0);
      expect(second.message).toContain("20");
    }
  }, 120_000);

  it("counts a category boost against every member business", async () => {
    const business = await prisma.business.findFirstOrThrow({
      where: { publishedAt: { not: null } },
      select: { id: true, primaryCategoryId: true },
    });

    const onCategory = await boostListing({
      actor: lead,
      categoryId: business.primaryCategoryId,
      points: 20,
      reason: "Thin supply in this trade — surfacing the few we have.",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    });
    expect(onCategory.ok).toBe(true);
    if (onCategory.ok) madeBoosts.push(onCategory.id);

    // It reaches the member, and the member's own budget is spent by it.
    const reach = await liveBoostReach();
    expect(reach.get(business.id)?.some((entry) => entry.points === 20)).toBe(true);
    expect((await liveBoosts()).get(business.id)).toBeGreaterThanOrEqual(20);

    // So a listing boost on top is refused — otherwise the cap is bypassed by
    // aiming at the category instead of the listing.
    const onListing = await boostListing({
      actor: lead,
      businessId: business.id,
      points: 10,
      reason: "And a listing boost on top of the category one.",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    });
    expect(onListing).toMatchObject({ ok: false, error: "budget_exceeded" });
  }, 120_000);

  it("refuses a boost that names both a listing and a category, and one that names neither", async () => {
    const business = await prisma.business.findFirstOrThrow({
      select: { id: true, primaryCategoryId: true },
    });

    expect(
      await boostListing({
        actor: lead,
        businessId: business.id,
        categoryId: business.primaryCategoryId,
        points: 5,
        reason: "One points value cannot mean two things.",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).toMatchObject({ ok: false, error: "two_targets" });

    expect(
      await boostListing({
        actor: lead,
        points: 5,
        reason: "A boost that boosts nothing.",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).toMatchObject({ ok: false, error: "no_target" });
  }, 60_000);

  it("refuses the pair the database also refuses", async () => {
    const business = await prisma.business.findFirstOrThrow({
      select: { id: true, primaryCategoryId: true },
    });

    // Prisma permits both foreign keys; the check constraint does not, and it
    // is the only thing standing between a regeneration and a boost that lifts
    // one supplier and every supplier in a category at once.
    await expect(
      prisma.listingBoost.create({
        data: {
          businessId: business.id,
          categoryId: business.primaryCategoryId,
          points: 5,
          reason: "Both at once, straight at the database.",
          expiresAt: new Date(Date.now() + 86_400_000),
          createdById: lead.id,
        },
      }),
    ).rejects.toThrow(/listing_boost_one_target/);
  }, 60_000);

  it("caps a single boost at the same number as the budget", () => {
    // One number to remember and one refusal to write.
    expect(MAX_BOOST_POINTS).toBe(25);
  });
});
