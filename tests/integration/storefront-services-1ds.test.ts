import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { publicCoverageFor, publicServiceCoverage, servicesStorefrontFor } from "@/lib/storefront/services";
import {
  confirmEnquiryAttachment,
  sendServiceEnquiry,
  type SendServiceEnquiryInput,
  type StorageDeps,
} from "@/lib/enquiry/service-enquiry-server";
import { saveServiceProfile } from "@/lib/onboarding/profile";
import { getLeadDetail } from "@/lib/db/queries/seller";
import { getBuyerEnquiry } from "@/lib/db/queries/enquiry";

/**
 * Board `1d-s` — the storefront of a firm that sells work, against a database.
 *
 * What a unit test cannot reach: that the loader's payload holds no fee at all
 * (B5), that coverage is the union helper's answer (B7), that credentials come
 * back verified-first, that a service enquiry lands as one line carrying its
 * service and never another firm's, that the attachment row is only written for
 * the buyer and only for a file storage actually holds, and that a removed
 * sector takes its declared count with it.
 *
 * Storage is faked — this project has Postgres and no Storage — through the
 * seam `sendServiceEnquiry` and `confirmEnquiryAttachment` take for exactly
 * that reason.
 */

const PREFIX = "sf-1ds-";
let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

const businesses: string[] = [];
const users: string[] = [];
let categoryId: string;
let buyerId: string;

async function makeFirm(fields: { sellsKind?: "services" | "both" | "goods" } = {}) {
  const mark = stamp();
  const firm = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-S${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      sellsKind: fields.sellsKind ?? "services",
      publishedAt: new Date(),
      verificationTier: 2,
      verifiedAt: new Date(),
      sectorsServed: ["Construction & contracting", "Trading", "Real estate"],
      deliveryModes: ["remote", "at_our_office"],
    },
    select: { id: true, slug: true },
  });
  businesses.push(firm.id);

  const live = await prisma.service.create({
    data: {
      businessId: firm.id,
      categoryId,
      name: "Statutory audit",
      slug: "statutory-audit",
      status: "live",
      position: 0,
      publishedAt: new Date(),
      engagementType: "ongoing_contract",
      turnaround: "3–4 weeks",
      deliverable: "Signed report and management letter",
      indicativeFee: "From AED 14,000",
    },
    select: { id: true },
  });
  const second = await prisma.service.create({
    data: {
      businessId: firm.id,
      categoryId,
      name: "Corporate tax registration",
      slug: "corporate-tax-registration",
      status: "live",
      position: 1,
      publishedAt: new Date(),
      indicativeFee: "AED 2,500",
    },
    select: { id: true },
  });
  await prisma.service.create({
    data: {
      businessId: firm.id,
      categoryId,
      name: "Transfer pricing",
      slug: "transfer-pricing",
      status: "draft",
      position: 2,
      indicativeFee: "AED 40,000",
    },
  });

  await prisma.credential.createMany({
    data: [
      { businessId: firm.id, kind: "indemnity_insurance", issuer: "AXA", identifier: "AED 5m" },
      {
        businessId: firm.id,
        kind: "fta_tax_agent",
        identifier: "30014982",
        trust: "register_verified",
        verifiedOn: new Date(),
        verifiedBy: "FTA tax agent register",
      },
      { businessId: firm.id, kind: "professional_body", issuer: "ACCA" },
    ],
  });

  await prisma.serviceCoverage.createMany({
    data: [
      { businessId: firm.id, emirate: "sharjah", areaId: null },
      { businessId: firm.id, emirate: "dubai", areaId: null },
    ],
  });

  await prisma.sectorEngagement.createMany({
    data: [
      { businessId: firm.id, sectorSlug: "construction & contracting", engagements: 41 },
      { businessId: firm.id, sectorSlug: "trading", engagements: 28 },
    ],
  });

  return { ...firm, liveId: live.id, secondId: second.id };
}

