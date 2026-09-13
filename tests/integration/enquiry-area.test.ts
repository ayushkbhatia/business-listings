import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createEnquiry } from "@/lib/enquiry/service";

/**
 * `Enquiry.areaId` — stage 6's third migration, against a database.
 *
 * `lib/enquiry/area.test.ts` proves the resolver's refusals against
 * hand-written rows. This is the half only a database can answer: that the
 * write reaches the column at all, that it resolves against the **real**
 * taxonomy rather than a fixture of it, that the free text a buyer typed
 * survives beside the id, and that the foreign key is `RESTRICT` — so removing
 * an area a buyer has named stops rather than quietly rewriting their enquiry
 * into one that named nowhere.
 */

const PREFIX = "enq-area-test-";

let categoryId: string;
let dubaiArea: { id: string; name: string };
const madeRefs: string[] = [];

async function send(over: Record<string, unknown> = {}) {
  const result = await createEnquiry({
    buyerId: null,
    attribution: {},
    phone: "+971500000044",
    fullName: "Area Test Buyer",
    requirement: `${PREFIX}two floors, nightly`,
    lines: [
      { description: "Gate valve DN150", qty: 2, unit: "pcs", size: null, targetUnitPriceAed: "190", productId: null },
    ],
    categoryId,
    emirate: "dubai",
    deliverToArea: dubaiArea.name,
    neededBy: null,
    termsWanted: null,
    closesInDays: 7,
    fanoutTo: 3,
    ...over,
  } as Parameters<typeof createEnquiry>[0]);
  if (result.ok) madeRefs.push(result.ref);
  return result;
}

/** The row the write produced, by the ref it returned. */
async function stored(ref: string) {
  return prisma.enquiry.findFirstOrThrow({
    where: { ref },
    select: { id: true, areaId: true, deliverToArea: true, emirate: true },
  });
}

beforeAll(async () => {
  /*
     Pinned by slug, not "the first leaf". `created_at is not a total order`:
     an unordered pick returns a stable answer until something UPDATEs and the
     rows move in the heap, and the suite files its suppliers in this trade —
     a category with no sellers makes every send return `no_recipients`.
  */
  const category = await prisma.category.findUniqueOrThrow({
    where: { slug: "valves-and-fittings" },
    select: { id: true },
  });
  categoryId = category.id;

  /*
     A real Dubai area whose name is unique across the whole taxonomy, so the
     no-emirate case below is testing the resolver's ambiguity rule rather than
     an accident of the seed.
  */
  const areas = await prisma.area.findMany({
    where: { emirate: "dubai", isFreeZone: false },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const counts = await prisma.area.groupBy({ by: ["name"], _count: true });
  const unique = new Set(counts.filter((row) => row._count === 1).map((row) => row.name));
  dubaiArea = areas.find((area) => unique.has(area.name)) ?? areas[0]!;
});

afterAll(async () => {
  const ids = await prisma.enquiry.findMany({
    where: { requirement: { startsWith: PREFIX } },
    select: { id: true },
  });
  const enquiryIds = ids.map((row) => row.id);
  await prisma.enquiryRecipient.deleteMany({ where: { enquiryId: { in: enquiryIds } } });
  await prisma.enquiryLine.deleteMany({ where: { enquiryId: { in: enquiryIds } } });
  await prisma.enquiry.deleteMany({ where: { id: { in: enquiryIds } } });
});

describe("the write", () => {
  it("resolves the typed area against the real taxonomy and stores the id", async () => {
    const result = await send();
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await stored(result.ref);
    expect(row.areaId).toBe(dubaiArea.id);
    // And what the buyer typed is still there. Two claims, not one replacing
    // the other.
    expect(row.deliverToArea).toBe(dubaiArea.name);
  });

  it("stores null, and keeps the words, for a place the taxonomy does not hold", async () => {
    /*
       The ordinary case. A buyer describing a site in their own words has told
       a seller something real that no `area` row holds — the column stays null
       and the sentence survives, because the alternative is the platform
       inventing a delivery address on a record a seller prices against.
    */
    const result = await send({ deliverToArea: "near the Dragon Mart roundabout" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await stored(result.ref);
    expect(row.areaId).toBeNull();
    expect(row.deliverToArea).toBe("near the Dragon Mart roundabout");
  });

  it("refuses to reach outside the emirate the buyer stated", async () => {
    const elsewhere = await prisma.area.findFirst({
      where: { emirate: { not: "dubai" }, isFreeZone: false },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    if (!elsewhere) return;

    const result = await send({ deliverToArea: elsewhere.name, emirate: "dubai" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Reading the buyer's answer and then ignoring it is worse than not
    // resolving at all.
    expect((await stored(result.ref)).areaId).toBeNull();
  });

  it("ignores case and spacing, which are typing artefacts", async () => {
    const typed = `  ${dubaiArea.name.toUpperCase().replace(/ /g, "  ")} `;
    const result = await send({ deliverToArea: typed });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const row = await stored(result.ref);
    expect(row.areaId).toBe(dubaiArea.id);
    expect(row.deliverToArea).toBe(typed);
  });

  it("stores null when the buyer named nowhere at all", async () => {
    const result = await send({ deliverToArea: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await stored(result.ref)).areaId).toBeNull();
  });
});

describe("what the foreign key holds", () => {
  it("refuses to delete an area a buyer has named", async () => {
    /*
       `RESTRICT`, not `SET NULL`. `SET NULL` would turn an enquiry that named
       this area into one that named nowhere — silently, on a record a seller
       has already quoted against. The delete has to stop and make somebody
       decide.
    */
    const result = await send();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((await stored(result.ref)).areaId).toBe(dubaiArea.id);

    await expect(prisma.area.delete({ where: { id: dubaiArea.id } })).rejects.toThrow();

    // And the enquiry is untouched by the attempt.
    expect((await stored(result.ref)).areaId).toBe(dubaiArea.id);
  });
});
