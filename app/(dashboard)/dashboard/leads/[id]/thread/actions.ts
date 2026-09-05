"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import { postSellerMessage } from "@/lib/messaging/service";
import {
  cancelFollowUp,
  scheduleFollowUp,
  sendFollowUp,
  DEFAULT_NUDGE_AFTER_HOURS,
} from "@/lib/messaging/follow-up";
import { getSellerSeat } from "../../../_shell";

/**
 * The thread's writes.
 *
 * Thin on purpose: resolve who is acting, hand the work to the service, and
 * revalidate what changed. Every invariant lives in lib/messaging/, where it can
 * be tested against a real database without a request — see
 * tests/integration/thread.test.ts and tests/integration/follow-up.test.ts.
 */

/** The seller's half of the thread. Same service as the buyer's. */
export async function sendSellerMessage(input: {
  enquiryId: string;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await postSellerMessage(seat.actor, seat.businessId, {
    enquiryId: input.enquiryId,
    body: input.body,
  });

  if (!result.ok) {
    return {
      ok: false,
      error: result.error === "closed" ? t("thread.closed") : t("thread.not_yours"),
    };
  }

  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

const FOLLOW_UP_ERROR = {
  not_a_participant: "thread.not_yours",
  already_nudged: "thread.nudge_help",
  no_quote_yet: "thread.nudge_not_yet",
  empty: "thread.nudge_empty",
  replied: "thread.nudge_replied",
} as const;

function followUpError(code: keyof typeof FOLLOW_UP_ERROR): string {
  return t(FOLLOW_UP_ERROR[code]);
}

/**
 * Arm the one follow-up.
 *
 * The body is the seller's, stored now rather than composed by the job later —
 * board 11b requires the draft to be editable before it sends, and text written
 * at three in the morning is text the seller never saw.
 */
export async function scheduleFollowUpAction(input: {
  enquiryId: string;
  body: string;
  afterHours?: number;
}): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await scheduleFollowUp({
    enquiryId: input.enquiryId,
    businessId: seat.businessId,
    body: input.body,
    afterHours: input.afterHours ?? DEFAULT_NUDGE_AFTER_HOURS,
  });
  if (!result.ok) return { ok: false, error: followUpError(result.error) };

  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  return { ok: true };
}

/** Disarm it. Turning the toggle off is the whole cancellation. */
export async function cancelFollowUpAction(
  enquiryId: string,
): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  await cancelFollowUp(enquiryId, seat.businessId);
  revalidatePath(`/dashboard/leads/${enquiryId}/thread`);
  return { ok: true };
}

/**
 * Send it now rather than waiting for the schedule.
 *
 * The same service the sweep calls, so a follow-up sent by hand and one sent by
 * the clock are the same row with the same tag. Two paths writing two different
 * messages is how one feature becomes two.
 */
export async function sendFollowUpNow(input: {
  enquiryId: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await sendFollowUp({
    enquiryId: input.enquiryId,
    businessId: seat.businessId,
    senderId: seat.actor.id,
    body: input.body,
    source: "thread",
  });
  if (!result.ok) return { ok: false, error: followUpError(result.error) };

  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}
