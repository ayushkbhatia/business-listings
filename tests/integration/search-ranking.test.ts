import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { searchBusinesses } from "@/lib/db/queries";
import {
  boostList,
  boostListing,
  liveBrowseRelevanceMode,
  liveWeights,
  setWeights,
  MAX_BOOST_DAYS,
} from "@/lib/search/settings";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Criterion 5: *"weights reorder live results; a boost needs reason and
 * expiry."*
 *
 * The first half could not be true before board 12c. `searchBusinesses` has
 * always taken a `weights` option and no caller ever passed one, so the
 * constant in `ranking.ts` was the entire configuration and nothing staff could
 * do reordered anything.
 */

const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let opsLeadId: string;
let financeId: string;
const madeBoosts: string[] = [];

beforeAll(async () => {
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    })
  ).id;
  financeId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_finance" } },
      select: { id: true },
    })
  ).id;
});

afterAll(async () => {
  await prisma.listingBoost.deleteMany({ where: { id: { in: madeBoosts } } });
  // And back to the numbers the migration seeded, whatever the tests did.
  await prisma.rankingWeights.update({ where: { id: "current" }, data: DEFAULT_WEIGHTS });
  await prisma.$disconnect();
});

/*
   No `sort`, on purpose. The cast is what lets that compile, and for one
   release it hid a real defect: `orderFor` fell through to its `default` branch
   on an absent sort and returned the newest-first order, so nothing below could
   ever have reordered anything. The tests here are the ones that caught it, and
   this stays uncast-and-incomplete so they keep catching it.
*/
/*
   Deliberately not a whole `SearchQuery`.

   The cast is the subject: these tests are about what a caller that *omits* a
   field gets, and `sort` is required on the type, so a valid object could not
   ask the question. Every field left out here is one a real caller has left out.

   It does mean `businessWhere` meets a query missing fields the type promises,
   which is how a spec-facet branch reading `query.spec` came to throw on the
   busiest public route in the product. That is guarded there with `?? {}`
   rather than papered over here — the search page must narrow nothing rather
   than 500 when a caller is incomplete.
*/
const query = { q: "", page: 1 } as Parameters<typeof searchBusinesses>[0];

describe("an absent sort is the ranking, never a different order", () => {
  it("orders a query with no sort exactly as sort=best does", async () => {
    /*
     * The guard on the bug this file found. "Newest first" is not a milder
     * ranking, it is the absence of one: every weight, every boost and the
     * sponsored slot stop reaching the page at all. A caller that omits the
     * field means the ranking, because there is nothing else it could mean.
     */
    const [absent, best] = await Promise.all([
      searchBusinesses(query),
      searchBusinesses({ ...query, sort: "best" }),
    ]);

    expect(absent.rows.length).toBeGreaterThan(1);
    expect(absent.rows.map((row) => row.id)).toEqual(best.rows.map((row) => row.id));
  }, 60_000);

  it("still lets an explicit single-signal sort take over", async () => {
    // The other half: closing the fallback must not close the feature.
    const byReply = await searchBusinesses({ ...query, sort: "reply" });
    const claimed = byReply.rows.filter((row) => row.claimStatus === "claimed");

    // Unclaimed listings sink whatever the signal says — criterion 7 — so the
    // ordering assertion belongs inside the claimed group.
    const replies = claimed.map((row) => row.responseTimeMedianMs ?? Number.MAX_SAFE_INTEGER);
    expect(replies).toEqual([...replies].sort((a, b) => a - b));
  }, 60_000);
});

