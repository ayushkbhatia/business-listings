import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as daily } from "@/app/api/jobs/daily/route";
import { prisma } from "@/lib/db/client";
import { sweepExpiredLicences } from "@/lib/verification/expiry-job";
import { setVerificationTier } from "@/lib/verification/service";
import type { Actor, Role } from "@/lib/auth/roles";
import {
  EXPIRED_LICENCE_TIER,
  VERIFIED_TIER,
  isVerified,
  licenceExpired,
} from "@/lib/verification";

/**
 * The rule `Business.verificationTier` has carried in its doc comment since
 * handoff 1 and nothing performed: the tier drops the day the licence expires,
 * no grace period.
 *
 * Board 1d found the badge outliving the licence and gated it at render. That
 * fixed one page. `verificationTier` is also read by search ranking (weight
 * 22), by every publish floor in `lib/seo/`, by the sitemap and by the admin
 * matrix — none of which render a storefront. This is the stored value.
 *
 * The interesting assertions here are the negatives: a job that dropped
 * everything would pass a test that only checked the lapsed row.
 */

const PREFIX = "licence-expiry-test-";
let categoryId: string;
let seq = 0;

function stamp() {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

/** Fixed, so "expired" and "valid" are relative to one instant, not to wall time. */
const NOW = new Date("2026-06-15T08:00:00.000Z");
const DAY = 86_400_000;

async function addBusiness(fields: {
  expiry: Date;
  tier: number;
  suspendedAt?: Date | null;
}) {
  const id = stamp();
  const slug = `${PREFIX}${id}`;
  await prisma.business.create({
    data: {
      tradeName: `Licence Expiry Test ${id}`,
      displayName: `Licence Expiry Test ${id}`,
      slug,
      licenceNumber: `DED-LE${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: fields.expiry,
      primaryCategoryId: categoryId,
      claimStatus: "unclaimed",
      publishedAt: new Date(),
      verificationTier: fields.tier,
      verifiedAt: fields.tier > 0 ? new Date("2025-01-10T00:00:00.000Z") : null,
      suspendedAt: fields.suspendedAt ?? null,
    },
  });
  return slug;
}

async function tierOf(slug: string) {
  const row = await prisma.business.findUniqueOrThrow({
    where: { slug },
    select: { verificationTier: true, verifiedAt: true },
  });
  return row;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  await removeFixtures();
  const category = await prisma.category.create({
    data: {
      slug: `${PREFIX}pumps`,
      code: "LEXP",
      name: "Licence expiry test trade",
    },
  });
  categoryId = category.id;
});

afterAll(async () => {
  await removeFixtures();
});

describe("the drop lands where the ladder stays true", () => {
  it("takes an expired top tier down to 1, not to 2", async () => {
    /*
       The whole reason this file exists. The schema said "drops to 2" and 2 is
       `VERIFIED_TIER` — the badge threshold — while tier 2's own published
       requirement is "we check the licence with the issuing authority and
       confirm it is current". An expired licence falsifies exactly that.
    */
    const slug = await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 3 });

    await sweepExpiredLicences(NOW);

    const row = await tierOf(slug);
    expect(row.verificationTier).toBe(EXPIRED_LICENCE_TIER);
    expect(row.verificationTier).toBe(1);
    expect(row.verificationTier).toBeLessThan(VERIFIED_TIER);
    expect(isVerified(row.verificationTier)).toBe(false);
  });

  it("drops every tier above the floor to the same floor", async () => {
    const three = await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 3 });
    const two = await addBusiness({ expiry: new Date(NOW.getTime() - 400 * DAY), tier: 2 });

    await sweepExpiredLicences(NOW);

    expect((await tierOf(three)).verificationTier).toBe(1);
    expect((await tierOf(two)).verificationTier).toBe(1);
  });

  it("leaves verifiedAt alone", async () => {
    /*
       Those columns say something happened on a date, and it did. Blanking them
       would erase the history that tells an ops lead what to re-check when the
       supplier comes back with a renewal.
    */
    const slug = await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 3 });

    await sweepExpiredLicences(NOW);

    const row = await tierOf(slug);
    expect(row.verifiedAt).toEqual(new Date("2025-01-10T00:00:00.000Z"));
  });
});

describe("what it must not touch", () => {
  it("leaves a licence expiring tomorrow at its tier", async () => {
    const slug = await addBusiness({ expiry: new Date(NOW.getTime() + DAY), tier: 3 });

    await sweepExpiredLicences(NOW);

    expect((await tierOf(slug)).verificationTier).toBe(3);
  });

  it("has no grace period — expired by a second is expired", async () => {
    /*
       The schema is explicit that there is none. A day of slack here would be a
       day of the platform displaying a claim it cannot support, and it would be
       invisible: every test using whole days would still pass.
    */
    const slug = await addBusiness({ expiry: new Date(NOW.getTime() - 1000), tier: 3 });

    await sweepExpiredLicences(NOW);

    expect((await tierOf(slug)).verificationTier).toBe(1);
  });

  it("never raises a tier", async () => {
    /*
       Re-verifying after a renewal is a decision with an actor and an audit row.
       A job that could promote would be a job that re-verified a business
       nobody re-checked.
    */
    const zero = await addBusiness({ expiry: new Date(NOW.getTime() + 300 * DAY), tier: 0 });
    const expiredZero = await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 0 });

    await sweepExpiredLicences(NOW);

    expect((await tierOf(zero)).verificationTier).toBe(0);
    expect((await tierOf(expiredZero)).verificationTier).toBe(0);
  });

  it("skips a suspended business", async () => {
    /*
       A suspension is already the stronger state and carries its own audit row
       with a written reason. Rewriting its tier underneath staff would change a
       row they are mid-decision on, and would do it with no actor to attribute.
    */
    const slug = await addBusiness({
      expiry: new Date(NOW.getTime() - DAY),
      tier: 3,
      suspendedAt: new Date("2026-05-01T00:00:00.000Z"),
    });

    await sweepExpiredLicences(NOW);

    expect((await tierOf(slug)).verificationTier).toBe(3);
  });
});

describe("the report it returns", () => {
  it("counts only what it changed and names each one", async () => {
    const lapsed = await addBusiness({ expiry: new Date(NOW.getTime() - 2 * DAY), tier: 3 });
    await addBusiness({ expiry: new Date(NOW.getTime() + DAY), tier: 3 });
    // Already at the floor: expired, but with nothing left to drop.
    await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 1 });

    const result = await sweepExpiredLicences(NOW);

    const mine = result.dropped.filter((row) => row.slug.startsWith(PREFIX));
    expect(mine.map((row) => row.slug)).toEqual([lapsed]);
    expect(mine[0]?.from).toBe(3);
    expect(mine[0]?.expiredOn).toEqual(new Date(NOW.getTime() - 2 * DAY));
  });

  it("is idempotent — a second run in the same day changes nothing", async () => {
    await addBusiness({ expiry: new Date(NOW.getTime() - DAY), tier: 3 });

    await sweepExpiredLicences(NOW);
    const second = await sweepExpiredLicences(NOW);

    expect(second.dropped.filter((row) => row.slug.startsWith(PREFIX))).toEqual([]);
  });
});

describe("the render and the job agree on what expired means", () => {
  it("shares one predicate, so the badge and the tier cannot disagree", () => {
    /*
       Board 1d gates the badge at render because the job runs once a day and a
       licence expiring at midnight is expired for every render until the cron
       catches up. Two definitions of "expired" is how one of them drifts.
    */
    expect(licenceExpired(new Date(NOW.getTime() - 1), NOW)).toBe(true);
    expect(licenceExpired(new Date(NOW.getTime() + 1), NOW)).toBe(false);
    // Exactly at the boundary is not yet expired: the licence is valid until it is not.
    expect(licenceExpired(NOW, NOW)).toBe(false);
  });
});

describe("the daily run actually performs it", () => {
  /*
     The bug being fixed was a rule with no caller. A sweep that exists in a lib
     module and is never reached from a cron is the same bug wearing a test
     suite, so this goes through the route.
  */
  const SECRET = "licence-expiry-test-cron-secret";
  let original: string | undefined;

  it("drops a lapsed listing through GET /api/jobs/daily", async () => {
    const slug = await addBusiness({ expiry: new Date(Date.now() - DAY), tier: 3 });

    original = process.env["CRON_SECRET"];
    process.env["CRON_SECRET"] = SECRET;
    try {
      const response = await daily(
        new NextRequest("https://businesslistings.me/api/jobs/daily", {
          headers: { authorization: `Bearer ${SECRET}` },
        }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        steps: Record<string, { ok: boolean; result?: { expired: number } }>;
      };
      expect(body.steps["expiredLicences"]?.ok).toBe(true);
      expect(body.steps["expiredLicences"]?.result?.expired).toBeGreaterThan(0);
    } finally {
      if (original === undefined) delete process.env["CRON_SECRET"];
      else process.env["CRON_SECRET"] = original;
    }

    expect((await tierOf(slug)).verificationTier).toBe(1);
  }, 30_000);

  it("runs before the area sweep, whose publish floors read the tier", async () => {
    /*
       `sweepAreaPages` counts verified suppliers with
       `verificationTier >= VERIFIED_TIER` to decide whether an area page clears
       its floor. Ordered the other way, the floors are computed from tiers this
       step is about to invalidate, and an area page stays open for a day on a
       supplier whose licence lapsed last night. Asserted on the key order the
       route hands to `runSteps`, because that is what fixes the sequence.
    */
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("app/api/jobs/daily/route.ts", "utf8"),
    );
    expect(source.indexOf("expiredLicences:")).toBeGreaterThan(-1);
    expect(source.indexOf("expiredLicences:")).toBeLessThan(source.indexOf("areaPages:"));
  });
});

describe("staff cannot raise a tier the sweep would take back", () => {
  /*
     Two writers to one column. Without a floor both know about, an ops lead
     sets the top tier on a lapsed licence, the nightly sweep undoes it before
     morning, and the console shows a tier that keeps reverting with nothing on
     screen saying why. This is the other half of the fix, not a bonus.
  */
  const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });
  const REASON = "Checked the trade licence against the DED register.";
  let opsLeadId: string;

  beforeAll(async () => {
    const lead = await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      // One of two seeded ops leads, and always the same one: board 6f
      // needs a second for dual control, and `findFirst` has no defined
      // order without this.
      orderBy: { id: "asc" as const },
      select: { id: true },
    });
    opsLeadId = lead.id;
  });

  it("refuses a raise while the licence is lapsed, and names the fix", async () => {
    const slug = await addBusiness({ expiry: new Date(Date.now() - 30 * DAY), tier: 0 });
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug },
      select: { id: true },
    });

    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      tier: 2,
      reason: REASON,
    });

    expect(result).toMatchObject({ ok: false, error: "licence_expired" });
    if (result.ok) return;
    // The date, so a staff member can see which licence, and the ceiling.
    expect(result.message).toMatch(/expired on \d{4}-\d{2}-\d{2}/);
    expect(result.message).toMatch(/renewed licence is recorded/i);
    // Refused, never silently clamped to the ceiling.
    expect((await tierOf(slug)).verificationTier).toBe(0);
  });

  it("still allows the floor itself — 1 is a licence number on file", async () => {
    const slug = await addBusiness({ expiry: new Date(Date.now() - 30 * DAY), tier: 0 });
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug },
      select: { id: true },
    });

    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      tier: EXPIRED_LICENCE_TIER,
      reason: REASON,
    });

    expect(result.ok).toBe(true);
    expect((await tierOf(slug)).verificationTier).toBe(EXPIRED_LICENCE_TIER);
  });

  it("allows the raise once the licence is current again", async () => {
    /*
       The refusal has to be a state, not a mark on the record. A renewal is a
       new expiry date, and the moment it is in the tier is available again —
       otherwise the guard becomes a supplier who can never be re-verified.
    */
    const slug = await addBusiness({ expiry: new Date(Date.now() - 30 * DAY), tier: 0 });
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug },
      select: { id: true },
    });

    await prisma.business.update({
      where: { id: business.id },
      data: { licenceExpiry: new Date(Date.now() + 365 * DAY) },
    });

    const result = await setVerificationTier({
      actor: actor(opsLeadId, "staff_ops_lead"),
      businessId: business.id,
      tier: 2,
      reason: REASON,
    });

    expect(result.ok).toBe(true);
    expect(isVerified((await tierOf(slug)).verificationTier)).toBe(true);
  });
});
