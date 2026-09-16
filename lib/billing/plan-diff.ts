import {
  PLAN_FIELDS,
  planFieldSpec,
  type PlanEditableField,
  type PlanFieldSpec,
} from "@/lib/plan/plan-fields";

/**
 * What a plan-config edit would change, worked out before anything is written.
 *
 * Board 12e `B7`: *"`Apply to existing` needs a scope, a preview and a confirm.
 * Which change, how many accounts, then commit — the shape `12c` uses for
 * publishing weights."* The board drew one unticked checkbox at the foot of a
 * table where any cell can be edited: it did not say which change it applied
 * to, offered no preview of who was affected, and ticking it was a bulk
 * mutation across 1,284 accounts with no confirmation step.
 *
 * This module is the middle step. Pure, so the arithmetic that decides what an
 * ops lead is shown before they commit needs no database and is unit-tested
 * against a table of before/after rather than against a seed.
 *
 * ## The fingerprint
 *
 * A preview is a claim about numbers that were true when it was computed. Two
 * ops leads on the same screen, or one who left the tab open over lunch, would
 * otherwise commit against a row that had moved — and the diff they confirmed
 * would not be the diff they wrote. So the preview carries the *before* values
 * it was computed from, and the commit recomputes them and refuses when they
 * differ. It is a comparison, not a timer, for the same reason `12c`'s preview
 * staleness is: the row moving is the only thing that can invalidate it.
 */

/** A value any configurable plan field can hold. */
export type PlanFieldValue = number | boolean | null;

/** One plan's proposed values. Only the fields the form posted are present. */
export interface PlanEdit {
  planId: string;
  values: Partial<Record<PlanEditableField, PlanFieldValue>>;
  /**
   * Whether the plan may be bought. Absent means "leave it as it is".
   *
   * Beside the values rather than among them: withdrawal is not an entitlement,
   * it changes nothing for anybody already on the plan, and it must never reach
   * the entitlement snapshot.
   */
  onSale?: boolean;
}

/** The current state of one plan, as the diff needs to read it. */
export interface PlanConfigState {
  id: string;
  name: string;
  values: Record<PlanEditableField, PlanFieldValue>;
  onSale: boolean;
  /** Live subscriptions on this plan — the blast radius of an edit. */
  subscriptions: number;
  /** How many of those are grandfathered on different numbers. */
  grandfathered: number;
}

export interface FieldChange {
  field: PlanEditableField | "onSale";
  labelKey: PlanFieldSpec["labelKey"] | "admin.plans.row.on_sale";
  kind: PlanFieldSpec["kind"] | "switch";
  before: PlanFieldValue;
  after: PlanFieldValue;
  /** True where the new value is lower than the old one, or a grant withdrawn. */
  reduction: boolean;
}

export interface PlanChange {
  planId: string;
  planName: string;
  fields: FieldChange[];
  subscriptions: number;
  grandfathered: number;
  /**
   * True where this plan's monthly price or annual term moved.
   *
   * Its own flag because the consequence is different in kind. A cap is frozen
   * in `Subscription.entitlementSnapshot` and a seller keeps the one they
   * signed up on; a price is not in the snapshot and never has been —
   * `effectiveCaps` takes the name, the price and the ranking multiplier from
   * the live plan on purpose, because those are facts about the plan today
   * rather than about what somebody bought. So a price change reaches every
   * existing subscription at its next renewal whether or not apply-to-existing
   * is ticked, and the preview has to say so separately.
   */
  repricing: boolean;
}

export interface PlanChangeSet {
  changes: PlanChange[];
  /** Live subscriptions across every plan touched. */
  accounts: number;
  /** Live subscriptions whose charge moves at their next renewal. */
  repriced: number;
  /** Plans whose caps moved — the ones apply-to-existing would rewrite. */
  capsMoved: number;
  /**
   * Whether anything here reduces an entitlement. Grandfathering only matters
   * in that direction, and the amber note reads as noise on a rise.
   */
  reduces: boolean;
  /** The before values this set was computed from. See §The fingerprint. */
  fingerprint: string;
}

/** Fields whose movement re-prices an account rather than re-capping it. */
const PRICE_FIELDS: readonly PlanEditableField[] = ["monthlyPriceAed", "annualMonthsCharged"];

