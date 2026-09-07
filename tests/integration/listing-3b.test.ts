import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getListing } from "@/lib/db/queries/listing";
import { saveListing } from "@/lib/listing/save";
import { pick, setCover, unpick } from "@/lib/listing/photos";
import { approveChange } from "@/lib/moderation/service";
import { PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * Board 3b — the listing profile, and the save model it exists to make legible.
 *
 * The criteria a unit test cannot reach: what one save actually writes and
 * queues, what a moderator's approval does to the join, and whether removing a
 * photograph leaves the file alone.
 */

const PREFIX = "l3b-";
const actor = (id: string, ...roles: Role[]): Actor => ({ id, roles });

let categoryIds: string[];
let areaId: string;
let opsLeadId: string;
let seq = 0;

async function removeFixtures() {
  const ours = await prisma.business.findMany({
    where: { slug: { startsWith: PREFIX } },
    select: { id: true },
  });
  const ids = ours.map((row) => row.id);
  if (ids.length === 0) return;

  const requests = await prisma.listingChangeRequest.findMany({
    where: { businessId: { in: ids } },
    select: { id: true },
  });
  await prisma.auditEvent.deleteMany({
    where: { subject: { in: requests.map((row) => `ListingChangeRequest:${row.id}`) } },
  });
  await prisma.listingRevision.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.listingChangeRequest.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.media.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.businessCategory.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.user.deleteMany({ where: { businessId: { in: ids } } });
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

beforeAll(async () => {
  const leaves = await prisma.category.findMany({
    where: { children: { none: {} } },
    orderBy: { name: "asc" },
    take: 6,
    select: { id: true },
  });
  categoryIds = leaves.map((row) => row.id);
  areaId = (await prisma.area.findFirstOrThrow({ select: { id: true } })).id;
  opsLeadId = (
    await prisma.user.findFirstOrThrow({
      where: { roles: { has: "staff_ops_lead" } },
      select: { id: true },
    })
  ).id;
  await removeFixtures();
});

afterAll(removeFixtures);

/** A claimed listing with an owner seat that can edit it. */
async function listing() {
  seq += 1;
  const stamp = `${Date.now()}${String(seq).padStart(2, "0")}`;
  const business = await prisma.business.create({
    data: {
      tradeName: `Listing Fixture ${stamp} LLC`,
      displayName: `Listing Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryIds[0]!,
      claimStatus: "claimed",
      publishedAt: new Date(),
      description: "Original description.",
      locations: {
        create: {
          type: "head_office",
          emirate: "dubai",
          areaId,
          addressLine: "Warehouse 3, Street 12",
          published: true,
        },
      },
    },
    select: { id: true, slug: true },
  });

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      businessId: business.id,
      roles: ["seller_owner"],
      fullName: "S. Menon",
    },
    select: { id: true },
  });

  return {
    ...business,
    /*
       Scoped to the business, which a seller actor always is.

       `saveListing` refuses when `actor.businessId` does not match — the check
       that stops one seller editing another's listing — so an actor without it
       is refused on every call and every assertion below would pass for the
       wrong reason.
    */
    owner: { ...actor(owner.id, "seller_owner"), businessId: business.id },
  };
}

describe("criterion 3 — one action writes the live half and queues the held half", () => {
  it("saves a description and queues a category in the same call", async () => {
    const fixture = await listing();

    const result = await saveListing(fixture.owner, fixture.id, {
      description: "A new description the seller owns.",
      addCategoryIds: [categoryIds[1]!],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.live).toContain("description");
    expect(result.held).toEqual([{ field: "additional_category", value: categoryIds[1] }]);

    // The description is live. The category is not.
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: fixture.id },
      select: { description: true, categories: { select: { categoryId: true } } },
    });
    expect(after.description).toBe("A new description the seller owns.");
    expect(after.categories).toHaveLength(0);
  });

  it("criterion 1 — a description alone produces no held edit at all", async () => {
    const fixture = await listing();
    const result = await saveListing(fixture.owner, fixture.id, { description: "Just prose." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.held).toHaveLength(0);

    const view = await getListing(fixture.id);
    // The header pill counts exactly this. Zero here is zero on screen.
    expect(view!.held).toHaveLength(0);
  });

  it("writes only what moved, so the revision list says what changed", async () => {
    const fixture = await listing();
    // Same description, different year. The description must not be recorded.
    const result = await saveListing(fixture.owner, fixture.id, {
      description: "Original description.",
      establishedYear: 2009,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.live).toEqual(["established_year"]);

    const revisions = await prisma.listingRevision.findMany({
      where: { businessId: fixture.id },
      select: { field: true },
    });
    expect(revisions.map((row) => row.field)).toEqual(["established_year"]);
  });

  it("refuses an over-long description before writing anything", async () => {
    const fixture = await listing();
    const result = await saveListing(fixture.owner, fixture.id, {
      description: "x".repeat(601),
      establishedYear: 2011,
    });
    expect(result.ok).toBe(false);

    // Nothing was written, including the year that was fine.
    const after = await prisma.business.findUniqueOrThrow({
      where: { id: fixture.id },
      select: { description: true, establishedYear: true },
    });
    expect(after.description).toBe("Original description.");
    expect(after.establishedYear).toBeNull();
  });
});

describe("criterion 4 — a held category does not touch the live ones", () => {
  it("keeps the current categories until a moderator clears it", async () => {
    const fixture = await listing();
    await prisma.businessCategory.create({
      data: { businessId: fixture.id, categoryId: categoryIds[2]! },
    });

    await saveListing(fixture.owner, fixture.id, { addCategoryIds: [categoryIds[3]!] });

    const before = await getListing(fixture.id);
    expect(before!.additional.map((row) => row.id)).toEqual([categoryIds[2]]);
    expect(before!.held).toHaveLength(1);

    const request = await prisma.listingChangeRequest.findFirstOrThrow({
      where: { businessId: fixture.id, status: "pending" },
      select: { id: true, beforeValue: true },
    });
    // An addition, so there is no "before" to be stale against.
    expect(request.beforeValue).toBeNull();

    const decided = await approveChange({
      actor: actor(opsLeadId, "staff_ops_lead"),
      requestId: request.id,
      reason: "Licence activity covers this trade.",
    });
    expect(decided.ok).toBe(true);

    const after = await getListing(fixture.id);
    expect(after!.additional.map((row) => row.id).sort()).toEqual(
      [categoryIds[2], categoryIds[3]].sort(),
    );
    expect(after!.held).toHaveLength(0);
  });

  it("refuses a second ask for the same category rather than superseding the first", async () => {
    const fixture = await listing();
    await saveListing(fixture.owner, fixture.id, { addCategoryIds: [categoryIds[4]!] });
    const second = await saveListing(fixture.owner, fixture.id, {
      addCategoryIds: [categoryIds[4]!],
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.held).toHaveLength(0);
    expect(second.refused).toHaveLength(1);

    // Still exactly one waiting, not one withdrawn and one fresh.
    const pending = await prisma.listingChangeRequest.count({
      where: { businessId: fixture.id, field: "additional_category", status: "pending" },
    });
    expect(pending).toBe(1);
  });

  it("lets two different categories wait at once", async () => {
    const fixture = await listing();
    await saveListing(fixture.owner, fixture.id, {
      addCategoryIds: [categoryIds[1]!, categoryIds[2]!],
    });
    const view = await getListing(fixture.id);
    expect(view!.held).toHaveLength(2);
  });

  it("removes a category immediately — giving up reach needs no gate", async () => {
    const fixture = await listing();
    await prisma.businessCategory.create({
      data: { businessId: fixture.id, categoryId: categoryIds[5]! },
    });

    await saveListing(fixture.owner, fixture.id, { removeCategoryIds: [categoryIds[5]!] });

    const view = await getListing(fixture.id);
    expect(view!.additional).toHaveLength(0);
    expect(view!.held).toHaveLength(0);
  });
});

describe("criterion 7 — removing a photograph unpicks it", () => {
  async function photo(businessId: string, kind: "cover" | "gallery" | "library", order = 0) {
    seq += 1;
    return prisma.media.create({
      data: {
        businessId,
        kind,
        storagePath: `${businessId}/photo-${seq}.jpg`,
        alt: "Warehouse",
        sortOrder: order,
      },
      select: { id: true },
    });
  }

  it("leaves the file in the library, and the library still lists it", async () => {
    const fixture = await listing();
    await photo(fixture.id, "cover", 0);
    const second = await photo(fixture.id, "gallery", 1);

    const result = await unpick(fixture.owner, fixture.id, second.id);
    expect(result.ok).toBe(true);

    const row = await prisma.media.findUnique({
      where: { id: second.id },
      select: { kind: true, alt: true, storagePath: true },
    });
    // The row is still there, with everything on it.
    expect(row).not.toBeNull();
    expect(row!.kind).toBe("library");
    expect(row!.alt).toBe("Warehouse");

    const view = await getListing(fixture.id);
    expect(view!.photos.picked).toHaveLength(1);
    // And it is still counted in the library, which is what the label says.
    expect(view!.photos.libraryCount).toBe(2);
  });

  it("refuses to unpick the cover rather than silently promoting the next one", async () => {
    const fixture = await listing();
    const cover = await photo(fixture.id, "cover", 0);
    await photo(fixture.id, "gallery", 1);

    const result = await unpick(fixture.owner, fixture.id, cover.id);
    expect(result.ok).toBe(false);
  });

  it("puts a library file back at the end of the order", async () => {
    const fixture = await listing();
    await photo(fixture.id, "cover", 0);
    const held = await photo(fixture.id, "library", 0);

    expect((await pick(fixture.owner, fixture.id, held.id)).ok).toBe(true);
    const view = await getListing(fixture.id);
    expect(view!.photos.picked).toHaveLength(2);
    expect(view!.photos.picked.find((row) => row.id === held.id)?.isCover).toBe(false);
  });

  it("keeps exactly one cover when a new one is set", async () => {
    const fixture = await listing();
    const first = await photo(fixture.id, "cover", 0);
    const second = await photo(fixture.id, "gallery", 1);

    expect((await setCover(fixture.owner, fixture.id, second.id)).ok).toBe(true);

    const covers = await prisma.media.count({ where: { businessId: fixture.id, kind: "cover" } });
    expect(covers).toBe(1);
    // The outgoing cover stays on the listing rather than being unpicked.
    const outgoing = await prisma.media.findUniqueOrThrow({
      where: { id: first.id },
      select: { kind: true },
    });
    expect(outgoing.kind).toBe("gallery");
  });
});

describe("criterion 11 — a seat without listing.edit cannot write", () => {
  it("refuses a sales seat", async () => {
    const fixture = await listing();
    await expect(
      saveListing({ ...actor(fixture.owner.id, "seller_sales"), businessId: fixture.id }, fixture.id, {
        description: "Sales trying to edit the listing.",
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it("refuses an owner of a different business", async () => {
    const mine = await listing();
    const theirs = await listing();
    const result = await saveListing(theirs.owner, mine.id, { description: "Not mine." });
    expect(result).toMatchObject({ ok: false });
  });
});
