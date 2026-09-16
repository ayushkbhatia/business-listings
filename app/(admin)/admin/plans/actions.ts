"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { can } from "@/lib/auth/can";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  createPlan,
  editPlanConfig,
  previewPlanConfig,
} from "@/lib/billing/entitlements-service";
import type { PlanChangeSet, PlanEdit, PlanFieldValue } from "@/lib/billing/plan-diff";
import { PLAN_CACHE_TAG } from "@/lib/db/queries/pricing";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { isPlanField, planFieldSpec, type PlanEditableField } from "@/lib/plan/plan-fields";

/**
 * Three actions, and the middle one is why the other two are safe.
 *
 * Board 12e `B7`: *"`Apply to existing` needs a scope, a preview and a confirm.
 * Which change, how many accounts, then commit — the shape `12c` uses for
 * publishing weights."* So `previewChanges` computes the diff and hands back a
 * fingerprint of the numbers it read, and `commitChanges` refuses a set whose
 * numbers have moved since. An ops lead commits the diff they were shown or
 * they commit nothing.
 *
 * "Apply to existing" is off unless the form says otherwise, and it is read
 * from the checkbox rather than defaulted, because the default is the whole
 * point: a seller who signed up on forty enquiries a month keeps forty until
 * somebody decides otherwise and writes down why.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export type PreviewResult =
  | { ok: true; change: PlanChangeSet }
  | { ok: false; error: string };

const CELL = "cell:";
const SALE = "sale:";

/**
 * The matrix, read back off the form.
 *
 * Every cell the screen drew is posted, including the ones nobody touched — the
 * diff is what decides which of them moved, and a form that posted only dirty
 * cells would make "what did this save actually write" a question about
 * JavaScript rather than about the table.
 *
 * A switch posts `on` or `off` rather than present-or-absent. A checkbox that
 * posts nothing when unticked would make every entitlement here a grant that
 * could be given and never withdrawn, which is the defect the old form's
 * unconditional read existed to close; posting both states closes it at the
 * source instead.
 */
function readEdits(formData: FormData): PlanEdit[] {
  const byPlan = new Map<string, PlanEdit>();

  function edit(planId: string): PlanEdit {
    const existing = byPlan.get(planId);
    if (existing) return existing;
    const fresh: PlanEdit = { planId, values: {} };
    byPlan.set(planId, fresh);
    return fresh;
  }

  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;

    if (key.startsWith(CELL)) {
      const [planId, field] = key.slice(CELL.length).split(":");
      if (!planId || !field || !isPlanField(field)) continue;
      const value = cellValue(field, raw);
      if (value === undefined) continue;
      edit(planId).values[field] = value;
      continue;
    }

    if (key.startsWith(SALE)) {
      const planId = key.slice(SALE.length);
      if (!planId) continue;
      edit(planId).onSale = raw === "on";
    }
  }

  return [...byPlan.values()];
}

/**
 * One cell's posted value.
 *
 * `undefined` means "the form said nothing about this field", which is
 * different from `null` — null is the empty box, and on a cap that means
 * unlimited. Board 12e `B6`: *"`Unlimited` is a config value, not a typed
 * string. Null or a toggle; an admin cannot type it."* Nothing here parses the
 * word, so nothing here can be fooled by it: a non-numeric cell comes back
 * `NaN` and the service refuses it by range.
 */
function cellValue(field: PlanEditableField, raw: string): PlanFieldValue | undefined {
  const spec = planFieldSpec(field);
  if (!spec) return undefined;
  if (spec.kind === "switch") return raw === "on";

  const text = raw.trim();
  if (text === "") return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function previewChanges(formData: FormData): Promise<PreviewResult> {
  const seat = await requireStaff();
  /*
     Gated on the write, not on the read. A preview states how many accounts a
     change would move and what each of them is on today; it is the first half
     of a mutation rather than a report, and `revenue.read` is a wider grant
     than `plan.entitlements.write` by one role.
  */
  if (!can(seat.actor, "plan.entitlements.write")) {
    return { ok: false, error: t("admin.plans.not_yours") };
  }

  const edits = readEdits(formData);
  if (edits.length === 0) return { ok: false, error: t("admin.plans.nothing_to_review") };

  const change = await previewPlanConfig(edits);
  if (change.changes.length === 0) {
    return { ok: false, error: t("admin.plans.nothing_to_review") };
  }
  return { ok: true, change };
}

export async function commitChanges(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();

  try {
    const result = await editPlanConfig({
      actor: seat.actor,
      edits: readEdits(formData),
      applyToExisting: formData.get("applyToExisting") === "on",
      reason: String(formData.get("reason") ?? ""),
      expect: String(formData.get("expect") ?? ""),
    });

    if (!result.ok) return { ok: false, error: result.message };

    revalidatePlanReaders();
    return { ok: true, message: savedMessage(result.existingUpdated) };
  } catch (error) {
    return refusal(error);
  }
}

export async function addPlan(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();

  try {
    const result = await createPlan({
      actor: seat.actor,
      id: String(formData.get("id") ?? ""),
      name: String(formData.get("name") ?? ""),
      monthlyPriceAed: Number(String(formData.get("monthlyPriceAed") ?? "").trim()),
      copyFromPlanId: String(formData.get("copyFrom") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });

    if (!result.ok) return { ok: false, error: result.message };

    revalidatePlanReaders();
    return { ok: true, message: t("admin.plans.added", { plan: result.planId }) };
  } catch (error) {
    return refusal(error);
  }
}

/**
 * What the alert says.
 *
 * One number in it, not two. The plan count was in here and produced "1 plans
 * changed, 1 existing accounts moved" on the commonest case of all — an ops
 * lead changing one number on one plan — and it was restating the diff they had
 * just read and confirmed. What they cannot see from the table afterwards is
 * how many accounts moved, so that is the number the sentence carries.
 */
function savedMessage(moved: number): string {
  if (moved === 0) return t("admin.plans.saved_none");
  return moved === 1
    ? t("admin.plans.saved_one_account")
    : t("admin.plans.saved", { count: formatCount(moved) });
}

function refusal(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.plans.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.plans.needs_reason") };
  throw error;
}

/**
 * Everything that quotes these numbers.
 *
 * Both public surfaces are dynamic routes with cached data, so `revalidatePath`
 * on them would clear a route cache neither has. The tags are what actually
 * holds criterion 2 of board 1l — the figures on `/` and on `/pricing` are
 * identical for the same plan — because until this line existed an edit reached
 * `/admin/plans` immediately and the home band up to an hour later.
 */
function revalidatePlanReaders(): void {
  revalidatePath("/admin/plans");
  revalidatePath("/admin/revenue");
  revalidateTag(PLAN_CACHE_TAG, { expire: 0 });
  revalidateTag(HOME_CACHE_TAG, { expire: 0 });
}
