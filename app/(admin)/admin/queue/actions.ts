"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { approveChange, rejectChange, type DecisionResult } from "@/lib/moderation/service";
import {
  approveRef,
  bulkApprove,
  bulkAssign,
  bulkReject,
  bulkRequestDocuments,
  rejectRef,
  requestDocumentsRef,
  type BulkOutcome,
  type DecisionError,
} from "@/lib/moderation/decide";
import { formatCount, formatList } from "@/lib/format";
import { resolveConflict } from "@/lib/onboarding/conflict";
import { approveDocument, rejectDocument } from "@/lib/verification/review";
import type { ClaimResolution } from "@/lib/db/generated/client";
import { t } from "@/lib/i18n";

/**
 * The queue's four mutations. Every one goes through a service that goes
 * through `staffMutation`, so none of them can reach the database without an
 * audit row carrying a written reason.
 *
 * The reason is read from the form and passed straight through. It is
 * deliberately not defaulted, trimmed into existence, or composed from a
 * dropdown — `assertReason` refuses blanks, punctuation and four characters of
 * keyboard-clearing, and a default would walk straight past all three.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Turns the two ways a service refuses into something a person can act on. */
function refused(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
  throw error;
}

/**
 * A moderation refusal, worded here rather than in the service.
 *
 * `lib/moderation/service.ts` returned seven sentences of raw English that this
 * file handed straight to the screen — the only strings on it that never
 * reached `lib/i18n/en.ts`, and two of them printed a raw enum or a raw slug.
 * The service returns the fact now; this turns it into words.
 */
function changeRefusal(result: Extract<DecisionResult, { ok: false }>): string {
  if (result.error === "already_decided") {
    return t("admin.queue.change_error.already_decided", { status: result.status });
  }
  if (result.error === "slug_taken") {
    return t("admin.queue.change_error.slug_taken", { slug: result.slug });
  }
  return t(`admin.queue.change_error.${result.error}`);
}

export async function approve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveChange({
      actor: seat.actor,
      requestId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: changeRefusal(result) };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.approved") };
  } catch (error) {
    return refused(error);
  }
}

export async function reject(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await rejectChange({
      actor: seat.actor,
      requestId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: changeRefusal(result) };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.rejected") };
  } catch (error) {
    return refused(error);
  }
}

const RESOLUTIONS = [
  "award_to_a",
  "award_to_b",
  "split_into_two",
  "merge_as_branches",
] as const satisfies readonly ClaimResolution[];

function isResolution(value: string): value is ClaimResolution {
  return (RESOLUTIONS as readonly string[]).includes(value);
}

export async function resolve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const resolution = String(formData.get("resolution") ?? "");
  if (!isResolution(resolution)) {
    return { ok: false, error: t("admin.queue.pick_a_resolution") };
  }

  const secondTradeName = String(formData.get("secondTradeName") ?? "").trim();

  try {
    const result = await resolveConflict({
      actor: seat.actor,
      conflictId: String(formData.get("conflictId") ?? ""),
      resolution,
      reason: String(formData.get("reason") ?? ""),
      ...(secondTradeName ? { secondTradeName } : {}),
    });
    if (!result.ok) {
      return { ok: false, error: t(`admin.queue.conflict_error.${result.error}`) };
    }
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.resolved") };
  } catch (error) {
    return refused(error);
  }
}

/**
 * Board 3e's credential review, through the same two buttons and the same
 * required reason as every other decision on this queue.
 *
 * `approveDocument` and `rejectDocument` go through `staffMutation`, so neither
 * can reach the database without an audit row carrying the words the moderator
 * typed. Neither can reach `verificationTier`: what is decided here is whether
 * a certificate may be named on a public page, and the tier is a different kind
 * of statement with a different function and a different capability behind it.
 */
export async function approveCredential(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await approveDocument({
      actor: seat.actor,
      documentId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: t(`admin.queue.credential_error.${result.error}`) };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.approved") };
  } catch (error) {
    return refused(error);
  }
}

