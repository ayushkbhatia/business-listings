"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { t, type MessageKey } from "@/lib/i18n";
import { restoreHalf, suppressHalf, writeHalf, type StringResult } from "@/lib/strings/service";
import { STRINGS_CACHE_TAG } from "@/lib/strings/store";

/**
 * Board `12g-s` — the three writes on a half.
 *
 * Each clears the strings data tag, which every screen reading a pair renders
 * through, so the words change on the storefront, the dashboard and search on
 * their next load. `expire: 0` rather than stale-while-revalidate: somebody who
 * has just fixed a label should not reload a store and find the old one.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

const field = (form: FormData, name: string) => String(form.get(name) ?? "");
const half = (form: FormData) => (field(form, "half") === "services" ? "services" : "goods");
const basedOn = (form: FormData) => field(form, "basedOn") || null;

function refusal(result: Extract<StringResult, { ok: false }>): string {
  if (result.error === "unknown_placeholder") {
    return t("strings.paired.error.unknown_placeholder", {
      names: (result.detail?.placeholders ?? []).map((name) => `{${name}}`).join(", "),
    });
  }
  if (result.error === "vocabulary") return t("strings.paired.error.vocabulary", { match: result.detail?.match ?? "" });
  return t(`strings.paired.error.${result.error}` as MessageKey);
}

function done(): void {
  revalidateTag(STRINGS_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin/strings");
  revalidatePath("/admin/strings/paired");
}

async function guarded(run: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("strings.paired.error.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("strings.paired.error.reason") };
    throw error;
  }
}

export async function writeHalfAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const key = field(form, "key");
    const result = await writeHalf({
      actor: seat.actor,
      key,
      half: half(form),
      value: field(form, "value"),
      reason: field(form, "reason"),
      basedOn: basedOn(form),
    });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("strings.paired.saved", { key }) };
  });
}

export async function suppressHalfAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await suppressHalf({
      actor: seat.actor,
      key: field(form, "key"),
      half: half(form),
      reason: field(form, "reason"),
      basedOn: basedOn(form),
    });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("strings.paired.suppressed_done") };
  });
}

export async function restoreHalfAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  return guarded(async () => {
    const result = await restoreHalf({
      actor: seat.actor,
      key: field(form, "key"),
      half: half(form),
      reason: field(form, "reason"),
      basedOn: basedOn(form),
    });
    if (!result.ok) return { ok: false, error: refusal(result) };
    done();
    return { ok: true, message: t("strings.paired.restored") };
  });
}
