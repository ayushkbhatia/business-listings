import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { coveragePageFor, coveringFirmsByEmirate, replySampleFor } from "@/lib/storefront/services";
import { WINDOW_DAYS } from "@/lib/metrics/response-time";

/**
 * Board `1f-s` — the public coverage page, against a database.
 *
 * What a unit test cannot reach: that each row resolves to its own service's
 * coverage and not the firm's (B1), that free zones come back as registrations
 * and stay out of the places (B4), that the reply sample is the same
 * observations the nightly median is measured over (B3), and that the fan-out
 * count resolves effective coverage in SQL the way `effectiveCoverage` does in
 * TypeScript (B6).
 */

const PREFIX = "cov-1fs-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const businesses: string[] = [];
let categoryId: string;
let otherCategoryId: string;
let freeZone: { id: string; emirate: string; name: string };
let buyerId: string;

async function makeFirm(fields: { published?: boolean; claimed?: boolean; verified?: boolean } = {}) {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-F${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: fields.claimed === false ? "unclaimed" : "claimed",
      sellsKind: "services",
      // `1h-s` B5: the offer counts only firms the brief it opens would route to.
      verificationTier: fields.verified === false ? 0 : 2,
      publishedAt: fields.published === false ? null : new Date(),
    },
    select: { id: true },
  });
  businesses.push(firm.id);
  return firm.id;
}

async function makeService(businessId: string, slug: string, position: number, category = categoryId, status: "live" | "draft" = "live") {
  return (
    await prisma.service.create({
      data: { businessId, categoryId: category, name: slug, slug, status, position, deliveredWhere: "remote" },
      select: { id: true },
    })
  ).id;
}

beforeAll(async () => {
  const categories = await prisma.category.findMany({
    where: { parentId: { not: null } },
    orderBy: { id: "asc" },
    take: 2,
    select: { id: true },
  });
  categoryId = categories[0]!.id;
  otherCategoryId = categories[1]!.id;
  const zone = await prisma.area.findFirstOrThrow({
    where: { isFreeZone: true },
    select: { id: true, emirate: true, name: true },
  });
  freeZone = zone;
  buyerId = randomUUID();
  await prisma.user.create({ data: { id: buyerId, roles: ["buyer"] } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.user.deleteMany({ where: { id: buyerId } });
});

describe("coveragePageFor — B1, B4", () => {
  it("resolves each live service to its own coverage, else the default, and keeps free zones apart", async () => {
    const firm = await makeFirm();
    const vat = await makeService(firm, "vat", 0);
    const audit = await makeService(firm, "audit", 1);
    await makeService(firm, "draft", 2, categoryId, "draft");

    await prisma.serviceCoverage.createMany({
      data: [
        { businessId: firm, emirate: "dubai", areaId: null },
        { businessId: firm, emirate: "sharjah", areaId: null },
        // The audit narrows itself to Dubai alone.
        { businessId: firm, serviceId: audit, emirate: "dubai", areaId: null },
      ],
    });
    await prisma.freeZoneRegistration.create({ data: { businessId: firm, areaId: freeZone.id } });

    const data = await coveragePageFor(firm);
    expect(data.rows.map((row) => [row.service.slug, row.places.map((p) => p.emirate)])).toEqual([
      ["vat", ["dubai", "sharjah"]],
      ["audit", ["dubai"]],
    ]);
    expect(data.rows.some((row) => row.service.id === vat)).toBe(true);
    expect(data.freeZones).toEqual([{ emirate: freeZone.emirate, name: freeZone.name }]);
    // A registration is never a place on any row.
    expect(data.rows.flatMap((row) => row.places.map((p) => p.areaId))).not.toContain(freeZone.id);
  });
});

describe("replySampleFor — B3", () => {
  it("counts first replies delivered inside the window, and nothing else", async () => {
    const firm = await makeFirm();
    const day = 86_400_000;
    const make = async (deliveredDaysAgo: number, repliedAfterMs: number | null) => {
      const delivered = new Date(Date.now() - deliveredDaysAgo * day);
      await prisma.enquiry.create({
        data: {
          ref: `ENQ-${PREFIX}${stamp()}`,
          buyerId,
          requirement: `${PREFIX}reply`,
          closesAt: new Date(Date.now() + 7 * day),
          recipients: {
            create: {
              businessId: firm,
              createdAt: delivered,
              firstReplyAt: repliedAfterMs === null ? null : new Date(delivered.getTime() + repliedAfterMs),
            },
          },
        },
      });
    };
    await make(1, 3_600_000);
    await make(2, 7_200_000);
    await make(3, null); // not answered — not a reply
    await make(WINDOW_DAYS + 4, 60_000); // outside the window

    expect(await replySampleFor(firm)).toBe(2);
  });
});

describe("coveringFirmsByEmirate — B6", () => {
  it("counts other public firms whose same service effectively reaches each emirate", async () => {
    const self = await makeFirm();
    await makeService(self, "vat", 0);
    await prisma.serviceCoverage.create({ data: { businessId: self, emirate: "ajman", areaId: null } });

    // Inherits its default: Ajman and Dubai.
    const a = await makeFirm();
    await makeService(a, "vat", 0);
    await prisma.serviceCoverage.createMany({
      data: [
        { businessId: a, emirate: "ajman", areaId: null },
        { businessId: a, emirate: "dubai", areaId: null },
      ],
    });

    // Default says Ajman, but its service narrows to Fujairah — so not Ajman.
    const b = await makeFirm();
    const bVat = await makeService(b, "vat", 0);
    await prisma.serviceCoverage.createMany({
      data: [
        { businessId: b, emirate: "ajman", areaId: null },
        { businessId: b, serviceId: bVat, emirate: "fujairah", areaId: null },
      ],
    });

    const beforeExcluded = await coveringFirmsByEmirate(categoryId, self);

    // Not counted: unpublished, unclaimed, unverified, a draft service, another subcategory.
    for (const [firm, status, category] of [
      [await makeFirm({ published: false }), "live", categoryId],
      [await makeFirm({ claimed: false }), "live", categoryId],
      [await makeFirm({ verified: false }), "live", categoryId],
      [await makeFirm(), "draft", categoryId],
      [await makeFirm(), "live", otherCategoryId],
    ] as const) {
      await makeService(firm, "vat", 0, category, status);
      await prisma.serviceCoverage.create({ data: { businessId: firm, emirate: "ajman", areaId: null } });
    }

    // None of those five moved the count.
    const counts = await coveringFirmsByEmirate(categoryId, self);
    expect(counts.get("ajman") ?? 0).toBe(beforeExcluded.get("ajman") ?? 0);

    // The seed may hold firms of its own in this subcategory, so a and b are
    // measured by the difference their live services make.
    await prisma.service.updateMany({ where: { businessId: { in: [a, b] } }, data: { status: "draft" } });
    const without = await coveringFirmsByEmirate(categoryId, self);

    // a inherits Ajman; b narrowed away from it to Fujairah.
    expect((counts.get("ajman") ?? 0) - (without.get("ajman") ?? 0)).toBe(1);
    expect((counts.get("fujairah") ?? 0) - (without.get("fujairah") ?? 0)).toBe(1);
    expect((counts.get("dubai") ?? 0) - (without.get("dubai") ?? 0)).toBe(1);

    // The firm asking is never in its own count: with a and b drafted, asking as
    // self leaves self out, and asking as anyone else puts self's Ajman back in.
    const asOther = await coveringFirmsByEmirate(categoryId, a);
    expect((asOther.get("ajman") ?? 0) - (without.get("ajman") ?? 0)).toBe(1);
  });
});
