import "server-only";
import { prisma } from "@/lib/db/client";
import "@/lib/audit/prisma-writer";
import { staffMutation } from "@/lib/audit/staff-mutation";
import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { areaMatrix } from "@/lib/content/matrix";
import type { CategoryRules } from "@/lib/taxonomy/service";
import { CATEGORY_RULES_SELECT } from "@/lib/taxonomy/service";

/**
 * Board 6f §5 — the most destructive control in the console, under dual control.
 *
 * Six numbers on one panel decide whether roughly eight thousand pages exist.
 * Lowering the absolute floor from 60 to 40 publishes several hundred in one
 * keystroke; raising it unpublishes pages that currently rank. The board asked
 * for an impact preview, a second approver, an audit entry and a permission
 * gate above ordinary content ops.
 *
 * Three of those four are here. The fourth has nowhere to go and says so: there
 * is no rung above `staff_ops_lead`, `taxonomy.write` is already the narrowest
 * grant in the matrix, and `docs/roadmap-handoff-5.md` already ruled that a
 * second content capability "would be a fourth name for the same seat". So the
 * escalation IS the second approver — enforced by a CHECK constraint in the
 * database rather than by an `if` a later refactor can drop.
 */

export type RuleField = keyof CategoryRules;

export const RULE_FIELDS = [
  "publishThreshold",
  "demandPerThousand",
  "verifiedShareMin",
  "minIntroWords",
  "holdShare",
  "minLiveDays",
  "humanReviewRequired",
] as const satisfies readonly RuleField[];

const BOUNDS: Record<RuleField, { min: number; max: number; integer: boolean } | null> = {
  publishThreshold: { min: 1, max: 5_000, integer: true },
  demandPerThousand: { min: 0, max: 5_000, integer: true },
  verifiedShareMin: { min: 0, max: 1, integer: false },
  minIntroWords: { min: 0, max: 5_000, integer: true },
  holdShare: { min: 0.01, max: 1, integer: false },
  minLiveDays: { min: 0, max: 365, integer: true },
  humanReviewRequired: null,
};

export type RuleProposalRefusal =
  | "not_yours"
  | "not_found"
  | "out_of_range"
  | "no_change"
  | "already_pending"
  | "not_pending"
  | "same_person"
  | "stale";

export type RuleResult<T = unknown> =
  | ({ ok: true } & T)
  | { ok: false; error: RuleProposalRefusal; message: string };

/**
 * What a rule change would do to the pages that exist, counted now.
 *
 * Board 6f's first requirement: "publishes 214, unpublishes 3, queues 41 for
 * copy", computed against current data, with the unpublish list enumerated.
 *
 * The enumeration is the part that matters. A count tells an approver the size
 * of the change; the list tells them whether the three pages about to go dark
 * are three nobody reads or the three that carry the section.
 */
export interface RuleImpact {
  publishes: number;
  unpublishes: number;
  queuedForCopy: number;
  /** Every page that would stop being served, named. Never a count alone. */
  unpublishing: { path: string; listings: number; need: number }[];
  /** Pages that would newly clear every floor and be waiting on a writer. */
  publishing: { path: string; listings: number; need: number }[];
}

export async function previewRuleChange(
  actor: Actor,
  categoryId: string,
  next: Partial<CategoryRules>,
): Promise<RuleResult<{ impact: RuleImpact; before: CategoryRules; after: CategoryRules }>> {
  /*
     Gated explicitly, and not only by the screen.

     `previewRename` on the categories board calls `requireStaff()` and no
     `can()`, so any staff seat — including a field verifier — can ask it how
     many addresses a rename would move. This one asks first: a preview of a
     threshold change is a map of the whole index's soft spots.

     A refusal rather than a throw, because a preview is a read: the screen
     shows the sentence. The three writers below throw `PermissionError` from
     `staffMutation` like every other audited mutation in the product.
  */
  if (!can(actor, "taxonomy.write")) {
    return { ok: false, error: "not_yours", message: "That is not yours to change." };
  }
  return buildChange(categoryId, next);
}

async function buildChange(
  categoryId: string,
  next: Partial<CategoryRules>,
): Promise<RuleResult<{ impact: RuleImpact; before: CategoryRules; after: CategoryRules }>> {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: CATEGORY_RULES_SELECT,
  });
  if (!category) {
    return { ok: false, error: "not_found", message: "That category is not in the taxonomy." };
  }

  const invalid = validate(next);
  if (invalid) return invalid;

  const after: CategoryRules = { ...category, ...strip(next) };
  if (!changed(category, after)) {
    return { ok: false, error: "no_change", message: "Those are the values it already has." };
  }

  return { ok: true, impact: await impactOf(categoryId, category, after), before: category, after };
}

