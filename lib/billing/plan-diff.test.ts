import { describe, expect, it } from "vitest";
import { diffPlanEdits, fingerprintOf, type PlanConfigState } from "./plan-diff";
import { PLAN_FIELDS, type PlanEditableField } from "@/lib/plan/plan-fields";

/**
 * Board 12e `B7` — the middle step, tested without a database.
 *
 * The diff is what an ops lead reads before committing a change that moves
 * every account on a plan, so what it counts and what it calls a reduction are
 * the load-bearing parts. Two of them are easy to get subtly wrong and are
 * pinned here: **a price is not a cap**, so a repricing must not offer to
 * rewrite entitlement snapshots, and **null is unlimited**, so a number
 * replacing a null is a reduction rather than a rise.
 */

type Over = Partial<Omit<PlanConfigState, "values">> & {
  id: string;
  values?: Partial<Record<PlanEditableField, number | boolean | null>>;
};

function state(over: Over): PlanConfigState {
  const values = {} as Record<PlanEditableField, number | boolean | null>;
  for (const spec of PLAN_FIELDS) {
    values[spec.field] = spec.kind === "switch" ? false : 10;
  }
  return {
    name: over.id,
    onSale: true,
    subscriptions: 0,
    grandfathered: 0,
    ...over,
    id: over.id,
    // After the spread, never inside it: a partial `values` in `over` would
    // otherwise replace the whole record and leave every other field undefined,
    // which is a fixture that quietly stops testing what it names.
    values: { ...values, ...(over.values ?? {}) },
  };
}

const BASIC = state({ id: "basic", name: "Basic", subscriptions: 12, grandfathered: 4 });
const PRO = state({
  id: "pro",
  name: "Pro",
  subscriptions: 30,
  values: { productLimit: null, monthlyPriceAed: 899 },
});
const PLANS = [BASIC, PRO];

describe("what a plan-config change would move", () => {
  it("names only the fields that actually moved", () => {
    const set = diffPlanEdits(PLANS, [
      { planId: "basic", values: { productLimit: 10, photoLimit: 40 } },
    ]);
    expect(set.changes).toHaveLength(1);
    expect(set.changes[0]!.fields.map((field) => field.field)).toEqual(["photoLimit"]);
  });

  it("says nothing about a plan the edit does not mention", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "basic", values: { photoLimit: 41 } }]);
    expect(set.changes.map((change) => change.planId)).toEqual(["basic"]);
  });

  it("ignores a field the form did not post rather than reading it as null", () => {
    /*
       The defect this guards: a narrower form posting three cells, and the diff
       reading the other eleven as "set to unlimited". A cap lifted by omission
       is the one that never appears in the reason.
    */
    const set = diffPlanEdits(PLANS, [{ planId: "pro", values: { photoLimit: 11 } }]);
    expect(set.changes[0]!.fields).toHaveLength(1);
  });

  it("counts a number replacing unlimited as a reduction", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "pro", values: { productLimit: 500 } }]);
    expect(set.changes[0]!.fields[0]!.reduction).toBe(true);
    expect(set.reduces).toBe(true);
  });

  it("does not count lifting a cap as a reduction", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "basic", values: { productLimit: null } }]);
    expect(set.changes[0]!.fields[0]!.reduction).toBe(false);
    expect(set.reduces).toBe(false);
  });

  it("counts withdrawing an entitlement as a reduction", () => {
    const set = diffPlanEdits(
      [state({ id: "basic", values: { analytics: true } })],
      [{ planId: "basic", values: { analytics: false } }],
    );
    expect(set.changes[0]!.fields[0]!.reduction).toBe(true);
  });
});

describe("a price is not a cap", () => {
  it("counts the accounts it re-prices, separately from the accounts it re-caps", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "pro", values: { monthlyPriceAed: 999 } }]);
    expect(set.repriced).toBe(30);
    // Nothing for apply-to-existing to rewrite: the snapshot has never carried
    // a price, so grandfathering does not cover one.
    expect(set.capsMoved).toBe(0);
  });

  it("offers apply-to-existing only where a cap moved", () => {
    const both = diffPlanEdits(PLANS, [
      { planId: "pro", values: { monthlyPriceAed: 999 } },
      { planId: "basic", values: { productLimit: 3 } },
    ]);
    expect(both.repriced).toBe(30);
    expect(both.capsMoved).toBe(12);
    expect(both.accounts).toBe(42);
  });

  it("treats dropping the annual term as a repricing", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "pro", values: { annualMonthsCharged: null } }]);
    expect(set.changes[0]!.repricing).toBe(true);
    expect(set.capsMoved).toBe(0);
  });

  it("does not call a rise in price a reduction", () => {
    // A cap going down costs the seller something they had. A price going up is
    // a commercial decision the amber grandfathering note has nothing to say
    // about, and painting it as a cut would make the note noise.
    const set = diffPlanEdits(PLANS, [{ planId: "pro", values: { monthlyPriceAed: 999 } }]);
    expect(set.reduces).toBe(false);
  });
});

describe("withdrawal rides the same change set", () => {
  it("is a field on the diff, not a cap", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "basic", values: {}, onSale: false }]);
    expect(set.changes[0]!.fields[0]!.field).toBe("onSale");
    // Nothing to apply to existing accounts: withdrawal changes what can be
    // chosen, never what anybody already on the plan holds.
    expect(set.capsMoved).toBe(0);
  });

  it("says nothing when the plan is already on sale", () => {
    const set = diffPlanEdits(PLANS, [{ planId: "basic", values: {}, onSale: true }]);
    expect(set.changes).toHaveLength(0);
  });
});

describe("the fingerprint", () => {
  it("is the before values, so a commit can tell whether they moved", () => {
    const edits = [{ planId: "basic", values: { productLimit: 3 } }];
    const before = fingerprintOf(PLANS, edits);

    const moved = [state({ id: "basic", values: { productLimit: 99 } }), PRO];
    expect(fingerprintOf(moved, edits)).not.toBe(before);
  });

  it("ignores a field this change set is not about", () => {
    /*
       Two ops leads editing different rows should not block each other. The
       comparison is against the fields the set names, so an unrelated edit
       elsewhere on the table leaves this one committable.
    */
    const edits = [{ planId: "basic", values: { productLimit: 3 } }];
    const elsewhere = [state({ id: "basic", values: { photoLimit: 99 } }), PRO];
    expect(fingerprintOf(elsewhere, edits)).toBe(fingerprintOf(PLANS, edits));
  });

  it("does not depend on the order the plans were posted in", () => {
    const one = fingerprintOf(PLANS, [
      { planId: "pro", values: { photoLimit: 1 } },
      { planId: "basic", values: { photoLimit: 2 } },
    ]);
    const other = fingerprintOf(PLANS, [
      { planId: "basic", values: { photoLimit: 2 } },
      { planId: "pro", values: { photoLimit: 1 } },
    ]);
    expect(one).toBe(other);
  });
});