export async function rejectCredential(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await rejectDocument({
      actor: seat.actor,
      documentId: String(formData.get("requestId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    if (!result.ok) return { ok: false, error: t(`admin.queue.credential_error.${result.error}`) };
    revalidatePath("/admin/queue");
    revalidatePath("/admin");
    return { ok: true, message: t("admin.queue.rejected") };
  } catch (error) {
    return refused(error);
  }
}

/* ── Board 4b: the queue's own decisions ─────────────────────────────────── */

function refreshQueue() {
  revalidatePath("/admin/queue", "layout");
  revalidatePath("/admin");
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");
const n = (count: number) => ({ count, n: formatCount(count) });

/** "3 skipped — a check did not pass, no longer waiting." Grouped by why. */
function outcomeMessage(outcome: BulkOutcome): { ok: boolean; message: string } {
  const parts: string[] = [];
  if (outcome.done.length > 0) parts.push(t("admin.queue.result.done", n(outcome.done.length)));
  if (outcome.skipped.length > 0) {
    const reasons = new Map<DecisionError, number>();
    for (const skip of outcome.skipped) reasons.set(skip.error, (reasons.get(skip.error) ?? 0) + 1);
    parts.push(
      t("admin.queue.result.skipped", {
        ...n(outcome.skipped.length),
        reasons: formatList(
          [...reasons.entries()].map(([error, count]) =>
            t("admin.queue.skip_count", { reason: t(`admin.queue.skip.${error}`), n: formatCount(count) }),
          ),
        ),
      }),
    );
  }
  return { ok: outcome.done.length > 0 || outcome.skipped.length === 0, message: parts.join(" ") };
}

/**
 * One row's decision from the board: the per-row button (B6), with the reason
 * the dialog asked for. Conflicts never arrive here — they open their own screen.
 */
export async function decideRef(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const op = field(formData, "op");
  const input = { actor: seat.actor, ref: field(formData, "ref"), reason: field(formData, "reason") };
  try {
    const result =
      op === "approve"
        ? await approveRef(input)
        : op === "reject"
          ? await rejectRef(input)
          : op === "request_docs"
            ? await requestDocumentsRef(input)
            : ({ ok: false, error: "not_found" } as const);
    if (!result.ok) return { ok: false, error: t(`admin.queue.error.${result.error}`) };
    refreshQueue();
    return {
      ok: true,
      message:
        op === "approve"
          ? t("admin.queue.result.approved")
          : op === "reject"
            ? t("admin.queue.rejected")
            : t("admin.queue.result.docs_requested"),
    };
  } catch (error) {
    return refused(error);
  }
}

const BULK_OPS = new Set(["approve", "reject", "request_docs", "reassign"]);

/**
 * The bulk bar. Every op acts row by row on the server and reports what it did
 * and what it skipped, grouped by why — B1 for approve, and the same honesty
 * for the three unrestricted ops, which skip what they cannot act on (a
 * conflict cannot be rejected in bulk; a branch has no document to ask for).
 */
export async function bulkDecide(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const op = field(formData, "op");
  if (!BULK_OPS.has(op)) return { ok: false, error: t("admin.queue.error.not_found") };
  const refs = formData.getAll("ref").map(String).filter(Boolean);
  const reason = field(formData, "reason");
  try {
    const outcome =
      op === "approve"
        ? await bulkApprove({ actor: seat.actor, refs, reason })
        : op === "reject"
          ? await bulkReject({ actor: seat.actor, refs, reason })
          : op === "request_docs"
            ? await bulkRequestDocuments({ actor: seat.actor, refs, reason })
            : await bulkAssign({ actor: seat.actor, refs, assigneeId: field(formData, "assigneeId") || null, reason });
    refreshQueue();
    const { ok, message } = outcomeMessage(outcome);
    return ok ? { ok: true, message } : { ok: false, error: message };
  } catch (error) {
    return refused(error);
  }
}

/*
   The three decisions a review screen offers, bound to their op so a form can
   hand one to a button. Each reads `ref` and `reason` and goes through the same
   path as the board's per-row action.
*/
function withOp(op: "approve" | "reject" | "request_docs") {
  return async (formData: FormData): Promise<ActionResult> => {
    formData.set("op", op);
    return decideRef(formData);
  };
}

export async function approveQueueRef(formData: FormData): Promise<ActionResult> {
  return withOp("approve")(formData);
}

export async function rejectQueueRef(formData: FormData): Promise<ActionResult> {
  return withOp("reject")(formData);
}

export async function requestDocsQueueRef(formData: FormData): Promise<ActionResult> {
  return withOp("request_docs")(formData);
}
