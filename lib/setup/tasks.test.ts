import { describe, expect, it } from "vitest";
import {
  LEVERS_WITHOUT_TASK,
  setupBoard,
  dubaiDayStart,
  type SetupTaskFacts,
  type SetupTaskId,
} from "./tasks";
import { profileStrength, strengthItems, type ProfileFacts } from "@/lib/metrics/profile-strength";
import { PHOTO_MINUTES } from "@/lib/photos/targets";

/**
 * The chips are the reason this module is pure.
 *
 * Board 8a draws "+12%" on a card, and a constant there is the meter lying to
 * whoever has done the most work: a supplier with three photographs has fewer
 * points left in photographs than one with none. These assertions are about
 * that arithmetic being real, and about the hero heading counting the cards
 * that are actually on the page.
 */

const EMPTY: ProfileFacts = {
  hasDescription: false,
  hasLogo: false,
  hasCover: false,
  additionalCategories: 0,
  hasEstablishedYear: false,
  hasTeamSize: false,
  languages: 0,
  locations: 1,
  locationsWithHours: 0,
  products: 0,
  productsWithFilterableSpecs: 0,
  photos: 0,
  teamSeats: 1,
};

function board(profile: Partial<ProfileFacts> = {}, invitesSent = 0) {
  const facts: ProfileFacts = { ...EMPTY, ...profile };
  const input: SetupTaskFacts = {
    photos: facts.photos,
    products: facts.products,
    seats: facts.teamSeats,
    invitesSent,
    items: strengthItems(facts),
  };
  return setupBoard(input);
}

function chip(profile: Partial<ProfileFacts>, id: SetupTaskId): number {
  return board(profile).tasks.find((task) => task.id === id)!.points;
}

describe("the chip is this seller's own arithmetic", () => {
  it("offers less for a job half done than for one not started", () => {
    // Three photographs of ten already earn six of the twenty points, so the
    // card can honestly promise fourteen and not twenty.
    expect(chip({ photos: 3 }, "photos")).toBeLessThan(chip({ photos: 0 }, "photos"));
    expect(chip({ products: 5 }, "products")).toBeLessThan(chip({ products: 0 }, "products"));
  });

  it("promises nothing for a card that is done", () => {
    expect(chip({ photos: 10, hasLogo: true, hasCover: true }, "photos")).toBe(0);
    expect(chip({ products: 10 }, "products")).toBe(0);
    expect(chip({ teamSeats: 2 }, "team")).toBe(0);
  });

  it("never offers more than the lever holds", () => {
    for (const photos of [0, 1, 3, 5, 9, 40]) {
      expect(chip({ photos }, "photos")).toBeLessThanOrEqual(20);
    }
  });
});

describe("the hero counts what is on the page", () => {
  it("matches the open rows on both the count and the minutes", () => {
    const state = board({ photos: 8, teamSeats: 2 });
    const open = state.tasks.filter((task) => !task.done);

    expect(state.openCount).toBe(open.length);
    expect(state.openMinutes).toBe(open.reduce((total, task) => total + task.minutes, 0));
    expect(state.doneCount).toBe(state.tasks.length - open.length);
  });

  it("reaches zero open with nothing left to say", () => {
    /*
       Reachable at all, which it was not until site visits were withdrawn. The
       fourth task closed on our scheduling rather than the seller's work, so
       `openCount` never hit zero and the hub's completion redirect never fired
       however much a supplier did.
    */
    const state = board({ photos: 10, hasLogo: true, hasCover: true, products: 10, teamSeats: 2 });
    expect(state.openCount).toBe(0);
    expect(state.openMinutes).toBe(0);
    expect(state.doneCount).toBe(3);
  });

  it("counts every open task on a cold start, and adds up their own estimates", () => {
    /*
       The photographs estimate is read from `lib/photos/targets.ts` rather than
       written again here — board 8b states it to the same seller minutes later,
       and a test that hardcoded it would go green while the two screens
       disagreed. The other two are still literals because nothing else states
       them yet.
    */
    const state = board();
    expect(state.openCount).toBe(3);
    expect(state.openMinutes).toBe(PHOTO_MINUTES + 25 + 3);
  });
});

describe("the levers close the gap", () => {
  it("sums earned and remaining to exactly a hundred, at every stage", () => {
    /*
       Criterion 13, from this side of it. A seller who finishes every card is
       at fifty points; if the levers did not add up, the other fifty would be
       unreachable and unnamed, which is the trick a completeness meter must
       never play.
    */
    const stages: Partial<ProfileFacts>[] = [
      {},
      { photos: 3 },
      { photos: 10, hasLogo: true, hasCover: true, products: 10, teamSeats: 2 },
      {
        hasDescription: true,
        hasEstablishedYear: true,
        hasTeamSize: true,
        languages: 2,
        additionalCategories: 2,
        hasLogo: true,
        hasCover: true,
        photos: 12,
        products: 10,
        productsWithFilterableSpecs: 10,
        teamSeats: 3,
      },
    ];

    for (const stage of stages) {
      const state = board(stage);
      const total = state.levers.reduce((sum, lever) => sum + lever.earned + lever.remaining, 0);
      expect(total, JSON.stringify(stage)).toBe(100);

      // And what is earned is the meter, not a second opinion of it.
      const earned = state.levers.reduce((sum, lever) => sum + lever.earned, 0);
      expect(earned, JSON.stringify(stage)).toBe(profileStrength({ ...EMPTY, ...stage }));
    }
  });

  it("names the two nobody has a card for", () => {
    const state = board();
    const uncarded = state.levers.filter((lever) => !lever.hasTask).map((lever) => lever.key);
    expect(uncarded).toEqual([...LEVERS_WITHOUT_TASK]);
  });

  it("gives every lever a total that is its whole weight", () => {
    const state = board({ photos: 4 });
    for (const lever of state.levers) {
      expect(lever.total).toBe(lever.earned + lever.remaining);
    }
    expect(state.levers.find((lever) => lever.key === "photos")!.total).toBe(20);
  });
});

describe("the day a view is counted against", () => {
  it("buckets an instant into the Dubai day, not the UTC one", () => {
    // 22:00 UTC is 02:00 the next morning in Dubai, and the rail counts from
    // the day the supplier had.
    expect(dubaiDayStart(new Date("2026-09-03T22:00:00.000Z")).toISOString()).toBe(
      "2026-09-04T00:00:00.000Z",
    );
    expect(dubaiDayStart(new Date("2026-09-04T06:00:00.000Z")).toISOString()).toBe(
      "2026-09-04T00:00:00.000Z",
    );
  });
});

describe("the team task ticks on send", () => {
  it("counts an outstanding invitation towards the target", () => {
    /*
       Board 8d §5. The seller cannot make a colleague click a link, and a task
       held open by somebody else's inaction is one they learn to ignore. The
       eight points still wait for an active seat, so the checkbox and the meter
       legitimately disagree until the invitation is accepted — which is why the
       invite screen states it in a line.
    */
    const withSeatOnly = board().tasks.find((task) => task.id === "team");
    expect(withSeatOnly?.done).toBe(false);

    const withInvite = board({}, 1).tasks.find((task) => task.id === "team");
    expect(withInvite?.done).toBe(true);
    // The points are the lever's, and the lever still wants a seat.
    expect(withInvite?.points).toBe(0);
  });
});