describe("criterion 5 — weights reorder live results", () => {
  it("reads the stored weights, not the constant", async () => {
    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { ...DEFAULT_WEIGHTS, verificationTier: 40 },
      "Leaning harder on verification while the directory is young.",
    );

    const stored = await liveWeights();
    expect(stored.verificationTier).toBe(40);
    expect(stored).not.toEqual(DEFAULT_WEIGHTS);
  }, 60_000);

  it("changes the order of a real search when the weights change", async () => {
    /*
     * The criterion, run against the query the public site uses. Two weight
     * sets that disagree about what matters should not produce the same page.
     */
    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { relevance: 10, verificationTier: 90, responseTime: 0, specCompleteness: 0, distance: 0, planTier: 0 },
      "Verification above everything, to see the order move.",
    );
    const byTier = await searchBusinesses(query);

    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { relevance: 10, verificationTier: 0, responseTime: 90, specCompleteness: 0, distance: 0, planTier: 0 },
      "Reply speed above everything, to see the order move back.",
    );
    const bySpeed = await searchBusinesses(query);

    expect(byTier.rows.length).toBeGreaterThan(1);
    const first = byTier.rows.map((row) => row.id);
    const second = bySpeed.rows.map((row) => row.id);
    expect(first).not.toEqual(second);
  }, 120_000);

  /**
   * Board 6a acceptance 8, and the reason the browse mode exists.
   *
   *   *"Ranking reads the shared config; the relevance-mode decision is
   *    recorded in that config, and setting a weight to 0 measurably reorders
   *    this page in a test."*
   *
   * A landing page has no query, so the largest of the six weights has nothing
   * to score against. Before the mode it multiplied zero: staff moved a
   * 34-point slider and the highest-traffic template in the product did not
   * change. This is that being false.
   */
  it("a page with no query reorders when a weight moves", async () => {
    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { relevance: 34, verificationTier: 60, responseTime: 0, specCompleteness: 0, distance: 0, planTier: 0 },
      "Verification above everything on the landing pages.",
      "redistribute",
    );
    const byTier = await searchBusinesses(query, { browse: true });

    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { relevance: 34, verificationTier: 0, responseTime: 60, specCompleteness: 0, distance: 0, planTier: 0 },
      "Reply speed above everything on the landing pages.",
      "redistribute",
    );
    const bySpeed = await searchBusinesses(query, { browse: true });

    expect(byTier.rows.length).toBeGreaterThan(1);
    expect(byTier.rows.map((row) => row.id)).not.toEqual(bySpeed.rows.map((row) => row.id));
  }, 120_000);

  it("records the browse mode on the same audited row as the weights", async () => {
    const lead = actor(opsLeadId, "staff_ops_lead");
    expect(
      await setWeights(lead, await liveWeights(), "Switching how relevance is read.", "category_depth"),
    ).toMatchObject({ ok: true });
    expect(await liveBrowseRelevanceMode()).toBe("category_depth");

    // Not a third answer. Leaving the weight to multiply zero is not one of the
    // two, and neither is anything somebody types into the column by hand.
    expect(
      await setWeights(lead, await liveWeights(), "Trying a mode that does not exist.", "whatever"),
    ).toMatchObject({ ok: false, error: "unknown_browse_mode" });

    /*
       An omitted mode leaves the stored one alone rather than resetting it —
       every existing caller of `setWeights` passes none, and a silent reset to
       the default on each weight change would undo a staff decision nobody
       would think to look for.
    */
    await setWeights(
      lead,
      { ...(await liveWeights()), specCompleteness: 11 },
      "Moving a weight without touching the mode.",
    );
    expect(await liveBrowseRelevanceMode()).toBe("category_depth");

    await setWeights(lead, await liveWeights(), "Back to the recommendation.", "redistribute");
  }, 120_000);

  it("refuses a set that would rank everything equally", async () => {
    const result = await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { relevance: 0, verificationTier: 0, responseTime: 0, specCompleteness: 0, distance: 0, planTier: 0 },
      "Trying to zero everything.",
    );
    expect(result).toMatchObject({ ok: false, error: "all_zero" });
  }, 60_000);

  it("caps what money can buy, in the database as well as the service", async () => {
    /*
     * A directory that sells its way to the top is one nobody comes back to,
     * and the subscription only holds if being found is worth paying for.
     */
    const refused = await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      { ...DEFAULT_WEIGHTS, planTier: 40 },
      "Trying to make the plan the main signal.",
    );
    expect(refused).toMatchObject({ ok: false, error: "plan_tier_too_high" });

    await expect(
      prisma.rankingWeights.update({ where: { id: "current" }, data: { planTier: 40 } }),
    ).rejects.toThrow(/plan_tier_is_capped/);
  }, 60_000);

  it("refuses a moderator and finance — ranking is ops", async () => {
    await expect(
      setWeights(
        actor(financeId, "staff_finance"),
        { ...DEFAULT_WEIGHTS, relevance: 30 },
        "Not my row.",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
  }, 60_000);
});

