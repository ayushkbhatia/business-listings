import { describe, expect, it } from "vitest";
import {
  BOTH_WEIGHTS,
  CREDENTIAL_TARGET,
  SERVICES_TARGET,
  SERVICES_WEIGHTS,
  STRONG_ENOUGH,
  WEIGHTS,
  profileStrength,
  strengthItems,
  weightsFor,
  type ProfileFacts,
} from "@/lib/metrics/profile-strength";
import { BOTH_TASKS, SERVICES_TASKS, SETUP_TASKS, setupBoard, tasksFor } from "./tasks";

/**
 * Board `8a-s` — the same hub with the weighting turned upside down.
 *
 * The arithmetic is the whole board, and two properties matter more than any
 * individual number: the table has to sum to a hundred, and everything the
 * seller can actually finish has to reach the threshold. A meter where a seller
 * does every task on offer and is still short with nothing named is the state
 * the site-visit cut was made to remove, and it is easy to reintroduce with one
 * weight change.
 */

const EMPTY: ProfileFacts = {
  hasDescription: false,
  hasLogo: false,
  hasCover: false,
  additionalCategories: 0,
  hasEstablishedYear: false,
  hasTeamSize: false,
  languages: 0,
  locations: 0,
  locationsWithHours: 0,
  products: 0,
  productsWithFilterableSpecs: 0,
  photos: 0,
  teamSeats: 1,
  credentials: 0,
  licenceVerified: false,
  servicesLive: 0,
  sectors: 0,
  deliveryModes: 0,
  coverageAreas: 0,
};

/** Everything a practice can do for itself. The licence is not on this list. */
const SELLER_CAN_DO: Partial<ProfileFacts> = {
  credentials: CREDENTIAL_TARGET,
  servicesLive: SERVICES_TARGET,
  hasDescription: true,
  sectors: 3,
  teamSeats: 2,
  deliveryModes: 1,
  coverageAreas: 2,
  photos: 3,
};

