import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { measureResponseTimes } from "@/lib/metrics/job";
import { MIN_SAMPLE, band, medianResponseMs, windowStart } from "@/lib/metrics/response-time";

/**
 * Acceptance criterion 5:
 *
 *   "Median response time is computed from real timestamps and renders on the
 *    public storefront built in handoff 1. No writable path to it exists for a
 *    seller."
 *
 * The rendering half is a browser test. This is the other three: that the
 * number comes from timestamps the services stamped, that running the job
 * twice does not move it, and that nothing outside the job can write it.
 */

afterAll(async () => {
  await prisma.$disconnect();
});

describe("computed from real timestamps", () => {
  it("matches what the raw recipient rows say, business by business", async () => {
    const now = new Date();
    const since = windowStart(now);

    const businesses = await prisma.business.findMany({
      where: { claimStatus: "claimed", suspendedAt: null },
      select: { id: true, slug: true, responseTimeMedianMs: true },
    });
    expect(businesses.length).toBeGreaterThan(0);

    for (const business of businesses) {
      const rows = await prisma.enquiryRecipient.findMany({
        where: { businessId: business.id, createdAt: { gte: since } },
        select: { createdAt: true, firstReplyAt: true },
      });
      const expected = medianResponseMs(
        rows.map((r) => ({ deliveredAt: r.createdAt, firstReplyAt: r.firstReplyAt })),
      );
      expect(business.responseTimeMedianMs, business.slug).toBe(expected);
    }
  });

  it("says nothing rather than guessing below the sample floor", async () => {
    const since = windowStart(new Date());
    const unmeasured = await prisma.business.findMany({
      // Suspended is excluded: the job does not measure a business whose
      // storefront is not public, which is a different reason for a null.
      where: { claimStatus: "claimed", suspendedAt: null, responseTimeMedianMs: null },
      select: { id: true, slug: true },
    });

    for (const business of unmeasured) {
      const answered = await prisma.enquiryRecipient.count({
        where: { businessId: business.id, createdAt: { gte: since }, firstReplyAt: { not: null } },
      });
      // Null is a real answer, and the UI has a state for it.
      expect(answered, business.slug).toBeLessThan(MIN_SAMPLE);
    }
  });

  it("does not measure a suspended business at all", async () => {
    // Its storefront is not public, so a number on it would be a number
    // nobody can see attached to a listing nobody can reach.
    const suspended = await prisma.business.findMany({
      where: { claimStatus: "claimed", suspendedAt: { not: null } },
      select: { slug: true, responseTimeMedianMs: true },
    });
    for (const business of suspended) {
      expect(business.responseTimeMedianMs, business.slug).toBeNull();
    }
  });

  it("shows every band, so the seed proves the range rather than one colour", async () => {
    const businesses = await prisma.business.findMany({
      where: { claimStatus: "claimed" },
      select: { responseTimeMedianMs: true },
    });
    const bands = new Set(businesses.map((b) => band(b.responseTimeMedianMs)));
    expect([...bands].sort()).toEqual(["fast", "moderate", "slow", "unmeasured"]);
  });
});

describe("the job", () => {
  it("is idempotent — running it twice changes nothing", async () => {
    const before = await snapshot();
    const first = await measureResponseTimes();
    const afterFirst = await snapshot();
    const second = await measureResponseTimes();
    const afterSecond = await snapshot();

    expect(afterFirst).toEqual(before);
    expect(afterSecond).toEqual(afterFirst);
    expect(second.updated).toBe(0);
    expect(second.cleared).toBe(0);
    expect(first.businessesConsidered).toBeGreaterThan(0);
  });

  it("clears a supplier who stops appearing in the window", async () => {
    // Without this a supplier who stopped trading keeps last quarter's number
    // on their storefront for ever.
    const measured = await prisma.business.findFirstOrThrow({
      where: { claimStatus: "claimed", responseTimeMedianMs: { not: null } },
      select: { id: true, responseTimeMedianMs: true },
    });

    const rows = await prisma.enquiryRecipient.findMany({
      where: { businessId: measured.id },
      select: { enquiryId: true, createdAt: true },
    });
    const ancient = new Date(Date.now() - 400 * 86_400_000);
    for (const row of rows) {
      await prisma.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: row.enquiryId, businessId: measured.id } },
        data: { createdAt: ancient },
      });
    }

    await measureResponseTimes();
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: measured.id },
      select: { responseTimeMedianMs: true },
    });
    expect(after.responseTimeMedianMs).toBeNull();

    // Put it back, so the suite leaves the database as it found it.
    for (const row of rows) {
      await prisma.enquiryRecipient.update({
        where: { enquiryId_businessId: { enquiryId: row.enquiryId, businessId: measured.id } },
        data: { createdAt: row.createdAt },
      });
    }
    await measureResponseTimes();
  });

  it("stamps when it ran, so a stale number is visible as stale", async () => {
    const business = await prisma.business.findFirstOrThrow({
      where: { responseTimeMedianMs: { not: null } },
      select: { derivedAt: true },
    });
    expect(business.derivedAt).not.toBeNull();
  });
});

describe("no writable path exists for a seller", () => {
  /** Every file a seller's requests can reach. */
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.isFile() && /\.(ts|tsx)$/.test(path) ? [path] : [];
    });
  }

  it("only the job writes the column", () => {
    /*
     * A file is a writer if it both mentions the column and performs a Prisma
     * write against `business`. Grepping for the name alone flagged a type
     * declaration in the search ranking and a fixture in its test, neither of
     * which can write anything.
     */
    const WRITES = /\.business\.(update|updateMany|create|createMany|upsert)\b|\bupdate\s+"business"/;
    const offenders: string[] = [];

    for (const file of [...walk("app"), ...walk("lib")]) {
      if (file.includes("lib/metrics/")) continue; // the job is the one writer
      // Prisma's generated client describes every write; it performs none.
      if (file.includes("lib/db/generated/")) continue;
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue;
      const source = readFileSync(file, "utf8");
      if (!source.includes("responseTimeMedianMs")) continue;
      if (WRITES.test(source)) offenders.push(file);
    }

    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no seller-facing form posts a field named for it", () => {
    const offenders: string[] = [];
    for (const file of walk("app")) {
      const source = readFileSync(file, "utf8");
      if (/name=["']responseTime/i.test(source)) offenders.push(file);
      if (/formData\.get\(["']responseTime/i.test(source)) offenders.push(file);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the seed derives it too, rather than inventing one", () => {
    // A seed that claims a reply time has already broken the criterion, and it
    // is the version a reviewer looks at.
    const seed = readFileSync("prisma/seed.mts", "utf8");
    expect(seed).toContain("deriveResponseTimes");
    // No literal assignment at business creation.
    expect(seed).not.toMatch(/responseTimeMedianMs:\s*claimed\s*\?/);
  });
});

async function snapshot() {
  const rows = await prisma.business.findMany({
    where: { claimStatus: "claimed" },
    select: { id: true, responseTimeMedianMs: true },
    orderBy: { id: "asc" },
  });
  return rows.map((r) => `${r.id}:${r.responseTimeMedianMs ?? "null"}`);
}