describe("criterion 5 — a boost needs a reason and an expiry", () => {
  it("writes one, and the reason is on the row rather than only in the audit log", async () => {
    const business = await prisma.business.findFirstOrThrow({
      where: { publishedAt: { not: null } },
      select: { id: true },
    });

    const result = await boostListing({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      points: 8,
      reason: "Covering for a bad response-time figure while their phones were down.",
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    madeBoosts.push(result.id);

    const row = await prisma.listingBoost.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.reason).toContain("phones were down");
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
  }, 60_000);

  it("refuses a blank reason at the database, whatever a caller does", async () => {
    const business = await prisma.business.findFirstOrThrow({ select: { id: true } });
    await expect(
      prisma.listingBoost.create({
        data: {
          businessId: business.id,
          points: 5,
          reason: "  ",
          expiresAt: new Date(Date.now() + 86_400_000),
          createdById: opsLeadId,
        },
      }),
    ).rejects.toThrow(/reason_is_written/);
  }, 60_000);

  it("refuses an expiry in the past and one too far out", async () => {
    const business = await prisma.business.findFirstOrThrow({ select: { id: true } });

    const past = await boostListing({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      points: 5,
      reason: "A boost that never applies.",
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    expect(past).toMatchObject({ ok: false, error: "expiry_in_the_past" });

    const far = await boostListing({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      points: 5,
      reason: "A boost that outlives the reason for it.",
      expiresAt: new Date(Date.now() + (MAX_BOOST_DAYS + 30) * 86_400_000),
    });
    expect(far).toMatchObject({ ok: false, error: "expiry_too_far" });
  }, 60_000);

  it("refuses a boost big enough to replace the ranking", async () => {
    const business = await prisma.business.findFirstOrThrow({ select: { id: true } });
    const result = await boostListing({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      points: 500,
      reason: "Trying to put one listing on top of everything.",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    expect(result).toMatchObject({ ok: false, error: "points_out_of_range" });
  }, 60_000);

  it("lifts a listing in a real search while it is live, and stops when it expires", async () => {
    await setWeights(
      actor(opsLeadId, "staff_ops_lead"),
      DEFAULT_WEIGHTS,
      "Back to the defaults for the boost test.",
    );

    const before = await searchBusinesses(query);
    expect(before.rows.length).toBeGreaterThan(2);

    // Something that is not already first.
    const target = before.rows.at(-1)!;

    const boosted = await boostListing({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: target.id,
      points: 25,
      reason: "Manually lifting this listing while we sort their category out.",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    if (!boosted.ok) throw new Error("fixture failed");
    madeBoosts.push(boosted.id);

    const after = await searchBusinesses(query);
    const wasAt = before.rows.findIndex((row) => row.id === target.id);
    const nowAt = after.rows.findIndex((row) => row.id === target.id);
    expect(nowAt).toBeLessThan(wasAt);

    // Expire it, and the order goes back.
    await prisma.listingBoost.update({
      where: { id: boosted.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await searchBusinesses(query);
    expect(expired.rows.findIndex((row) => row.id === target.id)).toBe(wasAt);
  }, 120_000);

  it("keeps expired boosts visible, because they explain the history", async () => {
    const list = await boostList();
    expect(list.some((entry) => entry.expired)).toBe(true);
    for (const entry of list) expect(entry.reason.length).toBeGreaterThan(4);
  }, 60_000);
});
