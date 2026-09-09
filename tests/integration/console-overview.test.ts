import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { consoleOverview } from "@/lib/console/overview";
import { TOP_ACHIEVABLE_TIER, VERIFIED_TIER } from "@/lib/verification";

/**
 * Board 4a's numbers, and the one that could never be non-zero.
 *
 * The console's whole claim is that it answers one question each morning —
 * which of the six jobs is behind — and every number on it links into the queue
 * that fixes it. A metric that is structurally zero does not read as broken. It
 * reads as "nothing to do here", which is the most expensive way for a number
 * to be wrong.
 *
 * `expiring` queried `verificationTier: { gte: 3 }` against a ladder that ends
 * at 2: `VerificationTier` is `0 | 1 | 2`, `TOP_ACHIEVABLE_TIER` is
 * `VERIFIED_TIER`, and the database CHECK is `BETWEEN 0 AND 2`. No row could
 * match, so the trust panel showed 0 for every day it shipped and no supplier
 * whose licence was about to lapse ever surfaced on it.
 *
 * `consoleOverview` had no test of any kind before this file.
 */

const PREFIX = "console-overview-test-";
let categoryId: string;
const made: string[] = [];

function metric(jobs: Awaited<ReturnType<typeof consoleOverview>>, job: string, key: string) {
  const found = jobs.find((j) => j.key === job)?.metrics.find((m) => m.key === key);
  if (!found) throw new Error(`no ${job}/${key} metric on the console`);
  return found;
}

async function makeSupplier(tier: number, licenceExpiry: Date): Promise<string> {
  const mark = `${Date.now().toString(36)}${made.length}`;
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-C${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry,
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: new Date(),
      verificationTier: tier,
      verifiedAt: new Date(),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;
});

afterAll(async () => {
  for (const id of made.splice(0)) {
    await prisma.business.deleteMany({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("the trust panel counts a licence that is actually about to lapse", () => {
  it("has a ladder the metric can reach", () => {
    // The premise, stated so a future change to the ladder fails here rather
    // than silently emptying the panel again.
    expect(TOP_ACHIEVABLE_TIER).toBe(VERIFIED_TIER);
    expect(VERIFIED_TIER).toBe(2);
  });

  it("counts a verified supplier whose licence expires inside the window", async () => {
    const now = new Date();
    const before = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;

    await makeSupplier(VERIFIED_TIER, new Date(now.getTime() + 10 * 86_400_000));

    const after = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;
    expect(after).toBe(before + 1);
  }, 60_000);

  it("leaves out a licence that runs past the window", async () => {
    const now = new Date();
    const before = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;

    await makeSupplier(VERIFIED_TIER, new Date(now.getTime() + 200 * 86_400_000));

    const after = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;
    expect(after).toBe(before);
  }, 60_000);

  it("leaves out a claimed supplier who was never verified", async () => {
    // Tier 1 is claimed, not checked. Its licence lapsing costs it nothing,
    // because it has no badge resting on the licence to lose.
    const now = new Date();
    const before = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;

    await makeSupplier(1, new Date(now.getTime() + 5 * 86_400_000));

    const after = metric(await consoleOverview(now), "trust", "expiring").count ?? 0;
    expect(after).toBe(before);
  }, 60_000);
});