/**
 * Is `after` less than `before` for this field?
 *
 * Null is unlimited on a cap, so null → a number is always a reduction and a
 * number → null never is. On `annualMonthsCharged` null means monthly-only,
 * where the comparison inverts — dropping the year is a withdrawal of
 * something, and fewer months charged is a discount rather than a cut. Neither
 * of those is a cap, so the only thing this decides is whether the amber
 * grandfathering note is shown; it is deliberately conservative.
 */
function isReduction(field: PlanEditableField | "onSale", before: PlanFieldValue, after: PlanFieldValue): boolean {
  if (field === "onSale" || typeof before === "boolean" || typeof after === "boolean") {
    return before === true && after === false;
  }
  if (field === "monthlyPriceAed") return false;
  if (field === "annualMonthsCharged") return after === null;
  if (before === null) return after !== null;
  if (after === null) return false;
  return after < before;
}

function valuesEqual(a: PlanFieldValue, b: PlanFieldValue): boolean {
  return a === b;
}

/**
 * What these edits would change, against the plans as they are now.
 *
 * Fields the edit does not mention are left out rather than compared: the
 * matrix posts every cell it draws, but a caller with a narrower form should
 * not have every unmentioned cap read as "set to null", which is the defect
 * that lifted a storage cap on an unrelated save.
 */
export function diffPlanEdits(
  plans: readonly PlanConfigState[],
  edits: readonly PlanEdit[],
): PlanChangeSet {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const changes: PlanChange[] = [];

  for (const edit of edits) {
    const plan = byId.get(edit.planId);
    if (!plan) continue;

    const fields: FieldChange[] = [];
    for (const spec of PLAN_FIELDS) {
      if (!(spec.field in edit.values)) continue;
      const after = edit.values[spec.field] ?? null;
      const before = plan.values[spec.field];
      if (valuesEqual(before, after)) continue;
      fields.push({
        field: spec.field,
        labelKey: spec.labelKey,
        kind: spec.kind,
        before,
        after,
        reduction: isReduction(spec.field, before, after),
      });
    }

    if (edit.onSale !== undefined && edit.onSale !== plan.onSale) {
      fields.push({
        field: "onSale",
        labelKey: "admin.plans.row.on_sale",
        kind: "switch",
        before: plan.onSale,
        after: edit.onSale,
        reduction: !edit.onSale,
      });
    }

    if (fields.length === 0) continue;

    changes.push({
      planId: plan.id,
      planName: plan.name,
      fields,
      subscriptions: plan.subscriptions,
      grandfathered: plan.grandfathered,
      repricing: fields.some((change) => PRICE_FIELDS.includes(change.field as PlanEditableField)),
    });
  }

  /*
     A cap moving is what apply-to-existing acts on. `onSale` is not a cap and
     neither is a price, so a change set that only withdraws a plan from sale
     offers no tick box — there would be nothing for it to rewrite.
  */
  const capChanges = changes.filter((change) =>
    change.fields.some(
      (field) =>
        field.field !== "onSale" && !PRICE_FIELDS.includes(field.field as PlanEditableField),
    ),
  );

  return {
    changes,
    accounts: changes.reduce((total, change) => total + change.subscriptions, 0),
    repriced: changes
      .filter((change) => change.repricing)
      .reduce((total, change) => total + change.subscriptions, 0),
    capsMoved: capChanges.reduce((total, change) => total + change.subscriptions, 0),
    reduces: changes.some((change) => change.fields.some((field) => field.reduction)),
    fingerprint: fingerprintOf(plans, edits),
  };
}

/**
 * The before values these edits were computed against, as a canonical string.
 *
 * Plain text rather than a hash: it is at most a few hundred characters, it
 * costs no crypto import in a module that has to stay pure, and when a commit
 * is refused the two strings are the diff somebody can read.
 */
export function fingerprintOf(
  plans: readonly PlanConfigState[],
  edits: readonly PlanEdit[],
): string {
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const parts: string[] = [];

  for (const edit of [...edits].sort((a, b) => a.planId.localeCompare(b.planId))) {
    const plan = byId.get(edit.planId);
    if (!plan) continue;
    const fields = Object.keys(edit.values)
      .filter((field) => planFieldSpec(field) !== null)
      .sort();
    for (const field of fields) {
      parts.push(`${plan.id}.${field}=${String(plan.values[field as PlanEditableField])}`);
    }
    if (edit.onSale !== undefined) parts.push(`${plan.id}.onSale=${String(plan.onSale)}`);
  }

  return parts.join("|");
}