describe("the services weight table", () => {
  it("sums to a hundred", () => {
    expect(Object.values(SERVICES_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("leads with credentials and ends with photographs", () => {
    const ordered = Object.entries(SERVICES_WEIGHTS).sort((a, b) => b[1] - a[1]);
    expect(ordered[0]?.[0]).toBe("credentials");
    expect(SERVICES_WEIGHTS.photos).toBe(4);
    // The inversion, stated as a test: photographs are worth five times as much
    // to a parts supplier as to a practice.
    expect(WEIGHTS.photos).toBeGreaterThan(SERVICES_WEIGHTS.photos * 4);
  });

  it("puts everything the seller controls at exactly the threshold", () => {
    /*
       The property this board rests on. `licence` is the one component a seller
       cannot finish — `verificationTier` is writable only by an `ops_lead` —
       so the other six have to reach `STRONG_ENOUGH` between them, or a
       practice that does every task on the hub is short with nothing left to
       act on. 32 + 20 + 12 + 8 + 4 + 4 = 80, and the threshold is 80.
    */
    const seller = Object.entries(SERVICES_WEIGHTS)
      .filter(([key]) => key !== "licence")
      .reduce((sum, [, weight]) => sum + weight, 0);
    expect(seller).toBe(STRONG_ENOUGH);
  });

  it("scores a practice that has done everything it can at the threshold", () => {
    expect(profileStrength({ ...EMPTY, ...SELLER_CAN_DO }, "services")).toBe(STRONG_ENOUGH);
  });

  it("reaches a hundred once the licence is verified", () => {
    expect(
      profileStrength({ ...EMPTY, ...SELLER_CAN_DO, licenceVerified: true }, "services"),
    ).toBe(100);
  });

  it("scores an empty practice at nothing", () => {
    expect(profileStrength(EMPTY, "services")).toBe(0);
  });
});

describe("what a seller of goods is measured against", () => {
  it("is the table it always was, for `goods` and for `unset` alike", () => {
    // 123 live businesses hold `unset`, and the column shipped with no
    // backfill. A number a seller has already seen must not move.
    expect(weightsFor("unset")).toBe(WEIGHTS);
    expect(weightsFor("goods")).toBe(WEIGHTS);
  });

  it("ignores every services fact", () => {
    const before = profileStrength(EMPTY, "goods");
    const after = profileStrength({ ...EMPTY, ...SELLER_CAN_DO, hasDescription: false }, "goods");
    // Photographs and the second seat are goods levers too, so they do move it.
    // Credentials, services, sectors and coverage do not.
    expect(
      profileStrength(
        { ...EMPTY, credentials: 5, servicesLive: 9, sectors: 4, coverageAreas: 7 },
        "goods",
      ),
    ).toBe(before);
    expect(after).toBeGreaterThan(before);
  });
});

describe("a seller who is both — B9", () => {
  it("renormalises one table rather than summing two", () => {
    const total = Object.values(BOTH_WEIGHTS).reduce((a, b) => a + b, 0);
    // Summing the two tables gives a denominator of 176 and a meter that never
    // fills; `profileStrength` divides by the total, so the score is a
    // percentage whatever the raw weights add to.
    expect(total).toBeGreaterThan(100);
    expect(profileStrength({ ...EMPTY, ...SELLER_CAN_DO }, "both")).toBeLessThan(100);
  });

  it("takes the larger weight where a component is in both tables", () => {
    expect(BOTH_WEIGHTS["photos"]).toBe(Math.max(WEIGHTS.photos, SERVICES_WEIGHTS.photos));
    expect(BOTH_WEIGHTS["team"]).toBe(Math.max(WEIGHTS.team, SERVICES_WEIGHTS.team));
    expect(BOTH_WEIGHTS["credentials"]).toBe(SERVICES_WEIGHTS.credentials);
    expect(BOTH_WEIGHTS["catalogue"]).toBe(WEIGHTS.catalogue);
  });

  it("reaches a hundred when a seller does all of both", () => {
    expect(
      profileStrength(
        {
          ...EMPTY,
          ...SELLER_CAN_DO,
          licenceVerified: true,
          hasLogo: true,
          hasCover: true,
          hasEstablishedYear: true,
          hasTeamSize: true,
          languages: 2,
          additionalCategories: 2,
          products: 10,
          productsWithFilterableSpecs: 10,
          photos: 10,
        },
        "both",
      ),
    ).toBe(100);
  });
});

describe("the meter's rows", () => {
  it("still sums to a hundred on the services table", () => {
    // Criterion 13, one table over: the named levers and the current
    // percentage close the gap exactly, whichever table is in play.
    for (const facts of [EMPTY, { ...EMPTY, ...SELLER_CAN_DO }]) {
      const items = strengthItems(facts, "services");
      const total = items.reduce((sum, item) => sum + item.earned + item.remaining, 0);
      expect(total).toBe(100);
      expect(items.reduce((sum, item) => sum + item.earned, 0)).toBe(
        profileStrength(facts, "services"),
      );
    }
  });
});

describe("the cards", () => {
  it("offers four for a practice, three for a trader and five for both", () => {
    expect(tasksFor("services")).toEqual([...SERVICES_TASKS]);
    expect(tasksFor("goods")).toEqual([...SETUP_TASKS]);
    expect(tasksFor("unset")).toEqual([...SETUP_TASKS]);
    expect(tasksFor("both")).toEqual([...BOTH_TASKS]);
    expect(SERVICES_TASKS).toHaveLength(4);
  });

  it("orders them by weight, credentials first and photographs last", () => {
    expect(SERVICES_TASKS[0]).toBe("credentials");
    expect(SERVICES_TASKS.at(-1)).toBe("photos");
  });

  const board = (facts: Partial<ProfileFacts> = {}) => {
    const merged = { ...EMPTY, ...facts };
    return setupBoard({
      kind: "services",
      photos: merged.photos,
      products: merged.products,
      seats: merged.teamSeats,
      credentials: merged.credentials,
      servicesLive: merged.servicesLive,
      invitesSent: 0,
      items: strengthItems(merged, "services"),
    });
  };

  it("estimates fifteen minutes across the four — criterion 10", () => {
    // The hero says "about fifteen minutes" and the cards have to add to it.
    expect(board().openMinutes).toBe(15);
    expect(board().openCount).toBe(4);
  });

  it("awards task 2 pro-rata below three services — B4, criterion 5", () => {
    /*
       Two of three live banks 13 of the 20, rounded down. The card is not done,
       and the badge says what is left rather than what the component is worth.
    */
    const two = board({ servicesLive: 2 });
    const services = two.tasks.find((task) => task.id === "services");
    expect(services?.done).toBe(false);
    expect(services?.progress).toEqual({ got: 2, target: 3 });

    const banked = two.levers.find((lever) => lever.key === "services");
    expect(banked?.earned).toBe(13);
    expect(banked?.remaining).toBe(7);
    expect(services?.points).toBe(7);
  });

  it("finishes task 2 at three", () => {
    const three = board({ servicesLive: 3 });
    const services = three.tasks.find((task) => task.id === "services");
    expect(services?.done).toBe(true);
    expect(services?.points).toBe(0);
  });

  it("asks for three photographs rather than ten", () => {
    // The same key with a different target. Holding a practice to a parts
    // supplier's gallery would be the goods number wearing the services copy.
    expect(board({ photos: 3 }).tasks.find((task) => task.id === "photos")?.done).toBe(true);
    expect(board({ photos: 2 }).tasks.find((task) => task.id === "photos")?.done).toBe(false);
  });

  it("finishes credentials on two on file, without asking for a verification", () => {
    /*
       The board's completion rule says "at least one verified", and this
       product has no such state: board 3e splits its screen so a document the
       seller uploaded says `On file` and never `Verified`. A task nobody can
       finish is the defect the site-visit cut removed.
    */
    expect(board({ credentials: 2 }).tasks.find((task) => task.id === "credentials")?.done).toBe(
      true,
    );
  });

  it("names the licence as a lever and never as a card", () => {
    const state = board();
    expect(state.tasks.some((task) => task.id === ("licence" as never))).toBe(false);
    expect(state.levers.find((lever) => lever.key === "licence")?.hasTask).toBe(false);
  });

  it("says nothing is left once all four are done", () => {
    const done = board({ credentials: 2, servicesLive: 3, teamSeats: 2, photos: 3 });
    expect(done.openCount).toBe(0);
    expect(done.doneCount).toBe(4);
  });
});
