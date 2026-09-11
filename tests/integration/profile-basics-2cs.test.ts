import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { saveServiceProfile } from "@/lib/onboarding/profile";
import {
  SECTOR_CHIPS,
  rebuildSectorIndex,
  searchSectors,
  sectorChipsFor,
} from "@/lib/onboarding/sector-index";

/**
 * Board `2c-s` — the sector index and the services save, against a database.
 *
 * The index is the part only a database can answer: the chips must come from
 * **this seller's own categories**, the spelling shown must be the one most
 * sellers used, and an empty index must stay empty rather than being padded.
 */

const PREFIX = "profile-2cs-test-";

let catA: string;
let catB: string;
const made: string[] = [];

let seq = 0;
const stamp = () => `${Date.now().toString(36)}${(seq += 1)}`;

async function makeSeller(fields: {
  categoryIds: readonly string[];
  sectors?: readonly string[];
  published?: boolean;
}): Promise<string> {
  const mark = stamp();
  const business = await prisma.business.create({
    data: {
      displayName: `${PREFIX}${mark}`,
      tradeName: `${PREFIX}${mark} LLC`,
      slug: `${PREFIX}${mark}`,
      licenceNumber: `DED-P${mark.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: fields.categoryIds[0]!,
      claimStatus: "claimed",
      sellsKind: "services",
      sectorsServed: [...(fields.sectors ?? [])],
      publishedAt: fields.published === false ? null : new Date(),
      ...(fields.categoryIds.length > 1
        ? { categories: { create: fields.categoryIds.slice(1).map((c) => ({ categoryId: c })) } }
        : {}),
    },
    select: { id: true },
  });
  made.push(business.id);
  return business.id;
}

beforeAll(async () => {
  const [a, b] = await Promise.all([
    prisma.category.create({
      data: { slug: `${PREFIX}a`, code: "P2", name: "Profile 2cs — A" },
      select: { id: true },
    }),
    prisma.category.create({
      data: { slug: `${PREFIX}b`, code: "P2", name: "Profile 2cs — B" },
      select: { id: true },
    }),
  ]);
  catA = a.id;
  catB = b.id;
});

afterAll(async () => {
  await prisma.business.deleteMany({ where: { id: { in: made } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await rebuildSectorIndex();
});

describe("the sector suggestion index — B2", () => {
  it("offers what sellers in this seller's own trades picked, not a global list", async () => {
    /*
       AC3, and the reason there is an index rather than a constant. A tax
       practice should be offered free-zone entities; a valve trader should be
       offered contracting. One list cannot do both.
    */
    await makeSeller({ categoryIds: [catA], sectors: ["Free zone entities", "Family offices"] });
    await makeSeller({ categoryIds: [catA], sectors: ["Free zone entities"] });
    await makeSeller({ categoryIds: [catB], sectors: ["Contracting"] });

    await rebuildSectorIndex();

    const forA = await sectorChipsFor([catA]);
    const forB = await sectorChipsFor([catB]);

    expect(forA.map((c) => c.label)).toContain("Free zone entities");
    expect(forA.map((c) => c.label)).not.toContain("Contracting");
    expect(forB.map((c) => c.label)).toEqual(["Contracting"]);
  });

  it("ranks by how many sellers picked each, not by when", async () => {
    const chips = await sectorChipsFor([catA]);
    expect(chips[0]?.label).toBe("Free zone entities");
    expect(chips[0]?.pickedBy).toBe(2);
  });

  it("counts a seller once however many spellings they used", async () => {
    // The figure is "how many sellers", not "how many rows".
    await makeSeller({ categoryIds: [catB], sectors: ["Contracting", "contracting"] });
    await rebuildSectorIndex();
    const chips = await sectorChipsFor([catB]);
    expect(chips.find((c) => c.label.toLowerCase() === "contracting")?.pickedBy).toBe(2);
  });

  it("keeps the spelling most sellers used", async () => {
    /*
       The chip has to read the way the trade writes it. Two sellers typed
       "Contracting" and one typed "contracting", so the chip is capitalised.
    */
    const chips = await sectorChipsFor([catB]);
    expect(chips.find((c) => c.label.toLowerCase() === "contracting")?.label).toBe("Contracting");
  });

  it("merges across a seller's categories rather than reading only the primary", async () => {
    const chips = await sectorChipsFor([catA, catB]);
    const labels = chips.map((c) => c.label);
    expect(labels).toContain("Free zone entities");
    expect(labels).toContain("Contracting");
  });

  it("stays empty on a trade nobody has filled in — the cold start", async () => {
    /*
       A designed state, not a bug. Padding it with a plausible twelve would be
       the curated list this field exists to avoid, wearing the clothes of data.
    */
    const fresh = await prisma.category.create({
      data: { slug: `${PREFIX}cold`, code: "P2", name: "Profile 2cs — cold" },
      select: { id: true },
    });
    expect(await sectorChipsFor([fresh.id])).toEqual([]);
    await prisma.category.delete({ where: { id: fresh.id } });
  });

  it("offers nothing at all when the seller holds no categories", async () => {
    expect(await sectorChipsFor([])).toEqual([]);
  });

  it("never returns more chips than the board asks for", async () => {
    const chips = await sectorChipsFor([catA, catB]);
    expect(chips.length).toBeLessThanOrEqual(SECTOR_CHIPS);
  });

  it("leaves an unpublished or suspended listing out of the index", async () => {
    // The index is a suggestion built from the live directory. A draft nobody
    // can find should not be shaping what the next seller is offered.
    const before = await sectorChipsFor([catB]);
    await makeSeller({ categoryIds: [catB], sectors: ["Ghost sector"], published: false });
    await rebuildSectorIndex();
    const after = await sectorChipsFor([catB]);
    expect(after.map((c) => c.label)).not.toContain("Ghost sector");
    expect(after.length).toBe(before.length);
  });

  it("finds a sector by part of its name, case-insensitively", async () => {
    const found = await searchSectors("ZONE");
    expect(found.map((row) => row.label)).toContain("Free zone entities");
  });

  it("returns nothing for a query that matches nothing, so the caller offers it as new", async () => {
    expect(await searchSectors("marine salvage arbitration")).toEqual([]);
  });
});

describe("saving the services field set", () => {
  it("writes the three fields and normalises the sectors", async () => {
    const id = await makeSeller({ categoryIds: [catA] });
    const result = await saveServiceProfile(id, {
      headline: "  Statutory audit, VAT and corporate tax for contractors  ",
      servicesOffered: ["Audit", "audit", "VAT"],
      sectorsServed: ["Free  Zone", " free zone ", "Healthcare"],
    });
    expect(result.ok).toBe(true);

    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { headline: true, servicesOffered: true, sectorsServed: true },
    });
    expect(row.headline).toBe("Statutory audit, VAT and corporate tax for contractors");
    // Deduplicated case-insensitively, first spelling kept.
    expect(row.servicesOffered).toEqual(["Audit", "VAT"]);
    expect(row.sectorsServed).toEqual(["Free Zone", "Healthcare"]);
  });

  it("refuses a sixth service and writes nothing at all", async () => {
    /*
       B4. The refusal names the cap, and — the part that matters — the row is
       untouched, so a seller who is over does not silently lose the five they
       had while being told about the sixth.
     */
    const id = await makeSeller({ categoryIds: [catA] });
    await saveServiceProfile(id, { servicesOffered: ["A", "B"] });

    const result = await saveServiceProfile(id, {
      servicesOffered: ["A", "B", "C", "D", "E", "F"],
    });
    expect(result.ok).toBe(false);

    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { servicesOffered: true },
    });
    expect(row.servicesOffered).toEqual(["A", "B"]);
  });

  it("leaves the goods columns alone — AC2", async () => {
    // A business that switches kind keeps its data; the fields are simply not
    // rendered. The same no-conversion rule as 4d-s B5 and 2b-s B5.
    const id = await makeSeller({ categoryIds: [catA] });
    await prisma.business.update({
      where: { id },
      data: { description: "Six hundred characters of storefront prose.", deliveryNote: "Next day" },
    });

    await saveServiceProfile(id, { headline: "Audit and tax", servicesOffered: ["Audit"] });

    const row = await prisma.business.findUniqueOrThrow({
      where: { id },
      select: { description: true, deliveryNote: true, headline: true },
    });
    expect(row.description).toBe("Six hundred characters of storefront prose.");
    expect(row.deliveryNote).toBe("Next day");
    expect(row.headline).toBe("Audit and tax");
  });
});