const input = (businessId: string, over: Partial<SendServiceEnquiryInput> = {}): SendServiceEnquiryInput => ({
  businessId,
  service: "statutory-audit",
  requirement: `${PREFIX} FY2025 audit for a contracting company, three projects.`,
  scale: "AED 20–50m turnover",
  neededBy: "",
  attachment: null,
  contactPhone: "",
  contactName: "",
  ...over,
});

function fakeStorage(stored: { bytes: number; mimeType: string | null } | null = null) {
  const calls = { signed: [] as string[], removed: [] as string[] };
  const deps: StorageDeps = {
    sign: async (_bucket, path) => {
      calls.signed.push(path);
      return { path, token: "token", url: `https://storage.test/${path}` };
    },
    stat: async () => stored,
    remove: async (_bucket, path) => {
      calls.removed.push(path);
    },
  };
  return { deps, calls };
}

beforeAll(async () => {
  const category = await prisma.category.findFirstOrThrow({
    where: { parentId: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  categoryId = category.id;

  buyerId = randomUUID();
  await prisma.user.create({
    data: { id: buyerId, phone: `+97150${Date.now().toString().slice(-7)}`, roles: ["buyer"] },
  });
  users.push(buyerId);
});

afterAll(async () => {
  await prisma.enquiry.deleteMany({ where: { requirement: { startsWith: PREFIX } } });
  await prisma.business.deleteMany({ where: { id: { in: businesses } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
});

describe("servicesStorefrontFor — what the page reads", () => {
  it("carries no fee anywhere in its payload — B5", async () => {
    const firm = await makeFirm();
    const data = await servicesStorefrontFor(firm.id);
    const payload = JSON.stringify(data);

    expect(payload).not.toContain("14,000");
    expect(payload).not.toContain("2,500");
    expect(payload).not.toMatch(/indicativeFee/i);
  });

  it("lists live services only, in the firm's order", async () => {
    const firm = await makeFirm();
    const data = await servicesStorefrontFor(firm.id);
    expect(data.services.map((service) => service.slug)).toEqual([
      "statutory-audit",
      "corporate-tax-registration",
    ]);
    expect(data.services[0]!.familyId).toBeTruthy();
  });

  it("puts the register-verified credential first — trust, then kind", async () => {
    const firm = await makeFirm();
    const { credentials } = await servicesStorefrontFor(firm.id);
    expect(credentials.map((row) => [row.kind, row.verified])).toEqual([
      ["fta_tax_agent", true],
      ["professional_body", false],
      ["indemnity_insurance", false],
    ]);
    expect(JSON.stringify(credentials)).not.toMatch(/documentId|storagePath/);
  });

  it("declares sector counts beside their chips and leaves undeclared ones null — B8", async () => {
    const firm = await makeFirm();
    const { sectors } = await servicesStorefrontFor(firm.id);
    expect(sectors).toEqual([
      { label: "Construction & contracting", engagements: 41 },
      { label: "Trading", engagements: 28 },
      { label: "Real estate", engagements: null },
    ]);
  });

  it("words coverage as the union of published services' effective coverage — B7", async () => {
    const firm = await makeFirm();
    const both = [firm.liveId, firm.secondId];
    // Neither service narrows: both inherit the default, and the union is it.
    expect((await publicCoverageFor(firm.id, both)).map((place) => place.label)).toEqual([
      "Dubai",
      "Sharjah",
    ]);

    // One service narrows to Abu Dhabi. The other still inherits, so the union
    // is the default plus the narrowing — never the narrowing shrinking the listing.
    await prisma.serviceCoverage.create({
      data: { businessId: firm.id, serviceId: firm.liveId, emirate: "abu_dhabi", areaId: null },
    });
    expect((await publicCoverageFor(firm.id, both)).map((place) => place.label)).toEqual([
      "Abu Dhabi",
      "Dubai",
      "Sharjah",
    ]);
    // And the narrowed service's own page says only where it goes.
    expect((await publicServiceCoverage(firm.id, firm.liveId)).map((place) => place.label)).toEqual([
      "Abu Dhabi",
    ]);
    expect((await publicServiceCoverage(firm.id, firm.secondId)).map((place) => place.label)).toEqual([
      "Dubai",
      "Sharjah",
    ]);
    // A firm with nothing live shows its default.
    expect((await publicCoverageFor(firm.id, [])).map((place) => place.label)).toEqual(["Dubai", "Sharjah"]);
  });
});

describe("sendServiceEnquiry — a situation, not a quantity", () => {
  it("writes one line carrying the service, the scale, and this firm alone", async () => {
    const firm = await makeFirm();
    const { deps } = fakeStorage();
    const result = await sendServiceEnquiry(input(firm.id), { buyerId }, deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const enquiry = await prisma.enquiry.findUniqueOrThrow({
      where: { id: result.enquiryId },
      select: {
        scale: true,
        lines: { select: { description: true, qty: true, serviceId: true } },
        recipients: { select: { businessId: true } },
      },
    });
    expect(enquiry.scale).toBe("AED 20–50m turnover");
    // Unquantified: work sold as a job carries no invented unit (pull request 173's column).
    expect(enquiry.lines).toEqual([{ description: "Statutory audit", qty: null, serviceId: firm.liveId }]);
    expect(enquiry.recipients).toEqual([{ businessId: firm.id }]);
    expect(result.upload).toBeNull();
    expect(result.next).toBe(`/enquiry/${result.enquiryId}?sent=1`);
  });

  it("names a not-listed enquiry from what the buyer wrote, with no service", async () => {
    const firm = await makeFirm();
    const result = await sendServiceEnquiry(
      input(firm.id, { service: "", requirement: `${PREFIX} Group consolidation. Two subsidiaries.` }),
      { buyerId },
      fakeStorage().deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: result.enquiryId } });
    expect(line.serviceId).toBeNull();
    expect(line.description).toBe(`${PREFIX} Group consolidation.`);
  });

  it("refuses a draft service rather than guessing, and writes nothing", async () => {
    const firm = await makeFirm();
    const before = await prisma.enquiry.count({ where: { requirement: { startsWith: PREFIX } } });
    const result = await sendServiceEnquiry(
      input(firm.id, { service: "transfer-pricing" }),
      { buyerId },
      fakeStorage().deps,
    );
    expect(result).toEqual({ ok: false, refusals: [{ field: "service", reason: "not_offered" }] });
    expect(await prisma.enquiry.count({ where: { requirement: { startsWith: PREFIX } } })).toBe(before);
  });

  it("has no composer for a goods seller", async () => {
    const firm = await makeFirm({ sellsKind: "goods" });
    const result = await sendServiceEnquiry(input(firm.id), { buyerId }, fakeStorage().deps);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("signs the file under the enquiry it now belongs to, after the enquiry exists", async () => {
    const firm = await makeFirm();
    const { deps, calls } = fakeStorage();
    const result = await sendServiceEnquiry(
      input(firm.id, { attachment: { filename: "Trial balance.pdf", type: "application/pdf", bytes: 20_000 } }),
      { buyerId },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.signed).toHaveLength(1);
    expect(calls.signed[0]).toMatch(new RegExp(`^enquiries/${result.enquiryId}/trial-balance-`));
    expect(result.upload?.path).toBe(calls.signed[0]);
  });

  it("still delivers the enquiry when the file cannot be signed, and says so in the link", async () => {
    const firm = await makeFirm();
    const deps: StorageDeps = {
      ...fakeStorage().deps,
      sign: async () => {
        throw new Error("storage down");
      },
    };
    const result = await sendServiceEnquiry(
      input(firm.id, { attachment: { filename: "tb.pdf", type: "application/pdf", bytes: 100 } }),
      { buyerId },
      deps,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uploadUnavailable).toBe(true);
    expect(result.next).toContain("attachment=failed");
  });

  it("never records another firm's service as the subject", async () => {
    const firm = await makeFirm();
    const other = await makeFirm();
    const { createEnquiry } = await import("@/lib/enquiry/service");
    const result = await createEnquiry({
      buyerId,
      requirement: `${PREFIX} forged subject`,
      lines: [{ description: "Statutory audit", qty: null, serviceId: other.liveId }],
      categoryId,
      pinnedBusinessIds: [firm.id],
      chosenBusinessIds: [firm.id],
      fanoutTo: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = await prisma.enquiryLine.findFirstOrThrow({ where: { enquiryId: result.enquiryId } });
    expect(line.serviceId).toBeNull();
  });
});

describe("confirmEnquiryAttachment — four locks", () => {
  async function sentWithFile() {
    const firm = await makeFirm();
    const { deps } = fakeStorage();
    const result = await sendServiceEnquiry(
      input(firm.id, { attachment: { filename: "tb.pdf", type: "application/pdf", bytes: 2048 } }),
      { buyerId },
      deps,
    );
    if (!result.ok || !result.upload) throw new Error("fixture enquiry did not send");
    return { firm, enquiryId: result.enquiryId, path: result.upload.path };
  }

  it("writes a private enquiry_attachment row with what storage holds, for the buyer", async () => {
    const { firm, enquiryId, path } = await sentWithFile();
    const { deps } = fakeStorage({ bytes: 1999, mimeType: "application/pdf" });
    const result = await confirmEnquiryAttachment(
      { enquiryId, path, filename: "Trial balance FY25.pdf", claimToken: null },
      { actorId: buyerId },
      deps,
    );
    expect(result.ok).toBe(true);

    const rows = await prisma.document.findMany({
      where: { enquiryId },
      select: { kind: true, bytes: true, isPublic: true, filename: true, businessId: true },
    });
    expect(rows).toEqual([
      { kind: "enquiry_attachment", bytes: 1999, isPublic: false, filename: "Trial balance FY25.pdf", businessId: null },
    ]);

    // The recipient reads the name and never the path; the buyer reads the name too.
    const lead = await getLeadDetail(firm.id, enquiryId);
    expect(lead?.attachments.map((file) => file.filename)).toEqual(["Trial balance FY25.pdf"]);
    expect(lead?.scale).toBe("AED 20–50m turnover");
    expect(lead?.lines[0]?.service?.slug).toBe("statutory-audit");
    expect(JSON.stringify(lead)).not.toContain(path);
    const mine = await getBuyerEnquiry(buyerId, enquiryId);
    expect(mine?.attachments.map((file) => file.filename)).toEqual(["Trial balance FY25.pdf"]);
    expect(mine?.lines[0]?.serviceId).not.toBeNull();
  });

  it("refuses anyone but the buyer with the same answer as a missing enquiry", async () => {
    const { enquiryId, path } = await sentWithFile();
    const { deps } = fakeStorage({ bytes: 10, mimeType: "application/pdf" });
    const stranger = await confirmEnquiryAttachment(
      { enquiryId, path, filename: "x.pdf", claimToken: "not-the-token" },
      { actorId: randomUUID() },
      deps,
    );
    const missing = await confirmEnquiryAttachment(
      { enquiryId: "no-such-enquiry", path, filename: "x.pdf", claimToken: null },
      { actorId: buyerId },
      deps,
    );
    expect(stranger).toEqual({ ok: false, reason: "not_found" });
    expect(missing).toEqual({ ok: false, reason: "not_found" });
  });

  it("accepts the claim token a buyer with no account carries", async () => {
    const { enquiryId, path } = await sentWithFile();
    const token = randomUUID();
    await prisma.user.update({ where: { id: buyerId }, data: { claimToken: token } });
    try {
      const result = await confirmEnquiryAttachment(
        { enquiryId, path, filename: "x.pdf", claimToken: token },
        { actorId: null },
        fakeStorage({ bytes: 10, mimeType: "application/pdf" }).deps,
      );
      expect(result.ok).toBe(true);
    } finally {
      await prisma.user.update({ where: { id: buyerId }, data: { claimToken: null } });
    }
  });

  it("refuses a path that is not this enquiry's", async () => {
    const { enquiryId } = await sentWithFile();
    const result = await confirmEnquiryAttachment(
      { enquiryId, path: "someone-else/certificate/licence.pdf", filename: "x.pdf", claimToken: null },
      { actorId: buyerId },
      fakeStorage({ bytes: 10, mimeType: "application/pdf" }).deps,
    );
    expect(result).toEqual({ ok: false, reason: "not_found" });
  });

  it("writes nothing for a file storage does not hold", async () => {
    const { enquiryId, path } = await sentWithFile();
    const result = await confirmEnquiryAttachment(
      { enquiryId, path, filename: "x.pdf", claimToken: null },
      { actorId: buyerId },
      fakeStorage(null).deps,
    );
    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(await prisma.document.count({ where: { enquiryId } })).toBe(0);
  });

  it("removes a stored file that is not what the bucket allows, rather than orphaning it", async () => {
    const { enquiryId, path } = await sentWithFile();
    const { deps, calls } = fakeStorage({ bytes: 500, mimeType: "text/html" });
    const result = await confirmEnquiryAttachment(
      { enquiryId, path, filename: "x.html", claimToken: null },
      { actorId: buyerId },
      deps,
    );
    expect(result).toEqual({ ok: false, reason: "refused" });
    expect(calls.removed).toEqual([path]);
  });

  it("takes one file and refuses a second", async () => {
    const { enquiryId, path } = await sentWithFile();
    const { deps } = fakeStorage({ bytes: 10, mimeType: "application/pdf" });
    const first = await confirmEnquiryAttachment({ enquiryId, path, filename: "a.pdf", claimToken: null }, { actorId: buyerId }, deps);
    const second = await confirmEnquiryAttachment({ enquiryId, path, filename: "b.pdf", claimToken: null }, { actorId: buyerId }, deps);
    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, reason: "full" });
  });
});

describe("saveServiceProfile — declared counts go with their sectors", () => {
  it("replaces counts from the form and drops a removed sector's count", async () => {
    const firm = await makeFirm();

    const saved = await saveServiceProfile(firm.id, {
      headline: "Audit and tax",
      sectorsServed: ["Construction & contracting", "Hospitality"],
      servicesOffered: [],
      sectorEngagements: { "construction & contracting": 45, hospitality: 6 },
    });
    expect(saved.ok).toBe(true);

    const rows = await prisma.sectorEngagement.findMany({
      where: { businessId: firm.id },
      orderBy: { sectorSlug: "asc" },
      select: { sectorSlug: true, engagements: true },
    });
    expect(rows).toEqual([
      { sectorSlug: "construction & contracting", engagements: 45 },
      { sectorSlug: "hospitality", engagements: 6 },
    ]);
  });

  it("leaves counts alone when the form did not send them, except for sectors removed", async () => {
    const firm = await makeFirm();
    await saveServiceProfile(firm.id, { sectorsServed: ["Trading"], servicesOffered: [] });
    const rows = await prisma.sectorEngagement.findMany({
      where: { businessId: firm.id },
      select: { sectorSlug: true, engagements: true },
    });
    expect(rows).toEqual([{ sectorSlug: "trading", engagements: 28 }]);
  });

  it("is refused by the database at zero, whatever writes it — the CHECK", async () => {
    const firm = await makeFirm();
    await expect(
      prisma.sectorEngagement.create({
        data: { businessId: firm.id, sectorSlug: "zero", engagements: 0 },
      }),
    ).rejects.toThrow();
  });
});
