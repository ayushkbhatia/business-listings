"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { assertCan } from "@/lib/auth/can";
import { INGEST_BUCKET, checkIngest, ingestPath, signUpload } from "@/lib/storage";
import {
  RunMovedError,
  discardRun,
  publishRun,
  rollbackRun,
  stageRun,
} from "@/lib/ingest/service";
import { categoriseRecords, forgetActivityMapping } from "@/lib/ingest/queue";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board 12a's request boundary.
 *
 * Every action here is a thin wrapper over a `staffMutation` in
 * `lib/ingest`, which checks `queue.decide` and the written reason before it
 * writes anything. The wrappers turn the three refusals a person can cause —
 * a role that does not hold the decision, a reason that is not one, a run that
 * moved under them — into sentences, and revalidate the screens that show it.
 */

export type ActionResult =
  | { ok: true; message: string; runId?: string }
  | { ok: false; error: string };

/** T4.1 — where the browser should PUT the export, and the path it lands at. */
export type SignResult =
  | { ok: true; path: string; url: string }
  | { ok: false; error: string };

const n = (count: number) => ({ count, n: formatCount(count) });

async function guarded(work: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("admin.queue.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("admin.queue.needs_reason") };
    if (error instanceof RunMovedError) return { ok: false, error: t("admin.run.moved") };
    throw error;
  }
}

function refresh(runId?: string) {
  revalidatePath("/admin/ingest");
  revalidatePath("/admin/ingest/categorise");
  if (runId) revalidatePath(`/admin/ingest/${runId}`);
  revalidatePath("/admin");
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");

/**
 * Sign one upload into `ingest-uploads` — task T4.1.
 *
 * The path is built from the seat's own staff id and never from the form, so a
 * signature cannot be talked into writing under somebody else's folder. The
 * capability is the importer's own: `queue.decide`, the same one `stageRun`
 * asserts, because the ability to put a 32 MB file where the importer reads
 * from is the ability to start an import.
 *
 * It writes nothing and audits nothing. The audited event is the staging, which
 * carries the reason; an upload nobody stages is an object with a random name
 * that no row points at.
 */
export async function signIngestUpload(formData: FormData): Promise<SignResult> {
  const seat = await requireStaff();
  try {
    assertCan(seat.actor, "queue.decide");
  } catch {
    return { ok: false, error: t("admin.queue.not_yours") };
  }

  const filename = field(formData, "filename") || "export.csv";
  const check = checkIngest(field(formData, "type"), Number(formData.get("bytes") ?? 0));
  if (!check.ok) return { ok: false, error: check.reason };

  try {
    const signed = await signUpload(INGEST_BUCKET, ingestPath(seat.actor.id, filename));
    return { ok: true, path: signed.path, url: signed.url };
  } catch {
    return { ok: false, error: t("admin.ingest.storage_off") };
  }
}

export async function stage(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await stageRun({
      actor: seat.actor,
      source: field(formData, "source"),
      filename: field(formData, "filename"),
      /*
         T4.1: the path, not the bytes. `text` stays on the input for the seed
         and the integration tests, and the console has stopped using it.
      */
      uploadPath: field(formData, "path"),
      reason: field(formData, "reason"),
    });
    if (!result.ok) return { ok: false, error: result.message };

    refresh(result.runId);
    return {
      ok: true,
      runId: result.runId,
      /*
         The truncation is named when it happens. A run that quietly stopped at
         the ceiling and reported a tidy number would be a lie about what was
         staged, and the rows it dropped are the ones nobody would go looking
         for.
      */
      message:
        result.truncated > 0
          ? t("admin.ingest.staged_capped", {
              count: formatCount(result.totals.staged),
              dropped: formatCount(result.truncated),
            })
          : t("admin.ingest.staged", n(result.totals.staged)),
    };
  });
}

export async function publish(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const runId = field(formData, "runId");
  return guarded(async () => {
    const result = await publishRun({ actor: seat.actor, runId, reason: field(formData, "reason") });
    if (!result.ok) return { ok: false, error: result.message };
    refresh(runId);
    return {
      ok: true,
      message:
        result.created === 0
          ? t("admin.run.reviewed_done")
          : t("admin.run.published_done", n(result.created)),
    };
  });
}

export async function discard(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const runId = field(formData, "runId");
  return guarded(async () => {
    const result = await discardRun({ actor: seat.actor, runId, reason: field(formData, "reason") });
    if (!result.ok) return { ok: false, error: result.message };
    refresh(runId);
    return { ok: true, message: t("admin.run.discarded_done") };
  });
}

export async function rollback(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const runId = field(formData, "runId");
  return guarded(async () => {
    const result = await rollbackRun({ actor: seat.actor, runId, reason: field(formData, "reason") });
    if (!result.ok) {
      if (result.error === "merges_need_merge_role") return { ok: false, error: t("admin.run.rollback_merge_role") };
      return { ok: false, error: result.message };
    }
    refresh(runId);
    // A rollback that put merges back changed the dedupe queue as well.
    if (result.unwound > 0) revalidatePath("/admin/ingest/dedupe");
    const done = t("admin.run.rolled_back_done", {
      withdrawn: formatCount(result.withdrawn),
      kept: formatCount(result.kept),
    });
    return {
      ok: true,
      message: result.unwound > 0 ? `${done} ${t("admin.run.rolled_back_unwound", n(result.unwound))}` : done,
    };
  });
}

/**
 * One decision about a category.
 *
 * `keys` files every waiting record carrying those activities; `ids` files
 * named records, which is the record page's path. Never both — a form that
 * sent both would be asking for two different decisions under one reason.
 */
export async function categorise(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const keys = formData.getAll("key").map(String);
    const ids = formData.getAll("id").map(String);
    const runId = field(formData, "runId") || null;

    const result = await categoriseRecords({
      actor: seat.actor,
      categoryId: field(formData, "categoryId"),
      reason: field(formData, "reason"),
      target: ids.length > 0 ? { kind: "records", ids } : { kind: "activities", keys, runId },
      remember: formData.get("remember") === "on",
      confirmInherited: formData.get("confirmInherited") === "on",
    });
    if (!result.ok) return { ok: false, error: result.message };

    refresh();
    // Every run a decision touched shows new counts; the paths are per run.
    revalidatePath("/admin/ingest/[id]", "page");
    revalidatePath("/admin/ingest/records/[id]", "page");

    const done = t("admin.categorise.done", { ...n(result.records), category: result.categoryName });
    return {
      ok: true,
      message:
        result.remembered > 0
          ? `${done} ${t("admin.categorise.remembered", n(result.remembered))}`
          : done,
    };
  });
}

export async function forgetMapping(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await forgetActivityMapping({
      actor: seat.actor,
      mappingId: field(formData, "mappingId"),
      reason: field(formData, "reason"),
    });
    if (!result.ok) return { ok: false, error: result.message };
    revalidatePath("/admin/ingest/categorise");
    return { ok: true, message: t("admin.mappings.forgotten") };
  });
}
