"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import {
  postSellerMessage,
  signSellerThreadAttachment,
  type PostMessageError,
} from "@/lib/messaging/service";
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

function refusalWords(error: PostMessageError | "unavailable"): string {
  switch (error) {
    case "supplier_closed":
      return t("thread.supplier_closed");
    case "closed":
      return t("thread.closed");
    case "not_chosen":
      return t("thread.not_chosen");
    case "type":
      return t("negotiation.attach.error_type");
    case "size":
      return t("negotiation.attach.error_size");
    case "count":
      return t("negotiation.attach.error_count");
    case "attachment_missing":
      return t("negotiation.attach.error_missing");
    case "unavailable":
      return t("negotiation.attach.error_unavailable");
    default:
      return t("thread.not_yours");
  }
}

/** The seller's half of the thread. Same service as the buyer's. */
export async function sendSellerMessage(input: {
  enquiryId: string;
  body: string;
  attachments?: { path: string; filename: string }[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await postSellerMessage(seat.actor, seat.businessId, {
    enquiryId: input.enquiryId,
    body: input.body,
    attachments: (input.attachments ?? []).slice(0, 10).map((file) => ({
      path: String(file.path),
      filename: String(file.filename),
    })),
  });

  if (!result.ok) return { ok: false, error: refusalWords(result.error) };

  revalidatePath(`/dashboard/leads/${input.enquiryId}/thread`);
  revalidatePath("/dashboard/leads");
  return { ok: true };
}

/** A signed upload for one file a seat is about to send — board `10h` Q5, the seller's side. */
export async function signSellerAttachmentAction(input: {
  enquiryId: string;
  filename: string;
  type: string;
  bytes: number;
}): Promise<{ ok: true; url: string; path: string } | { ok: false; error: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("thread.not_yours") };

  const result = await signSellerThreadAttachment(seat.actor, seat.businessId, {
    enquiryId: input.enquiryId,
    filename: String(input.filename),
    type: String(input.type),
    bytes: Number(input.bytes),
  });
  return result.ok ? result : { ok: false, error: refusalWords(result.error) };
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