/**
 * The counts, from the matrix rather than from a second implementation.
 *
 * `areaMatrix` is the function the screen renders and the sweep agrees with, so
 * a preview computed here cannot say one thing while the matrix says another.
 * It is run twice — once on the live rules and once on the proposed ones — and
 * the difference between the two sets is the answer.
 */
async function impactOf(
  categoryId: string,
  before: CategoryRules,
  after: CategoryRules,
): Promise<RuleImpact> {
  const [live, proposed] = await Promise.all([
    areaMatrix({ categoryId, perPage: Number.MAX_SAFE_INTEGER }),
    areaMatrix({ categoryId, perPage: Number.MAX_SAFE_INTEGER, rules: after }),
  ]);

  const wasLive = new Map(live.rows.map((row) => [row.path, row]));
  const unpublishing: RuleImpact["unpublishing"] = [];
  const publishing: RuleImpact["publishing"] = [];
  let queuedForCopy = 0;

  for (const row of proposed.rows) {
    const previous = wasLive.get(row.path);
    if (!previous) continue;
    if (previous.live && !row.live) {
      unpublishing.push({ path: row.path, listings: row.listings, need: row.need });
    }
    if (!previous.live && row.live) {
      publishing.push({ path: row.path, listings: row.listings, need: row.need });
    }
    if (previous.status !== "queued_copy" && row.status === "queued_copy") queuedForCopy += 1;
  }

  void before;
  return {
    publishes: publishing.length,
    unpublishes: unpublishing.length,
    queuedForCopy,
    unpublishing,
    publishing,
  };
}

/** A proposal, with its impact frozen onto the row at the moment it was made. */
export async function proposeRuleChange(
  actor: Actor,
  categoryId: string,
  next: Partial<CategoryRules>,
  reason: string,
): Promise<RuleResult<{ id: string; impact: RuleImpact }>> {
  /*
     `buildChange`, not `previewRuleChange`.

     The capability check belongs to `staffMutation` on this path, so a
     moderator gets the `PermissionError` every other audited mutation in the
     product throws rather than a soft "not yours" that reads like a missing
     row. Going through the gated preview would have swallowed it.
  */
  const preview = await buildChange(categoryId, next);
  if (!preview.ok) return preview;

  const pending = await prisma.publishRuleChange.findFirst({
    where: { categoryId, state: "proposed" },
    select: { id: true },
  });
  if (pending) {
    return {
      ok: false,
      error: "already_pending",
      message: "There is already a change waiting for a second approver on this trade.",
    };
  }

  const now = new Date();
  const id = await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        action: "rule_proposed",
        subject: `Category:${categoryId}`,
        reason,
        tx,
      },
      async () => {
        const row = await tx.publishRuleChange.create({
          data: {
            categoryId,
            before: preview.before as never,
            after: preview.after as never,
            /*
               Written onto the row, not recomputed at approval.

               The number is the decision. Recomputed later, the second approver
               would be approving a different change from the one they were
               shown — and `impactAt` is beside it so the panel can say how old
               the count is and recompute alongside rather than instead.
            */
            impact: preview.impact as never,
            impactAt: now,
            proposedById: actor.id,
            proposedReason: reason,
          },
          select: { id: true },
        });
        return {
          result: row.id,
          before: preview.before,
          // The resulting counts on the audit row itself — board 6f §5.3 asks
          // for "who, when, old value, new value, and the counts that resulted".
          after: { ...preview.after, impact: preview.impact },
        };
      },
    ),
  );

  return { ok: true, id, impact: preview.impact };
}

/**
 * Approve a proposal and apply it. Never the person who made it.
 *
 * The identity check is here for the message and in a CHECK constraint for the
 * guarantee. A rule that lives only in application code is a rule until the
 * next refactor.
 */
export async function approveRuleChange(
  actor: Actor,
  changeId: string,
  reason: string,
): Promise<RuleResult<{ impact: RuleImpact }>> {
  const change = await prisma.publishRuleChange.findUnique({
    where: { id: changeId },
    select: {
      id: true,
      categoryId: true,
      state: true,
      before: true,
      after: true,
      proposedById: true,
      category: { select: CATEGORY_RULES_SELECT },
    },
  });
  if (!change) {
    return { ok: false, error: "not_found", message: "That proposal is not here." };
  }
  if (change.state !== "proposed") {
    return { ok: false, error: "not_pending", message: "That proposal has already been decided." };
  }
  if (change.proposedById === actor.id) {
    return {
      ok: false,
      error: "same_person",
      message: "A rule change needs a second ops lead. You proposed this one.",
    };
  }

  /*
     The rules must still be what the proposal said they were.

     Without this an approval silently overwrites a change nobody reviewed: two
     proposals raised the floor, the first was approved, and approving the
     second would put the category back to a value the first approver had
     already replaced.
  */
  if (!same(change.before as unknown as CategoryRules, change.category)) {
    return {
      ok: false,
      error: "stale",
      message: "The rules have moved since this was proposed. Withdraw it and propose again.",
    };
  }

  const after = change.after as unknown as CategoryRules;
  // Recounted at the moment of approval, because supply moves nightly and this
  // is the number that goes on the audit row as what actually resulted.
  const impact = await impactOf(change.categoryId, change.category, after);

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        action: "rule_approved",
        subject: `Category:${change.categoryId}`,
        reason,
        tx,
      },
      async () => {
        await tx.category.update({ where: { id: change.categoryId }, data: strip(after) });
        await tx.publishRuleChange.update({
          where: { id: changeId },
          data: {
            state: "approved",
            decidedById: actor.id,
            decidedReason: reason,
            decidedAt: new Date(),
          },
        });
        return { result: null, before: change.category, after: { ...after, impact } };
      },
    ),
  );

  return { ok: true, impact };
}

