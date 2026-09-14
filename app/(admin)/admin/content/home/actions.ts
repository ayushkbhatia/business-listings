"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import {
  addCuratedQuery,
  featureBusiness,
  removeCuratedQuery,
  removeFeatured,
  reorderSlots,
  type HomepageResult,
} from "@/lib/content/homepage";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { t, type MessageKey } from "@/lib/i18n";

/**
 * Board 6h — the five writes on `/admin/content/home`.
 *
 * Each revalidates the home page's data tag (`B7`). The route reads the session
 * and so has no path cache for `revalidatePath("/")` to clear; what is cached is
 * its data, under one tag. `expire: 0` rather than the "max" profile, which is
 * stale-while-revalidate: an ops lead who has just taken a business off the
 * rail should load the home page and not find it there.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refusal(result: Extract<HomepageResult, { ok: false }>): string {
  if (result.error === "not_eligible" && result.block) return t(`curation.refused.${result.block}` as MessageKey);
  if (result.error === "chip_invalid" && result.problem) return t(`curation.problem.${result.problem}` as MessageKey);
  if (result.error === "already_featured") return t("curation.error.already_featured", { position: String(result.position ?? "") });
  return t(`curation.error.${result.error}` as MessageKey);
}

function done(): void {
  revalidateTag(HOME_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin/content/home");
  // 6f's editorial queues carry the vacated-slot card.
  revalidatePath("/admin/content/matrix");
}

async function guarded(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("curation.error.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("curation.error.reason") };
    throw error;
  }
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

function readOrder(raw: string): (string | null)[] | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((id) => id === null || typeof id === "string")) return null;
    return parsed as (string | null)[];
  } catch {
    return null;
  }
}

export async function featureAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const businessId = field(form, "businessId");
    if (!businessId) return { ok: false, error: t("curation.error.pick_one") };
    const result = await featureBusiness({ actor: seat.actor, businessId, reason: field(form, "reason") });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("curation.featured", { position: String(result.position) }) };
  });
}

export async function removeAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await removeFeatured({ actor: seat.actor, businessId: field(form, "businessId"), reason: field(form, "reason") });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("curation.removed", { position: String(result.position) }) };
  });
}

export async function reorderAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const order = readOrder(field(form, "order"));
    const basedOn = readOrder(field(form, "basedOn"));
    if (!order || !basedOn) return { ok: false, error: t("curation.error.invalid_order") };
    const result = await reorderSlots({ actor: seat.actor, order, basedOn, reason: field(form, "reason") });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("curation.reordered") };
  });
}

export async function addChipAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await addCuratedQuery({
      actor: seat.actor,
      label: field(form, "label"),
      query: field(form, "query"),
      reason: field(form, "reason"),
    });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("curation.chips.added") };
  });
}

export async function removeChipAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await removeCuratedQuery({ actor: seat.actor, id: field(form, "id"), reason: field(form, "reason") });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("curation.chips.removed") };
  });
}
