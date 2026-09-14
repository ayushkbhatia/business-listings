import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor, Role } from "@/lib/auth/roles";
import { ACCOUNT_STATES } from "@/lib/accounts/health";
import { stateWhere } from "@/lib/accounts/health-where";
import { accountRows, accountSummary, accountWhere, readAccountPage } from "@/lib/accounts/list";
import { accountDetail } from "@/lib/accounts/detail";
import { deleteSegment, listSegments, saveSegment } from "@/lib/accounts/segments";
import { recordCapRefused } from "@/lib/accounts/cap-events";
import { measureResponseTimes } from "@/lib/metrics/job";

/**
 * Board 4f against a real database — acceptance criteria 1, 2, 4, 5, 6, 7, 8.
 *
 * The seed's three health fixtures (`prisma/seed-account-health.mts`) give the
 * warning states a row each. Everything else here reads the seeded directory as
 * it is and asserts the rules hold across all of it, rather than on a row picked
 * to pass.
 */

const NOW = new Date();
const PREFIX = `acct4f-${process.pid}-`;
const madeUsers: string[] = [];
const madeSegments: string[] = [];

let opsLead: Actor;
let moderator: Actor;

async function staff(role: Role): Promise<Actor> {
  const user = await prisma.user.create({
    data: { id: randomUUID(), email: `${PREFIX}${role}-${madeUsers.length}@businesslistings.me`, roles: [role] },
    select: { id: true },
  });
  madeUsers.push(user.id);
  return { id: user.id, roles: [role] };
}

beforeAll(async () => {
  opsLead = await staff("staff_ops_lead");
  moderator = await staff("staff_moderator");
  // The job, not the seed's copy of it: the rates this suite reads are the ones
  // production would write.
  await measureResponseTimes(NOW);
});

afterAll(async () => {
  if (madeSegments.length > 0) await prisma.accountSegment.deleteMany({ where: { id: { in: madeSegments } } });
  await prisma.accountSegment.deleteMany({ where: { createdById: { in: madeUsers } } });
  await prisma.productEvent.deleteMany({ where: { actorId: { in: madeUsers } } });
  await prisma.user.deleteMany({ where: { id: { in: madeUsers } } });
});

describe("criteria 1 and 4 — one definition, read two ways", () => {
  it("classifies every business the way its state's query finds it", async () => {
    const found = new Map<string, string>();
    for (const state of ACCOUNT_STATES) {
      const rows = await prisma.business.findMany({ where: stateWhere(state, NOW), select: { id: true } });
      for (const row of rows) {
        expect(found.has(row.id), `${row.id} matched both ${found.get(row.id)} and ${state}`).toBe(false);
        found.set(row.id, state);
      }
    }

    const all: string[] = [];
    for await (const batch of accountRows({}, NOW, 200)) {
      for (const row of batch) {
        all.push(row.id);
        expect(row.state, row.displayName).toBe(found.get(row.id));
      }
    }
    // The states partition the directory: every listing is in exactly one.
    expect(found.size).toBe(await prisma.business.count());
    expect(all.length).toBe(found.size);
  });

  it("gives the chip, the panel and the filtered list one number", async () => {
    const summary = await accountSummary(NOW);
    const filtered = await readAccountPage({ health: "churn_risk" }, 1, NOW);
    expect(filtered.total).toBe(summary.churnRisk);
    const upgrades = await readAccountPage({ health: "upgrade_candidate" }, 1, NOW);
    expect(upgrades.total).toBe(summary.upgradeCandidates);
  });

  it("finds the seeded fixtures in the states the board draws them in", async () => {
    const bySlug = async (slug: string) => {
      const business = await prisma.business.findUniqueOrThrow({ where: { slug }, select: { id: true } });
      return (await accountDetail(business.id, NOW))!.row;
    };
    const technopump = await bySlug("technopump-trading-llc");
    expect(technopump.state).toBe("churn_risk");
    expect(technopump.replyRate).toBe(0.333333);
    expect(technopump.replySample).toBe(12);

    expect((await bySlug("dana-printing-signage")).state).toBe("slow_replies");

    const steel = await bySlug("sharjah-steel-fabricators");
    expect(steel.state).toBe("upgrade_candidate");
    // B6: the candidacy carries the dated event it is about.
    expect(steel.upgradeSignal).toMatchObject({ kind: "product_cap" });
  });
});

