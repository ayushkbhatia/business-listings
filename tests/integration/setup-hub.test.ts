import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { getOverview } from "@/lib/db/queries/overview";
import { readEnquiryLift } from "@/lib/metrics/enquiry-lift";
import { STRONG_ENOUGH } from "@/lib/metrics/profile-strength";
import { setupHubState } from "@/lib/setup/service";

/**
 * Board 8a's hub, against a real database.
 *
 * Three things here cannot be reached by a unit test, and each of them has
 * already been got wrong somewhere in this repo:
 *
 *   1. **The cold start is a designed state.** A listing with no photographs, no
 *      products and one seat is what every supplier has on their first visit,
 *      and the page has to read honest rather than broken. Every count is zero
 *      and every count says so.
 *   2. **The meter moves with the work.** `Business.profileStrength` is written
 *      by the nightly job and by nothing else, so reading the stored column here
 *      would show a seller the same number after they had just done something.
 *      This asserts the recompute, against a fixture whose stored column is
 *      still null.
 *   3. **The rail and the overview count the same enquiries.** Two filters exist
 *      and they disagree by design; the hub says "waiting for a reply", which is
 *      `getOverview`'s, not the sidebar badge's.
 *
 * `readEnquiryLift` rather than `getEnquiryLift`: `unstable_cache` needs Next's
 * incremental cache and throws outside a request. Same split as the home and
 * search query tests.
 */

const PREFIX = "setup-hub-test-";
const OWNER_NAME = "Setup Hub Fixture Owner";

let businessId: string;

async function removeFixtures() {
  await prisma.business.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await prisma.user.deleteMany({ where: { fullName: OWNER_NAME } });
}

/** The hub as the page reads it, with the uncached lift. */
function hub() {
  return setupHubState(businessId, readEnquiryLift);
}

beforeAll(async () => {
  await removeFixtures();

  const stamp = Date.now().toString(36);
  const categoryId = (
    await prisma.category.findFirstOrThrow({ where: { parentId: null }, select: { id: true } })
  ).id;

  /*
     Its own listing. A fixture that reaches into seeded data is a fixture that
     breaks somebody else's test at a distance, and the cold start is the whole
     point of this one — a borrowed supplier already has photographs.
  */
  const business = await prisma.business.create({
    data: {
      tradeName: `Setup Hub Fixture ${stamp}`,
      displayName: `Setup Hub Fixture ${stamp}`,
      slug: `${PREFIX}${stamp}`,
      licenceNumber: `DED-SH-${stamp.slice(-6)}`,
      licenceAuthority: "DED",
      licenceExpiry: new Date(Date.now() + 300 * 86_400_000),
      primaryCategoryId: categoryId,
      claimStatus: "claimed",
      planId: "free",
      // Live, on Free, before the plan screen — the state `goLive` leaves a
      // supplier in, and the state the hub is written for.
      publishedAt: new Date(Date.now() - 2 * 86_400_000),
    },
    select: { id: true },
  });
  businessId = business.id;

  await prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      fullName: OWNER_NAME,
      roles: ["seller_owner"],
      businessId,
    },
  });
});

afterAll(async () => {
  await removeFixtures();
  await prisma.$disconnect();
});

describe("the cold start reads honest rather than broken", () => {
  it("puts every rail count at zero rather than leaving it absent", async () => {
    const state = await hub();
    expect(state).not.toBeNull();

    // Zero is a designed state here. The panel says "No views yet" rather than
    // hiding, because a hidden zero makes the whole panel unbelievable.
    expect(state!.rail).toEqual({ viewsSinceLive: 0, shortlists: 0, openEnquiries: 0 });
    expect(state!.live).toBe(true);
    expect(state!.suspended).toBe(false);
    expect(state!.publishedAt).not.toBeNull();
  });

  it("scores a listing with nothing on it at nothing", async () => {
    const state = await hub();
    expect(state!.strength).toBe(0);
    expect(state!.threshold).toBe(STRONG_ENOUGH);
  });

  it("offers every task, and the hero counts them", async () => {
    /*
       Three since site visits were withdrawn. The fourth was the site visit,
       and it was the reason this hub could never be finished: it closed on our
       scheduling rather than the seller's work, so `openCount` never reached
       zero however much a supplier did.
    */
    const state = await hub();

    expect(state!.openCount).toBe(3);
    expect(state!.doneCount).toBe(0);
    expect(state!.openMinutes).toBe(
      state!.tasks.reduce((total, task) => total + task.minutes, 0),
    );
    for (const task of state!.tasks) {
      expect(task.done, task.id).toBe(false);
      expect(task.progress.got, task.id).toBeLessThan(task.progress.target);
    }

    /*
       The owner is a seat, so the team card opens at one of two rather than at
       nothing. A card that read "0 of 2" over a listing with an owner on it
       would be counting the wrong thing.
    */
    const team = state!.tasks.find((task) => task.id === "team")!;
    expect(team.progress).toEqual({ got: 1, target: 2 });
  });

  it("offers each task its whole lever, because none of it is earned yet", async () => {
    const state = await hub();
    const points = Object.fromEntries(state!.tasks.map((task) => [task.id, task.points]));

    expect(points).toEqual({ photos: 20, products: 20, team: 10 });
  });

  it("names the rest of the meter, so a hundred is reachable", async () => {
    const state = await hub();

    const total = state!.levers.reduce((sum, lever) => sum + lever.earned + lever.remaining, 0);
    expect(total).toBe(100);

    // The two nobody has a card for. Without them a seller finishes everything
    // on offer, lands on fifty, and has nothing named to do about it.
    const uncarded = state!.levers.filter((lever) => !lever.hasTask).map((lever) => lever.key);
    expect(uncarded).toEqual(["identity", "filterableSpecs"]);
  });

  it("knows the plan the seller is on", async () => {
    const state = await hub();

    expect(state!.plan).not.toBeNull();
    expect(state!.plan!.id).toBe("free");
  });

  it("promises the one nudge, because it has not been sent", async () => {
    const state = await hub();
    expect(state!.nudgeUsed).toBe(false);
    expect(state!.nudgeSentAt).toBeNull();
  });

  it("has no measured lift to report on a directory this young", async () => {
    /*
       Not an assertion that the lift is null — it is an assertion that whatever
       comes back is either a real measurement or nothing at all. The page picks
       a different sentence for each, and neither stands in for the other.
    */
    const state = await hub();
    if (state!.lift !== null) {
      expect(state!.lift.multiple).toBeGreaterThanOrEqual(1.1);
      expect(state!.lift.threshold).toBe(STRONG_ENOUGH);
    }
  });
});

