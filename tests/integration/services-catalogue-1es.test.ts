import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { publicServicesFor } from "@/lib/services/service";
import { serviceEnquiryVolume } from "@/lib/storefront/services";
import { ENQUIRY_VOLUME_DAYS, mostEnquired, sortByVolume } from "@/lib/storefront/services-catalogue";

/**
 * Board `1e-s` — the enquiry volume the services list sorts by, against a
 * database.
 *
 * What a unit test cannot reach: that the figure counts enquiries this firm
 * actually received and nobody else's, that it counts distinct enquiries, that
 * the window is a window, and that the public payload the list renders from
 * carries the raw keys its filters need and no completeness or fee.
 */

const PREFIX = "sc-1es-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const businesses: string[] = [];
let categoryId: string;
let buyerId: string;

async function makeFirm() {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-E${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: new Date(),
    },
    select: { id: true },
  });
  businesses.push(firm.id);
  const make = (slug: string, position: number) =>
    prisma.service.create({
      data: {
        businessId: firm.id,
        categoryId,
        name: slug,
        slug,
        status: "live",
        position,
        publishedAt: new Date(),
        engagementType: "one_off_job",
        indicativeFee: "AED 9,999",
      },
      select: { id: true },
    });
  const [audit, vat, books] = await Promise.all([make("audit", 2), make("vat", 0), make("books", 1)]);
  return { id: firm.id, audit: audit.id, vat: vat.id, books: books.id };
}

/** An enquiry naming `serviceIds`, delivered to `recipient`, created `daysAgo`. */
async function enquiry(recipient: string, serviceIds: string[], daysAgo = 1) {
  const created = await prisma.enquiry.create({
    data: {
      ref: `ENQ-${PREFIX}${stamp()}`,
      buyerId,
      requirement: `${PREFIX}volume`,
      closesAt: new Date(Date.now() + 7 * 86_400_000),
      createdAt: new Date(Date.now() - daysAgo * 86_400_000),
      lines: {
        create: serviceIds.map((serviceId, i) => ({ description: "x", qty: null, serviceId, sortOrder: i })),
      },
      recipients: { create: { businessId: recipient } },
    },
    select: { id: true },
  });
  return created.id;
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { parentId: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  categoryId = category.id;
  buyerId = randomUUID();
  await prisma.user.create({ data: { id: buyerId, roles: ["buyer"] } });
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.user.deleteMany({ where: { id: buyerId } });
});

describe("serviceEnquiryVolume — B5", () => {
  it("counts distinct enquiries this firm received, inside the window", async () => {
    const firm = await makeFirm();
    const other = await makeFirm();

    await enquiry(firm.id, [firm.audit]);
    await enquiry(firm.id, [firm.audit]);
    // One enquiry naming the same service twice is one enquiry.
    await enquiry(firm.id, [firm.audit, firm.audit]);
    await enquiry(firm.id, [firm.vat]);
    // Outside the window.
    await enquiry(firm.id, [firm.vat], ENQUIRY_VOLUME_DAYS + 5);
    // Names this firm's service but was delivered to someone else.
    await enquiry(other.id, [firm.books]);

    const volume = await serviceEnquiryVolume(firm.id, [firm.audit, firm.vat, firm.books]);
    expect(Object.fromEntries(volume)).toEqual({ [firm.audit]: 3, [firm.vat]: 1 });
  });

  it("sorts the public list by it, breaks ties with the seller's order, and awards the leader", async () => {
    const firm = await makeFirm();
    await enquiry(firm.id, [firm.books]);
    await enquiry(firm.id, [firm.books]);

    const services = await publicServicesFor(firm.id);
    const volume = await serviceEnquiryVolume(firm.id, services.map((s) => s.id));
    const rows = services.map((s) => ({ ...s, feeBasisLabel: null }));

    expect(sortByVolume(rows, volume).map((s) => s.slug)).toEqual(["books", "vat", "audit"]);
    expect(mostEnquired(rows, volume)).toEqual({ id: firm.books, enquiries: 2 });
  });

  it("answers nothing for no ids, without a query", async () => {
    expect((await serviceEnquiryVolume("anything", [])).size).toBe(0);
  });
});

describe("the public payload the list renders from", () => {
  it("carries the raw keys the filters need, and no fee or completeness", async () => {
    const firm = await makeFirm();
    const [first] = await publicServicesFor(firm.id);
    expect(first).toMatchObject({ engagementType: "one_off_job", feeBasis: null, position: 0 });
    expect(JSON.stringify(await publicServicesFor(firm.id))).not.toContain("9,999");
  });
});
