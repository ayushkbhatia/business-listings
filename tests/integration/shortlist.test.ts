import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import {
  isShortlisted,
  removeShortlist,
  shortlistCount,
  shortlistFor,
  toggleShortlist,
} from "@/lib/shortlist/service";

/**
 * The buyer shortlist, against a real database.
 *
 * Three of the four cases below are only answerable here. Whether a double tap
 * leaves one row or two is a property of the unique index, not of the
 * TypeScript above it; whether the count a seller reads matches the rows a
 * buyer sees is a question about two different queries agreeing; and whether a
 * removal still works once the listing has gone dark is a question about which
 * `where` clause runs first.
 */

const PREFIX = "shortlist-test-";
const BUYER = "Shortlist Test Buyer";

let categoryId: string;
let listedId: string;
let secondListedId: string;
let unlistedId: string;
let buyer: Actor;
let otherBuyer: Actor;
let thirdBuyer: Actor;

let seq = 0;

function stamp(): string {
  seq += 1;
  return `${Date.now().toString(36)}${seq}`;
}

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: { startsWith: BUYER } } });
}

/** A supplier. Published unless the caller says otherwise. */
async function listing(name: string, published = true): Promise<string> {
  const id = stamp();
  const business = await prisma.business.create({
    data: {
      tradeName: `Shortlist ${name} Trading ${id}`,
      displayName: `Shortlist ${name}`,
      slug: `${PREFIX}${name}-${id}`,
      licenceNumber: `DED-SL${id.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      publishedAt: published ? new Date() : null,
    },
    select: { id: true },
  });
  return business.id;
}

async function buyerActor(label: string): Promise<Actor> {
  const user = await prisma.user.create({
    data: { id: crypto.randomUUID(), fullName: `${BUYER} ${label}`, roles: ["buyer"] },
    select: { id: true },
  });
  return { id: user.id, roles: ["buyer"] };
}

/** Rows for one supplier, counted off the table rather than off the service. */
function rowsFor(businessId: string): Promise<number> {
  return prisma.shortlist.count({ where: { businessId } });
}

beforeAll(async () => {
  await removeFixtures();

  categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  listedId = await listing("hydraulics");
  secondListedId = await listing("valves");
  unlistedId = await listing("draft", false);

  buyer = await buyerActor("A");
  otherBuyer = await buyerActor("B");
  thirdBuyer = await buyerActor("C");
}, 120_000);

afterEach(async () => {
  await prisma.shortlist.deleteMany({
    where: { businessId: { in: [listedId, secondListedId, unlistedId] } },
  });
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("one press saves, the next removes", () => {
  it("writes a row, reads it back, and takes it away again", async () => {
    expect(await isShortlisted(buyer.id, listedId)).toBe(false);

    const saved = await toggleShortlist(buyer, listedId, true);
    expect(saved).toMatchObject({ ok: true, saved: true });
    expect(await isShortlisted(buyer.id, listedId)).toBe(true);
    expect(await rowsFor(listedId)).toBe(1);

    const removed = await toggleShortlist(buyer, listedId, false);
    expect(removed).toMatchObject({ ok: true, saved: false });
    expect(await isShortlisted(buyer.id, listedId)).toBe(false);
    expect(await rowsFor(listedId)).toBe(0);
  });

  it("hands back the slug the caller has to revalidate", async () => {
    /*
       The action revalidates the supplier's storefront, and it would need a
       second query to find out which one. The service has already looked the
       business up to check it exists, so it returns the slug rather than
       making the caller ask again.
    */
    const result = await toggleShortlist(buyer, listedId, true);
    expect(result.ok && result.slug.startsWith(PREFIX)).toBe(true);
  });

  it("keeps one buyer's list out of another's", async () => {
    await toggleShortlist(buyer, listedId, true);

    expect(await isShortlisted(otherBuyer.id, listedId)).toBe(false);
    expect((await shortlistFor(otherBuyer.id)).map((s) => s.businessId)).not.toContain(listedId);

    const mine = await shortlistFor(buyer.id);
    expect(mine.map((s) => s.businessId)).toEqual([listedId]);
    // Seller identity is displayName everywhere, this row included.
    expect(mine[0]?.displayName).toMatch(/^Shortlist hydraulics$/);
  });
});

describe("two taps at once", () => {
  it("leaves one row rather than two, and never a unique violation", async () => {
    /*
       The defect this exists for. Both presses are dispatched in the same tick,
       so both INSERTs are on the wire before either has committed; the unique
       index refuses the second and the service reads that refusal as "the other
       press already saved it" rather than letting a P2002 reach a buyer as a
       500 on a button that saves a bookmark.
    */
    const [first, second] = await Promise.all([
      toggleShortlist(buyer, listedId, true),
      toggleShortlist(buyer, listedId, true),
    ]);

    expect(first.ok, "a racing press came back as a failure").toBe(true);
    expect(second.ok, "a racing press came back as a failure").toBe(true);
    expect(await rowsFor(listedId)).toBe(1);
    expect(await isShortlisted(buyer.id, listedId)).toBe(true);
  });

  it("does not cancel itself when the same intention arrives twice", async () => {
    /*
       Why the direction is a parameter rather than something the service works
       out. An earlier version flipped the current state, and this is the
       interleaving that caught it: the second press deleted the row the first
       had just written, so a buyer who double-tapped ended with nothing saved
       and no way to tell. `save` twice is `save`.
    */
    await toggleShortlist(buyer, listedId, true);

    const [first, second] = await Promise.all([
      toggleShortlist(buyer, listedId, true),
      toggleShortlist(buyer, listedId, true),
    ]);

    expect(first).toMatchObject({ ok: true, saved: true });
    expect(second).toMatchObject({ ok: true, saved: true });
    expect(await rowsFor(listedId)).toBe(1);
  });

  it("removes once however many times the remove press lands", async () => {
    await toggleShortlist(buyer, listedId, true);

    const [first, second] = await Promise.all([
      toggleShortlist(buyer, listedId, false),
      toggleShortlist(buyer, listedId, false),
    ]);

    expect(first).toMatchObject({ ok: true, saved: false });
    expect(second).toMatchObject({ ok: true, saved: false });
    expect(await rowsFor(listedId)).toBe(0);
  });
});

describe("signed out", () => {
  it("is refused, and writes nothing", async () => {
    /*
       There is no anonymous shortlist and no cookie behind one. A list that
       lives in a browser is lost on the next device, and this refusal is what
       the button turns into a sign-in link.
    */
    expect(await toggleShortlist(null, listedId, true)).toEqual({ ok: false, error: "signed_out" });
    expect(await removeShortlist(null, listedId)).toEqual({ ok: false, error: "signed_out" });
    expect(await rowsFor(listedId)).toBe(0);
  });

  it("refuses a supplier that does not exist, and one no buyer could reach", async () => {
    expect(await toggleShortlist(buyer, "no-such-business-id", true)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await toggleShortlist(buyer, unlistedId, true)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await rowsFor(unlistedId)).toBe(0);
  });

  it("still removes a supplier whose listing has since gone dark", async () => {
    /*
       Saving is gated on the listing being one a buyer could have reached.
       Removing is not, and must not be: a saved supplier that goes unpublished
       and takes its own remove control with it is a row nobody can get rid of.
    */
    await prisma.shortlist.create({ data: { userId: buyer.id, businessId: unlistedId } });

    expect(await toggleShortlist(buyer, unlistedId, false)).toMatchObject({
      ok: true,
      saved: false,
    });
    expect(await rowsFor(unlistedId)).toBe(0);
  });
});

describe("the count a seller reads", () => {
  it("matches the rows the buyers hold", async () => {
    expect(await shortlistCount(listedId)).toBe(0);

    await toggleShortlist(buyer, listedId, true);
    await toggleShortlist(otherBuyer, listedId, true);
    await toggleShortlist(thirdBuyer, listedId, true);
    // A fourth row, on a different supplier, so the count is not just "all rows".
    await toggleShortlist(buyer, secondListedId, true);

    expect(await shortlistCount(listedId)).toBe(3);
    expect(await shortlistCount(listedId)).toBe(await rowsFor(listedId));
    expect(await shortlistCount(secondListedId)).toBe(1);

    await toggleShortlist(otherBuyer, listedId, false);
    expect(await shortlistCount(listedId)).toBe(2);
    expect(await shortlistCount(listedId)).toBe(await rowsFor(listedId));
  });

  it("counts a buyer once however many times they press", async () => {
    await toggleShortlist(buyer, listedId, true);
    await toggleShortlist(buyer, listedId, true);
    await toggleShortlist(buyer, listedId, true);

    expect(await shortlistCount(listedId)).toBe(1);
  });
});
