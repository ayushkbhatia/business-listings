import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import type { Actor } from "@/lib/auth/roles";
import {
  attachPhoto,
  deletePhoto,
  photoBoardFor,
  reorderPhotos,
  setCover,
  NON_LOGO_TARGET,
  PHOTO_TARGET,
} from "@/lib/photos/service";
import { WEIGHTS } from "@/lib/metrics/profile-strength";

/**
 * Board 8b's service, against a real database.
 *
 * Four things here need a database and each is a rule the screen depends on:
 *
 *   1. **Exactly one cover.** It is a `kind`, enforced by a transaction and by a
 *      partial unique index behind it. A test that only called `setCover` once
 *      would never see the demote.
 *   2. **The first photograph is the cover.** Without it a storefront has no
 *      hero until somebody thinks to choose one, which nobody does.
 *   3. **Removing the cover promotes the next.** Otherwise deleting one
 *      photograph silently takes the storefront's hero with it.
 *   4. **Count and gate are different things.** Five photographs of which three
 *      are the logo reaches the count and does not finish the task, and §2 is
 *      explicit that the non-logo rule scores nothing of its own.
 */

const PREFIX = "photos-test-";
const OWNER_NAME = "Photos Fixture Owner";

let businessId: string;
let actor: Actor;

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: OWNER_NAME } });
}

/**
 * A row written the way the service writes one.
 *
 * The bytes never exist: this suite is about what the rows mean, and Storage is
 * a separate system with its own test. `storagePath` still starts with the
 * business id, because `attachPhoto` re-checks that and a fixture that skipped
 * it would pass a check the product does not.
 */
async function add(name: string, slotKey: string | null = null) {
  return attachPhoto(actor, businessId, {
    path: `${businessId}/gallery/${name}`,
    slotKey,
    bytes: 90_000,
    width: 1600,
    height: 1200,
    filename: name,
  });
}

