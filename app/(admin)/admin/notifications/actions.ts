"use server";

import { revalidatePath } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import type { NotificationChannel, NotificationEvent } from "@/lib/db/generated/enums";
import { t, type MessageKey } from "@/lib/i18n";
import {
  publishDraft,
  recordMetaDecision,
  saveTemplateVersion,
  sendTestToMe,
  type TemplateRefusal,
} from "@/lib/notify/templates";

/**
 * Board 12g's four mutations. Three are audited in the service; the test send
 * is recorded as a delivery row instead, because it changes nothing anybody
 * else receives.
 */

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

function refusal(error: TemplateRefusal, detail?: Record<string, string>): ActionResult {
  return { ok: false, error: t(`notifications.refusal.${error}` as MessageKey, detail) };
}

function caught(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("notifications.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("notifications.needs_reason") };
  throw error;
}

const text = (form: FormData, name: string): string => String(form.get(name) ?? "");
const optional = (form: FormData, name: string): string | null => text(form, name).trim() || null;

function refresh(): void {
  revalidatePath("/admin/notifications");
  revalidatePath("/admin/notifications/deliveries");
}

export async function saveVersionAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const basedOn = text(form, "basedOn");
  try {
    const result = await saveTemplateVersion({
      actor: seat.actor,
      event: text(form, "event") as NotificationEvent,
      channel: text(form, "channel") as NotificationChannel,
      line: text(form, "line") === "services" ? "services" : "primary",
      neutral: form.get("neutral") === "on",
      subject: optional(form, "subject"),
      body: text(form, "body"),
      actionLabel: optional(form, "actionLabel"),
      actionPath: optional(form, "actionPath"),
      metaTemplateName: optional(form, "metaTemplateName"),
      basedOn: basedOn === "" ? null : Number(basedOn),
      reason: text(form, "reason"),
    });
    if (!result.ok) return refusal(result.error, result.detail);
    refresh();
    return {
      ok: true,
      message:
        result.status === "pending_meta"
          ? t("notifications.saved.pending", { version: String(result.version) })
          : t("notifications.saved.live", { version: String(result.version) }),
    };
  } catch (error) {
    return caught(error);
  }
}

export async function metaDecisionAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const decision = text(form, "decision") === "rejected" ? "rejected" : "approved";
  try {
    const result = await recordMetaDecision({
      actor: seat.actor,
      templateId: text(form, "templateId"),
      decision,
      metaNote: optional(form, "metaNote"),
      reason: text(form, "reason"),
    });
    if (!result.ok) return refusal(result.error, result.detail);
    refresh();
    return { ok: true, message: t(decision === "approved" ? "notifications.decided.approved" : "notifications.decided.rejected") };
  } catch (error) {
    return caught(error);
  }
}

export async function publishDraftAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await publishDraft(seat.actor, text(form, "templateId"), text(form, "reason"));
    if (!result.ok) return refusal(result.error, result.detail);
    refresh();
    return { ok: true, message: t(result.status === "pending_meta" ? "notifications.published.pending" : "notifications.published.live") };
  } catch (error) {
    return caught(error);
  }
}

export async function sendTestAction(form: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await sendTestToMe(seat.actor, text(form, "templateId"));
    if (!result.ok) {
      const channel = result.detail?.["channel"];
      return refusal(result.error, channel ? { ...result.detail, channel: t(`notifications.channel.${channel}` as MessageKey) } : result.detail);
    }
    refresh();
    const channel = t(`notifications.channel.${result.channel}` as MessageKey);
    return result.delivered
      ? { ok: true, message: t("notifications.test.sent", { channel }) }
      : { ok: false, error: t("notifications.test.failed", { channel, detail: result.detail ?? t("notifications.test.no_detail") }) };
  } catch (error) {
    return caught(error);
  }
}