describe("the meter moves with the work, in the same call", () => {
  it("drops the photographs chip and raises the strength when one is uploaded", async () => {
    const before = await hub();
    const photosBefore = before!.tasks.find((task) => task.id === "photos")!;

    const photo = await prisma.media.create({
      data: {
        kind: "gallery",
        businessId,
        storagePath: `${businessId}/gallery/setup-hub-test.jpg`,
        alt: "The trade counter",
      },
      select: { id: true },
    });

    try {
      const after = await hub();
      const photosAfter = after!.tasks.find((task) => task.id === "photos")!;

      expect(photosAfter.progress.got).toBe(photosBefore.progress.got + 1);
      // The chip is this seller's own arithmetic, so it shrinks by what they
      // have just earned rather than staying at a constant.
      expect(photosAfter.points).toBeLessThan(photosBefore.points);
      expect(after!.strength).toBeGreaterThan(before!.strength);
    } finally {
      await prisma.media.delete({ where: { id: photo.id } });
    }
  });

  it("does not read the column the nightly job owns", async () => {
    /*
       The fixture has never been through `measureProfileStrength`, so its
       stored strength is null. A hub reading that column would render a blank
       meter over a listing that has a photograph on it, and a seller who has
       just done the work and seen no change concludes the meter is decorative.
    */
    const photo = await prisma.media.create({
      data: {
        kind: "gallery",
        businessId,
        storagePath: `${businessId}/gallery/setup-hub-stored.jpg`,
      },
      select: { id: true },
    });

    try {
      const state = await hub();
      const stored = await prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { profileStrength: true },
      });

      expect(stored.profileStrength).toBeNull();
      expect(state!.strength).toBeGreaterThan(0);
    } finally {
      await prisma.media.delete({ where: { id: photo.id } });
    }
  });
});

describe("the rail and the overview count the same enquiries", () => {
  it("matches awaitingReply for a supplier that has some", async () => {
    /*
       Two filters exist and they disagree on purpose. `getNavBadges` counts
       `delivered | opened | quoted` and calls it a live lead; `getOverview`
       counts `delivered | opened` and calls it waiting on the seller. Board 8a
       says "waiting for a reply", so the hub takes the second — and if it ever
       took the first, the number on the hub would contradict the number on the
       screen the seller clicks through to.
    */
    const recipient = await prisma.enquiryRecipient.findFirstOrThrow({
      where: { state: { in: ["delivered", "opened"] } },
      select: { businessId: true },
    });

    const [state, overview] = await Promise.all([
      setupHubState(recipient.businessId, readEnquiryLift),
      getOverview(recipient.businessId),
    ]);

    expect(state).not.toBeNull();
    expect(overview).not.toBeNull();
    expect(state!.rail.openEnquiries).toBe(overview!.awaitingReply);
    expect(state!.rail.openEnquiries).toBeGreaterThan(0);
  });

  it("counts nothing for a listing nobody has enquired to", async () => {
    const [state, overview] = await Promise.all([hub(), getOverview(businessId)]);
    expect(state!.rail.openEnquiries).toBe(overview!.awaitingReply);
    expect(state!.rail.openEnquiries).toBe(0);
  });
});

describe("a listing that cannot be found", () => {
  it("returns null rather than an empty hub", async () => {
    // An empty hub would render four tasks and a zero meter over a business
    // that does not exist, which is worse than a 404.
    expect(await setupHubState("setup-hub-no-such-business", readEnquiryLift)).toBeNull();
  });
});