beforeAll(async () => {
  await removeFixtures();

  const stamp = Date.now().toString(36);
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  const business = await prisma.business.create({
    data: {
      tradeName: `Photos Fixture ${stamp}`,
      displayName: `Photos Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-PH-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: "free",
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
    },
    select: { id: true },
  });
  businessId = business.id;

  const owner = await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: OWNER_NAME,
      roles: ["seller_owner"],
      businessId,
    },
    select: { id: true },
  });
  actor = { id: owner.id, roles: ["seller_owner"], businessId };
});

beforeEach(async () => {
  await prisma.media.deleteMany({ where: { businessId } });
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("the cover", () => {
  it("is the first photograph, without anybody choosing one", async () => {
    await add("one.webp");
    await add("two.webp");

    const board = await photoBoardFor(businessId);
    expect(board.items.map((item) => item.isCover)).toEqual([true, false]);
  });

  it("moves, and there is never a second one", async () => {
    await add("one.webp");
    await add("two.webp");
    const before = await photoBoardFor(businessId);
    const second = before.items[1]!;

    expect(await setCover(actor, businessId, second.id)).toEqual({ ok: true });

    const after = await photoBoardFor(businessId);
    expect(after.items.filter((item) => item.isCover)).toHaveLength(1);
    expect(after.items.find((item) => item.isCover)?.id).toBe(second.id);
    // The demote is what the partial unique index is behind. Asserted at the
    // table, because the board would look right with two rows marked cover.
    expect(await prisma.media.count({ where: { businessId, kind: "cover" } })).toBe(1);
  });

  it("promotes the next photograph when it is removed", async () => {
    await add("one.webp");
    await add("two.webp");
    const before = await photoBoardFor(businessId);
    const cover = before.items.find((item) => item.isCover)!;

    await deletePhoto(actor, businessId, cover.id);

    const after = await photoBoardFor(businessId);
    expect(after.items).toHaveLength(1);
    // A listing that loses its hero because a seller tidied up is a storefront
    // that quietly got worse.
    expect(after.items[0]?.isCover).toBe(true);
  });

  it("leaves nothing behind when the last one goes", async () => {
    await add("only.webp");
    const board = await photoBoardFor(businessId);
    await deletePhoto(actor, businessId, board.items[0]!.id);

    expect((await photoBoardFor(businessId)).items).toHaveLength(0);
  });
});

describe("order", () => {
  it("is written, which nothing in this product had ever done", async () => {
    /*
       `Media.sortOrder` has been ordered by since handoff 1 and written only by
       the seed, so every real seller's photographs tied at zero and came back
       in insertion order by accident.
    */
    await add("a.webp");
    await add("b.webp");
    await add("c.webp");
    const before = await photoBoardFor(businessId);
    const ids = before.items.map((item) => item.id);

    await reorderPhotos(actor, businessId, [ids[2]!, ids[0]!, ids[1]!]);

    const after = await photoBoardFor(businessId);
    expect(after.items.map((item) => item.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(after.items.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });

  it("applies what it can when an id has gone", async () => {
    // A stale tab posting an order containing a photograph somebody has since
    // deleted should still get its remaining order applied.
    await add("a.webp");
    await add("b.webp");
    const ids = (await photoBoardFor(businessId)).items.map((item) => item.id);

    const result = await reorderPhotos(actor, businessId, [ids[1]!, "no-such-id", ids[0]!]);

    expect(result).toEqual({ ok: true });
    expect((await photoBoardFor(businessId)).items.map((item) => item.id)).toEqual([
      ids[1],
      ids[0],
    ]);
  });
});

describe("what counts, and what gates", () => {
  it("scores pro-rata on count, from the lever's own weight", async () => {
    await add("a.webp");
    await add("b.webp");
    await add("c.webp");

    const board = await photoBoardFor(businessId);
    expect(board.count).toBe(3);
    // 3/5 of the photographs lever, floored. Read from WEIGHTS rather than
    // restated, so the chip and the hub's meter cannot drift apart.
    expect(board.pointsSoFar).toBe(Math.floor((3 / PHOTO_TARGET) * WEIGHTS.photos));
    expect(board.done).toBe(false);
  });

  it("reaches the count and still does not finish, on logos alone", async () => {
    /*
       §2: the non-logo rule gates completion and scores nothing. Five copies of
       a logo answer none of the question photographs are there to answer, and
       the screen explains the rule at the point it blocks rather than before.
    */
    for (let index = 0; index < PHOTO_TARGET; index += 1) {
      await prisma.media.create({
        data: {
          businessId,
          kind: "logo",
          storagePath: `${businessId}/logo/logo-${index}.webp`,
          sortOrder: index,
        },
      });
    }

    const board = await photoBoardFor(businessId);
    expect(board.count).toBe(PHOTO_TARGET);
    expect(board.nonLogo).toBe(0);
    expect(board.done).toBe(false);
    // The count is full, so the points are full. Only completion is withheld.
    expect(board.pointsSoFar).toBe(WEIGHTS.photos);
  });

  it("finishes once enough of them are not the logo", async () => {
    await prisma.media.create({
      data: { businessId, kind: "logo", storagePath: `${businessId}/logo/logo.webp` },
    });
    for (let index = 0; index < NON_LOGO_TARGET + 1; index += 1) {
      await add(`real-${index}.webp`);
    }

    const board = await photoBoardFor(businessId);
    expect(board.count).toBe(PHOTO_TARGET);
    expect(board.nonLogo).toBeGreaterThanOrEqual(NON_LOGO_TARGET);
    expect(board.done).toBe(true);
  });
});

describe("the slot is a label, never a claim about the picture", () => {
  it("keeps the slot key it was filed under, and none otherwise", async () => {
    await add("warehouse.webp", "warehouse");
    await add("IMG_4471.webp");

    const board = await photoBoardFor(businessId);
    expect(board.items[0]?.slotKey).toBe("warehouse");
    // Unslotted keeps its filename and gets no line at all — there is no
    // content recognition in this build, so there is nothing to say about it.
    expect(board.items[1]?.slotKey).toBeNull();
    expect(board.items[1]?.filename).toBe("IMG_4471.webp");
  });

  it("files an unrecognised slot as unslotted rather than storing it", async () => {
    await add("odd.webp", "not-a-real-slot");
    expect((await photoBoardFor(businessId)).items[0]?.slotKey).toBeNull();
  });
});

describe("somebody else's listing", () => {
  it("is refused, even holding a seller role of their own", async () => {
    // A seat is scoped to one business. Holding `seller_owner` somewhere else
    // is not permission here, and the capability check alone would let it pass.
    const stranger: Actor = { id: actor.id, roles: ["seller_owner"], businessId: "someone-else" };

    expect(
      await attachPhoto(stranger, businessId, {
        path: `${businessId}/gallery/x.webp`,
        bytes: 1,
        width: 1600,
        height: 1200,
        filename: "x.webp",
      }),
    ).toEqual({ ok: false, error: expect.any(String) });

    const mine = await add("mine.webp");
    expect(mine).toEqual({ ok: true });
    const board = await photoBoardFor(businessId);
    expect(await setCover(stranger, businessId, board.items[0]!.id)).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(await deletePhoto(stranger, businessId, board.items[0]!.id)).toEqual({
      ok: false,
      error: expect.any(String),
    });
    expect(await reorderPhotos(stranger, businessId, [board.items[0]!.id])).toEqual({
      ok: false,
      error: expect.any(String),
    });
    // Nothing they attempted changed anything.
    expect((await photoBoardFor(businessId)).items).toHaveLength(1);
  });

  it("refuses a path outside the seller's own folder", async () => {
    // The signature said it was fine; the path still comes back through the
    // browser, so it is checked again rather than trusted.
    const result = await attachPhoto(actor, businessId, {
      path: "some-other-business/gallery/x.webp",
      bytes: 1,
      width: 1600,
      height: 1200,
      filename: "x.webp",
    });
    expect(result).toEqual({ ok: false, error: expect.any(String) });
  });
});
