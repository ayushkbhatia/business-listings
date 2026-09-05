"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/client";
import { assertCan } from "@/lib/auth/can";
import { AUTO_REPLY_MAX, unknownTokens } from "@/lib/messaging/auto-reply";
import type { SeatChannelKind } from "@/lib/db/generated/client";
import {
  confirmVerification,
  removeChannel,
  startVerification,
} from "@/lib/team/channels";
import { recordEvent } from "@/lib/telemetry/record";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";
import { ALWAYS_IN_APP, CHANNELS, ESCALATION_CHOICES, EVENTS, NUDGE_CHOICES } from "./matrix";

/**
 * Saving the alert matrix, the acknowledgement, and a seat's own channels.
 *
 * Everything is re-validated here. The matrix arrives as a form, and a form is
 * a suggestion: an event or channel this product does not have would be stored
 * as JSON and read back as JSON, and then some future send would route to it.
 */
export type SaveAlertsResult = { ok: true } | { ok: false; error: string };

export async function saveAlerts(formData: FormData): Promise<SaveAlertsResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  /*
     Business-wide policy, so owner and manager. 7e §1 splits this from a sales
     seat's own channels, which are further down this file and are gated on
     being your own rather than on a capability at all.

     `routing.manage` rather than `listing.edit`, which is what this used to
     assert. Both are owner and manager, so nothing changes about who gets in —
     but who the business is told about a lead is a routing decision, not an
     edit to the public profile, and a guard that names the wrong question is a
     guard that moves the wrong way when one of them changes.
  */
  assertCan(seat.actor, "routing.manage");

  const before = await prisma.notificationPreference.findUnique({
    where: { businessId: seat.businessId },
    select: { routing: true, quietHoursEnabled: true },
  });
  const previous = (before?.routing ?? {}) as Record<string, string[]>;

  const routing: Record<string, string[]> = {};
  for (const event of EVENTS) {
    const on = CHANNELS.filter((channel) => formData.get(`matrix.${event}.${channel}`) === "on");
    /*
       7e §2.2, enforced rather than only rendered. The checkbox is disabled on
       screen and a disabled checkbox posts nothing at all, so without this line
       every locked row would lose its in-app channel on the first save — the
       exact opposite of the rule.
    */
    if (ALWAYS_IN_APP.includes(event) && !on.includes("in_app")) on.push("in_app");
    if (on.length > 0) routing[event] = on;
  }

  const hour = (name: string, fallback: number): number => {
    const value = Number(formData.get(name));
    return Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
  };

  /*
   * An empty override means never, which is different from zero. Zero would
   * mean every enquiry overrides quiet hours, which is quiet hours switched
   * off by a route the UI does not offer.
   */
  const rawOverride = String(formData.get("highValueOverrideAed") ?? "").trim();
  const parsedOverride = Number(rawOverride.replace(/[,\s]/g, ""));
  const highValueOverrideAed =
    rawOverride === "" || !Number.isFinite(parsedOverride) || parsedOverride <= 0
      ? null
      : Math.round(parsedOverride);

  const escalateAfterMinutes = pick(formData.get("escalateAfterMinutes"), ESCALATION_CHOICES, 120);
  const nudgeAfterHours = pick(formData.get("nudgeAfterHours"), NUDGE_CHOICES, 24);
  const quietHoursEnabled = formData.get("quietHoursEnabled") === "on";

  /*
     One number, two doors.

     `NotificationPreference.escalateAfterMinutes` and
     `Business.leadEscalationMinutes` are the same setting, written by this
     screen and by Team settings respectively, and until board 8d neither was
     read by anything — so a seller could set 30 here and 240 there and the
     disagreement was invisible because nothing acted on either. The escalation
     sweep reads `leadEscalationMinutes`, which makes the other one a control
     that lies.
  */
  await prisma.business.update({
    where: { id: seat.businessId },
    data: { leadEscalationMinutes: escalateAfterMinutes },
  });

  const values = {
    routing,
    quietHoursEnabled,
    quietFromHour: hour("quietFromHour", 21),
    quietToHour: hour("quietToHour", 7),
    quietOnSunday: formData.get("quietOnSunday") === "on",
    highValueOverrideAed,
    escalateAfterMinutes,
    nudgeEnabled: formData.get("nudgeEnabled") === "on",
    nudgeAfterHours,
  };

  await prisma.notificationPreference.upsert({
    where: { businessId: seat.businessId },
    create: { businessId: seat.businessId, ...values },
    update: values,
  });

  /*
     One event per cell that actually moved, written from a diff rather than
     from the form. "Which channel do sellers turn off first" is the question,
     and a `settings_saved` event answers none of it — while an event per
     checkbox on the form would count forty unchanged boxes on every save.
  */
  for (const event of EVENTS) {
    const was = new Set(previous[event] ?? []);
    const now = new Set(routing[event] ?? []);
    for (const channel of CHANNELS) {
      if (was.has(channel) === now.has(channel)) continue;
      await recordEvent({
        name: "notification_toggled",
        businessId: seat.businessId,
        props: { event, channel, on: now.has(channel) },
      });
    }
  }
  if ((before?.quietHoursEnabled ?? true) !== quietHoursEnabled) {
    await recordEvent({
      name: "quiet_hours_changed",
      businessId: seat.businessId,
      props: { on: quietHoursEnabled },
    });
  }

  revalidatePath("/dashboard/settings");
  // Team settings shows the same number under the routing control.
  revalidatePath("/dashboard/team");
  return { ok: true };
}

