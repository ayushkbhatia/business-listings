"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { assertCanMergeBusinesses } from "@/lib/auth/guards";
import { requireStaff } from "@/lib/auth/staff";
import { BAND_MIN_WIDTH, CERTAIN_MAX, CERTAIN_MIN, FLOOR_MIN, percent } from "@/lib/dedupe/bands";
import {
  BULK_LIMIT,
  bulkMerge as bulkMergePairs,
  resolvePair,
  reverseBatch,
  reversePair,
  type Outcome,
  type ResolveError,
  type ReverseError,
} from "@/lib/dedupe/resolve";
import { findCandidates, unmergeBusinesses } from "@/lib/dedupe/service";
import { applyTuning, previewTuning, type TuningPreview } from "@/lib/dedupe/tuning";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12b's request boundary.
 *
 * Each action is a thin wrapper over a `staffMutation` in `lib/dedupe`, which
 * asserts `business.merge` and the written reason before it writes (B6). The
 * wrappers turn the refusals a person can meet into sentences from the
 * catalogue — the service's own messages are for logs and tests, not screens —
 * and revalidate every page that counts pairs.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const n = (count: number) => ({ count, n: formatCount(count) });
const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

async function guarded(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
    throw error;
  }
}

function refresh() {
  revalidatePath("/admin/ingest/dedupe");
  // A resolution changes a run's duplicate figures and a listing's branches.
  revalidatePath("/admin/ingest", "layout");
  revalidatePath("/admin");
}

const OUTCOMES = new Set<Outcome>(["merge", "separate", "discard"]);

export async function resolve(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const outcome = field(formData, "outcome") as Outcome;
    if (!OUTCOMES.has(outcome)) return { ok: false, error: t("admin.dedupe.error.not_found") };

    const result = await resolvePair({
      actor: seat.actor,
      candidateId: field(formData, "candidateId"),
      outcome,
      reason: field(formData, "reason"),
      areaId: field(formData, "areaId") || null,
    });
    if (!result.ok) {
      // A pair that moved under the reviewer leaves the queue either way, so
      // the page refreshes behind the sentence and shows the next one.
      if (result.error === "not_found" || result.error === "already_resolved" || result.error === "withdrawn") refresh();
      return { ok: false, error: resolveError(result.error, field(formData, "childName")) };
    }

    refresh();
    const name = { name: result.parentName };
    return {
      ok: true,
      message:
        outcome === "merge"
          ? t(result.heldForOwner ? "admin.dedupe.done.merge_held" : "admin.dedupe.done.merge", name)
          : outcome === "separate"
            ? t("admin.dedupe.done.separate", name)
            : t("admin.dedupe.done.discard", name),
    };
  });
}

function resolveError(error: ResolveError, childName: string): string {
  switch (error) {
    case "has_history":
      return t("admin.dedupe.error.has_history", { name: childName });
    default:
      return t(`admin.dedupe.error.${error}`);
  }
}

export async function bulkMerge(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await bulkMergePairs({
      actor: seat.actor,
      reason: field(formData, "reason"),
      runId: field(formData, "runId") || null,
    });
    if (!result.ok) return { ok: false, error: t("admin.dedupe.error.nothing_to_merge") };

    refresh();
    const skipped = result.skippedArea + result.skippedBothClaimed;
    return {
      ok: true,
      message: [
        t("admin.dedupe.bulk_done", n(result.merged)),
        skipped > 0
          ? t("admin.dedupe.bulk_skipped", {
              area: formatCount(result.skippedArea),
              claimed: formatCount(result.skippedBothClaimed),
            })
          : "",
        result.merged === BULK_LIMIT ? t("admin.dedupe.bulk_limit", { limit: formatCount(BULK_LIMIT) }) : "",
      ]
        .filter(Boolean)
        .join(" "),
    };
  });
}

/**
 * One "Put it back" for three kinds of row: a pair decided on this screen, a
 * bulk merge as a unit, and a merge made before pairs carried their own state.
 */
export async function reverse(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const kind = field(formData, "kind");
    const id = field(formData, "id");
    const reason = field(formData, "reason");

    if (kind === "batch") {
      const result = await reverseBatch({ actor: seat.actor, batchId: id, reason });
      if (!result.ok) return { ok: false, error: reverseError(result.error) };
      refresh();
      return {
        ok: true,
        message:
          result.kept === 0
            ? t("admin.dedupe.unmerged_batch_all", n(result.restored))
            : t("admin.dedupe.unmerged_batch", {
                restored: formatCount(result.restored),
                kept: formatCount(result.kept),
              }),
      };
    }

    if (kind === "merge") {
      const result = await unmergeBusinesses({ actor: seat.actor, mergeId: id, reason });
      if (!result.ok) return { ok: false, error: reverseError(result.error) };
      refresh();
      return { ok: true, message: t("admin.dedupe.unmerged") };
    }

    const result = await reversePair({ actor: seat.actor, candidateId: id, reason });
    if (!result.ok) return { ok: false, error: reverseError(result.error) };
    refresh();
    return { ok: true, message: t("admin.dedupe.unmerged") };
  });
}

function reverseError(error: ReverseError): string {
  return t(`admin.dedupe.error.${error}`);
}

export type PreviewResult =
  | Extract<TuningPreview, { ok: true }>
  | { ok: false; error: string };

/** Reads only. The same computation `applyTuning` runs, against proposed lines. */
export async function preview(input: { floor: number; certain: number }): Promise<PreviewResult> {
  const seat = await requireStaff();
  try {
    const result = await previewTuning({ actor: seat.actor, bands: input });
    if (!result.ok) return { ok: false, error: bandsError(result.problem) };
    return result;
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    throw error;
  }
}

function bandsError(problem: Extract<TuningPreview, { ok: false }>["problem"]): string {
  switch (problem) {
    case "floor_too_low":
      return t("admin.dedupe.tune_problem.floor_too_low", { min: percent(FLOOR_MIN) });
    case "certain_too_low":
      return t("admin.dedupe.tune_problem.certain_too_low", { min: percent(CERTAIN_MIN) });
    case "certain_too_high":
      return t("admin.dedupe.tune_problem.certain_too_high", { max: percent(CERTAIN_MAX) });
    case "band_too_narrow":
      return t("admin.dedupe.tune_problem.band_too_narrow", { width: percent(BAND_MIN_WIDTH) });
  }
}

export async function tune(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await applyTuning({
      actor: seat.actor,
      bands: { floor: Number(field(formData, "floor")), certain: Number(field(formData, "certain")) },
      reason: field(formData, "reason"),
    });
    if (!result.ok) return { ok: false, error: bandsError(result.problem) };
    refresh();
    return {
      ok: true,
      message: t("admin.dedupe.tune_applied", {
        floor: percent(result.bands.floor),
        certain: percent(result.bands.certain),
      }),
    };
  });
}

/**
 * `findCandidates` writes pairs — a lasting effect on what this queue holds —
 * so it asserts `business.merge` like everything else here. It writes no audit
 * row: proposing a pair decides nothing, and every decision about one is
 * audited when somebody makes it.
 */
export async function rescan(): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    assertCanMergeBusinesses(seat.actor);
    const scan = await findCandidates();
    refresh();
    return {
      ok: true,
      message:
        scan.dropped === 0
          ? t("admin.dedupe.rescan_done", n(scan.created))
          : t("admin.dedupe.rescan_capped", {
              n: formatCount(scan.created),
              dropped: formatCount(scan.dropped),
            }),
    };
  });
}