/**
 * Reject a proposal, or withdraw your own.
 *
 * One function because the row is the same shape either way, and the state
 * enum records which it was. A proposer ending their own proposal is a
 * withdrawal rather than a self-approval, which is why the second-approver
 * CHECK is scoped to `state = 'approved'` and not to every exit from
 * `proposed` — a constraint that covered all of them would leave a mistyped
 * proposal stuck in the queue until somebody else signed it off.
 */
export async function closeRuleChange(
  actor: Actor,
  changeId: string,
  reason: string,
): Promise<RuleResult<{ state: "rejected" | "withdrawn" }>> {
  const change = await prisma.publishRuleChange.findUnique({
    where: { id: changeId },
    select: { id: true, categoryId: true, state: true, proposedById: true },
  });
  if (!change) return { ok: false, error: "not_found", message: "That proposal is not here." };
  if (change.state !== "proposed") {
    return { ok: false, error: "not_pending", message: "That proposal has already been decided." };
  }

  const state = change.proposedById === actor.id ? "withdrawn" : "rejected";

  await prisma.$transaction(async (tx) =>
    staffMutation(
      {
        actor,
        capability: "taxonomy.write",
        action: state === "withdrawn" ? "rule_withdrawn" : "rule_rejected",
        subject: `Category:${change.categoryId}`,
        reason,
        tx,
      },
      async () => {
        await tx.publishRuleChange.update({
          where: { id: changeId },
          data: { state, decidedById: actor.id, decidedReason: reason, decidedAt: new Date() },
        });
        return { result: null, before: { state: "proposed" }, after: { state } };
      },
    ),
  );

  return { ok: true, state };
}

/** The change waiting on this trade, for the panel that shows both sets. */
export async function pendingRuleChange(categoryId: string) {
  return prisma.publishRuleChange.findFirst({
    where: { categoryId, state: "proposed" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      before: true,
      after: true,
      impact: true,
      impactAt: true,
      proposedReason: true,
      createdAt: true,
      proposedById: true,
      proposedBy: { select: { fullName: true, email: true } },
    },
  });
}

/** The last applied change, for §5's "last-edited attribution" on the panel. */
export async function lastRuleChange(categoryId: string) {
  return prisma.publishRuleChange.findFirst({
    where: { categoryId, state: "approved" },
    orderBy: { decidedAt: "desc" },
    select: {
      decidedAt: true,
      decidedReason: true,
      proposedBy: { select: { fullName: true, email: true } },
      decidedBy: { select: { fullName: true, email: true } },
    },
  });
}

function strip(next: Partial<CategoryRules>): Partial<CategoryRules> {
  const out: Partial<CategoryRules> = {};
  for (const field of RULE_FIELDS) {
    const value = next[field];
    if (value !== undefined) Object.assign(out, { [field]: value });
  }
  return out;
}

function validate(next: Partial<CategoryRules>): { ok: false; error: "out_of_range"; message: string } | null {
  for (const field of RULE_FIELDS) {
    const value = next[field];
    if (value === undefined) continue;
    const bound = BOUNDS[field];
    if (bound === null) {
      if (typeof value !== "boolean") {
        return { ok: false, error: "out_of_range", message: "That control is on or off." };
      }
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, error: "out_of_range", message: `${field} is a number.` };
    }
    if (bound.integer && !Number.isInteger(value)) {
      return { ok: false, error: "out_of_range", message: `${field} is a whole number.` };
    }
    if (value < bound.min || value > bound.max) {
      return {
        ok: false,
        error: "out_of_range",
        message: `${field} is between ${bound.min} and ${bound.max}.`,
      };
    }
  }
  return null;
}

function changed(before: CategoryRules, after: CategoryRules): boolean {
  return !same(before, after);
}

function same(a: CategoryRules, b: CategoryRules): boolean {
  return RULE_FIELDS.every((field) => a[field] === b[field]);
}
