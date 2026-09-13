import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import { getListing } from "@/lib/db/queries/listing";
import { saveListing } from "@/lib/listing/save";
import { saveServiceProfile } from "@/lib/onboarding/profile";

/**
 * Board `3b-s` — the listing profile for a firm that sells work, against a
 * database.
 *
 * The rule the whole board turns on is B8: onboarding (`2c-s`) and this screen
 * save **one** field set. So several cases here write through one path and read
 * back through the other, which is the only way to catch the two drifting.
 */

const PREFIX = "l3bs-";

let parentCategoryId: string;
let leafIds: string[];
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function firm(primaryCategoryId: string): Promise<{ id: string; owner: Actor }> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-P${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId,
      claimStatus: "claimed",
      sellsKind: "services",
      publishedAt: new Date(),
      paymentTerms: "30 days from invoice",
      teamSize: "b11_50",
      languages: ["English"],
      sectorsServed: ["Contracting"],
      servicesOffered: ["Statutory audit", "VAT filing"],
    },
    select: { id: true },
  });
  made.push(business.id);
  // A real seat: every save writes a revision row naming who made it.
  const owner = await prisma.user.create({
    data: { id: crypto.randomUUID(), businessId: business.id, roles: ["seller_owner"], fullName: "R. Iyer" },
    select: { id: true },
  });
  return {
    id: business.id,
    owner: { id: owner.id, roles: ["seller_owner"], businessId: business.id },
  };
}

beforeAll(async () => {
  const parent = await prisma.category.findFirstOrThrow({
    where: { children: { some: {} } },
    orderBy: { slug: "asc" },
    select: { id: true },
  });
  parentCategoryId = parent.id;
  leafIds = (
    await prisma.category.findMany({
      where: { children: { none: {} } },
      orderBy: { name: "asc" },
      take: 2,
      select: { id: true },
    })
  ).map((row) => row.id);
});

afterAll(async () => {
  await prisma.listingRevision.deleteMany({ where: { businessId: { in: made } } });
  await prisma.listingChangeRequest.deleteMany({ where: { businessId: { in: made } } });
  await prisma.sectorEngagement.deleteMany({ where: { businessId: { in: made } } });
  await prisma.user.deleteMany({ where: { businessId: { in: made } } });
  await prisma.business.deleteMany({ where: { id: { in: made } } });
});

describe("the services field set, saved from the dashboard", () => {
  it("writes the one-liner, sectors, qualified count and typical client, and names them as live", async () => {
    const f = await firm(leafIds[0]!);
    const result = await saveListing(f.owner, f.id, {
      description: "We audit contracting and trading companies.",
      teamSize: "b11_50",
      services: {
        headline: "Statutory audit for contractors",
        sectorsServed: ["Contracting", "Trading"],
        qualifiedCount: 9,
        typicalClient: "AED 10m–150m turnover",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.live).toEqual(
      expect.arrayContaining(["description", "headline", "sectors_served", "qualified_count", "typical_client"]),
    );

    const row = await prisma.business.findUniqueOrThrow({
      where: { id: f.id },
      select: { headline: true, sectorsServed: true, qualifiedCount: true, typicalClient: true, servicesOffered: true },
    });
    expect(row).toEqual({
      headline: "Statutory audit for contractors",
      sectorsServed: ["Contracting", "Trading"],
      qualifiedCount: 9,
      typicalClient: "AED 10m–150m turnover",
      // Onboarding's list is untouched — the dashboard does not ask for it.
      servicesOffered: ["Statutory audit", "VAT filing"],
    });
  });

  it("checks the qualified count against the band this save writes, before writing anything", async () => {
    const f = await firm(leafIds[0]!);
    const refused = await saveListing(f.owner, f.id, {
      description: "Changed prose that must not land.",
      teamSize: "b1_10",
      services: { headline: "", sectorsServed: [], qualifiedCount: 12 },
    });
    expect(refused).toEqual({ ok: false, error: expect.stringContaining("10") });
    const row = await prisma.business.findUniqueOrThrow({
      where: { id: f.id },
      select: { description: true, teamSize: true, qualifiedCount: true },
    });
    // Validation first, all of it: the description did not land either.
    expect(row).toEqual({ description: null, teamSize: "b11_50", qualifiedCount: null });
  });

  it("refuses a seventh sector and says the cap — Q1", async () => {
    const f = await firm(leafIds[0]!);
    const seven = ["A", "B", "C", "D", "E", "F", "G"].map((letter) => `Sector ${letter}`);
    const result = await saveListing(f.owner, f.id, {
      services: { headline: "", sectorsServed: seven },
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("6") });
  });

  it("leaves payment terms alone when the screen did not draw them", async () => {
    // `2b-s` B5: switching kind converts and deletes nothing.
    const f = await firm(leafIds[0]!);
    await saveListing(f.owner, f.id, { description: "Prose.", services: { headline: "", sectorsServed: [] } });
    const row = await prisma.business.findUniqueOrThrow({ where: { id: f.id }, select: { paymentTerms: true } });
    expect(row.paymentTerms).toBe("30 days from invoice");
  });
});

describe("B8 — one field set, two screens", () => {
  it("reads back on the dashboard exactly what onboarding saved, languages included", async () => {
    /*
       `2c-s` rendered a languages field and never saved it. Onboarding now
       does, and the value it writes is the value this screen's view reads.
    */
    const f = await firm(leafIds[0]!);
    const saved = await saveServiceProfile(f.id, {
      headline: "Audit",
      sectorsServed: ["Contracting"],
      servicesOffered: ["Statutory audit"],
      languages: ["English", "Arabic", "Malayalam"],
      qualifiedCount: 4,
      typicalClient: "Family offices",
    });
    expect(saved.ok).toBe(true);

    const view = await getListing(f.id);
    expect(view!.languages).toEqual(["English", "Arabic", "Malayalam"]);
    const row = await prisma.business.findUniqueOrThrow({
      where: { id: f.id },
      select: { qualifiedCount: true, typicalClient: true },
    });
    expect(row).toEqual({ qualifiedCount: 4, typicalClient: "Family offices" });
  });

  it("does not clear languages when an older onboarding client did not send them", async () => {
    const f = await firm(leafIds[0]!);
    await saveServiceProfile(f.id, { headline: "Audit", sectorsServed: [], servicesOffered: [] });
    const row = await prisma.business.findUniqueOrThrow({ where: { id: f.id }, select: { languages: true } });
    expect(row.languages).toEqual(["English"]);
  });
});

describe("the primary-category picker, found on the way", () => {
  it("offers the current primary even when it is not a leaf", async () => {
    /*
       The picker lists leaves, and a select whose value is not an option shows
       and posts its first option. 89 of 123 production listings carry a
       non-leaf primary, so the screen showed the alphabetically first leaf and
       any save queued a request to move the listing there.
    */
    const f = await firm(parentCategoryId);
    const view = await getListing(f.id);
    expect(view!.choices.some((row) => row.id === parentCategoryId)).toBe(true);
    expect(view!.choices[0]!.id).toBe(parentCategoryId);
  });

  it("queues no primary-category request when the seller saves an unrelated field", async () => {
    const f = await firm(parentCategoryId);
    const result = await saveListing(f.owner, f.id, {
      description: "Only the description moved.",
      primaryCategoryId: parentCategoryId,
    });
    expect(result.ok && result.held).toEqual([]);
    expect(
      await prisma.listingChangeRequest.count({ where: { businessId: f.id, field: "primary_category" } }),
    ).toBe(0);
  });
});