/**
 * The out-of-hours acknowledgement. Board 7e §4.
 *
 * The body is a seller's own words and is stored as typed, with two guards: a
 * length a buyer can read on a phone, and no token outside the three that get
 * filled in. An unknown token would reach the buyer as `{first_name}` in the
 * middle of a sentence, which reads as a broken supplier rather than a broken
 * setting.
 */
export async function saveAutoReply(formData: FormData): Promise<SaveAlertsResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCan(seat.actor, "routing.manage");

  const enabled = formData.get("autoReplyEnabled") === "on";
  const body = String(formData.get("autoReplyBody") ?? "").trim();

  if (body.length > AUTO_REPLY_MAX) {
    return { ok: false, error: t("autoreply.too_long", { max: String(AUTO_REPLY_MAX) }) };
  }
  const unknown = unknownTokens(body);
  if (unknown.length > 0) {
    return { ok: false, error: t("autoreply.unknown_token", { token: `{${unknown[0]}}` }) };
  }

  const before = await prisma.business.findUniqueOrThrow({
    where: { id: seat.businessId },
    select: { autoReplyEnabled: true },
  });

  await prisma.business.update({
    where: { id: seat.businessId },
    // Empty means "use the default copy", which is what `sendAutoReply` reads a
    // null as. Storing an empty string instead would send a blank message.
    data: { autoReplyEnabled: enabled, autoReplyBody: body === "" ? null : body },
  });

  if (before.autoReplyEnabled !== enabled) {
    await recordEvent({
      name: "autoreply_toggled",
      businessId: seat.businessId,
      props: { on: enabled },
    });
  }

  revalidatePath("/dashboard/settings");
  return { ok: true };
}

export type ChannelActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/**
 * Your own channels, and only your own.
 *
 * No capability check, deliberately, and that is not an omission. 7d §6.1 says
 * this screen must "not show one seat's numbers to another seat" — so there is
 * no version of this an owner does more of. `lib/team/channels.ts` acts on
 * `actor.id` and takes no parameter that could point it elsewhere, which makes
 * the rule structural rather than a check somebody could forget.
 */
export async function sendChannelCode(formData: FormData): Promise<ChannelActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const kind = String(formData.get("kind") ?? "") as SeatChannelKind;
  const address = String(formData.get("address") ?? "");

  const result = await startVerification(seat.actor, { kind, address });
  if (!result.ok) return result;

  revalidatePath("/dashboard/settings");
  return {
    ok: true,
    message: result.sent
      ? t("channels.code_sent", { address })
      : t("channels.code_not_sent", { address }),
  };
}

export async function confirmChannelCode(formData: FormData): Promise<ChannelActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const kind = String(formData.get("kind") ?? "") as SeatChannelKind;
  const result = await confirmVerification(seat.actor, {
    kind,
    code: String(formData.get("code") ?? ""),
  });
  if (!result.ok) return result;

  revalidatePath("/dashboard/settings");
  // The team screen's REACHABLE ON column reads the same rows.
  revalidatePath("/dashboard/team");
  return {
    ok: true,
    message: t("channels.verified_now", {
      channel: t(`channels.kind.${kind}` as "channels.kind.whatsapp"),
    }),
  };
}

export async function dropChannel(formData: FormData): Promise<ChannelActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const kind = String(formData.get("kind") ?? "") as SeatChannelKind;
  const result = await removeChannel(seat.actor, kind);
  if (!result.ok) return result;

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/team");
  return {
    ok: true,
    message: t("channels.removed", {
      channel: t(`channels.kind.${kind}` as "channels.kind.whatsapp"),
    }),
  };
}

function pick<T extends number>(value: FormDataEntryValue | null, allowed: readonly T[], fallback: T): T {
  const parsed = Number(value);
  return allowed.includes(parsed as T) ? (parsed as T) : fallback;
}