describe("criterion 2 and B2 — unclaimed has no plan, and paying is not 'has a plan'", () => {
  it("renders no plan and no tier for an unclaimed listing", async () => {
    const page = await readAccountPage({ health: "unclaimed" }, 1, NOW);
    expect(page.rows.length).toBeGreaterThan(0);
    for (const row of page.rows) {
      expect(row.planId).toBeNull();
      expect(row.tier).toBeNull();
    }
  });

  it("counts paying from the subscription, excluding Free and trials", async () => {
    const summary = await accountSummary(NOW);
    const expected = await prisma.subscription.count({
      where: { status: { in: ["active", "past_due"] }, plan: { monthlyPriceAed: { gt: 0 } } },
    });
    expect(summary.paying).toBe(expected);
    expect(summary.paying).toBeLessThanOrEqual(summary.claimed);
  });

  it("filters plan=none to listings with no plan, never to Free", async () => {
    const page = await readAccountPage({ plan: "none" }, 1, NOW);
    for (const row of page.rows) expect(row.planId).toBeNull();
    const free = await readAccountPage({ plan: "free" }, 1, NOW);
    for (const row of free.rows) expect(row.planId).toBe("free");
  });
});

describe("criterion 3 — no tier above two", () => {
  it("holds across the directory", async () => {
    expect(await prisma.business.count({ where: { verificationTier: { gt: 2 } } })).toBe(0);
  });
});

describe("criterion 7 — search by name, licence number and TRN", () => {
  it("finds a business by each identifier", async () => {
    const target = await prisma.business.findFirstOrThrow({
      where: { trn: { not: null }, claimStatus: "claimed" },
      orderBy: { id: "asc" },
      select: { id: true, displayName: true, licenceNumber: true, trn: true },
    });
    const digits = target.licenceNumber.replace(/\D/g, "");
    const authority = target.licenceNumber.split("-")[0]!;

    for (const q of [target.displayName.slice(0, 8), target.licenceNumber, `${authority.toLowerCase()} ${digits}`, digits, target.trn!]) {
      const ids: string[] = [];
      for await (const batch of accountRows({ q }, NOW)) ids.push(...batch.map((row) => row.id));
      expect(ids, q).toContain(target.id);
    }
  });

  it("matches nothing for a query that could be none of the three", async () => {
    const page = await readAccountPage({ q: "?" }, 1, NOW);
    expect(page.total).toBe(0);
  });
});

describe("criterion 6 — upgrade candidacy is a dated event", () => {
  it("records a refusal the list then reads", async () => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: "technopump-trading-llc" },
      select: { id: true },
    });
    const actor = await staff("buyer");
    await recordCapRefused({
      kind: "services",
      businessId: business.id,
      actorId: actor.id,
      plan: "Basic",
      cap: 15,
      attempted: 2,
      surface: "new_service",
    });
    const detail = await accountDetail(business.id, new Date());
    expect(detail?.capEvents[0]).toMatchObject({ kind: "services", cap: 15, attempted: 2, surface: "new_service" });
    // Churn risk still outranks it: the call about 33% replies comes first.
    expect(detail?.row.state).toBe("churn_risk");
  });
});

describe("criterion 8 — segments are saved queries", () => {
  it("stores the canonical query, re-runs it for its count, and refuses an empty one", async () => {
    const saved = await saveSegment(opsLead, { name: `${PREFIX}at risk`, query: "sort=reply_rate&health=churn_risk&junk=1" });
    expect(saved).toMatchObject({ ok: true, query: "health=churn_risk&sort=reply_rate" });
    if (saved.ok) madeSegments.push(saved.id);

    const summary = await accountSummary(NOW);
    const listed = (await listSegments(moderator, NOW)).find((segment) => segment.name === `${PREFIX}at risk`);
    expect(listed?.count).toBe(summary.churnRisk);
    expect(listed?.mayDelete).toBe(false);

    expect(await saveSegment(opsLead, { name: `${PREFIX}everything`, query: "sort=reply_rate" })).toEqual({
      ok: false,
      error: "empty_filter",
    });
    expect(await saveSegment(moderator, { name: `${PREFIX}at risk`, query: "health=churn_risk" })).toEqual({
      ok: false,
      error: "name_taken",
    });
  });

  it("lets the author or an ops lead delete, and nobody else", async () => {
    const saved = await saveSegment(moderator, { name: `${PREFIX}mine`, query: "plan=basic" });
    if (!saved.ok) throw new Error("setup");
    const other = await staff("staff_finance");
    expect(await deleteSegment(other, saved.id)).toEqual({ ok: false, error: "not_yours" });
    expect(await deleteSegment(opsLead, saved.id)).toMatchObject({ ok: true });
  });
});

describe("the where a filter builds is the where the page counts", () => {
  it("counts what it pages", async () => {
    const filter = { plan: "pro" } as const;
    const page = await readAccountPage(filter, 1, NOW);
    expect(page.total).toBe(await prisma.business.count({ where: accountWhere(filter, NOW) }));
    expect(page.rows.length).toBe(Math.min(page.total, page.pageSize));
  });
});
