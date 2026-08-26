import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { searchBusinesses } from "@/lib/db/queries";
import { boostList, boostListing, liveWeights, setWeights, MAX_BOOST_DAYS } from "@/lib/search/settings";
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

const query = { q: "", page: 1 } as Parameters<typeof searchBusinesses>[0];

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
