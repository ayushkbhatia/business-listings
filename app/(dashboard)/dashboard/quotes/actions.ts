"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/lib/i18n";
import { sendFollowUp } from "@/lib/messaging/follow-up";
import { extendQuote } from "@/lib/quotes/extend";
import { getSellerSeat } from "../_shell";

/**
 * The pipeline's two writes.
 *
 * Extend is this board's own; the follow-up is board 11b's, reached from a
 * second surface. It goes through the same service for the reason 11b's own
 * card does: one follow-up per lead, enforced server-side, and a second path
 * that wrote its own message would be a second way to spend a cap that is
 * supposed to be absolute.
 *
 * There is deliberately no compose action here. `Revise` and `Re-quote` are
 * links into board 3j's composer — this screen never becomes a second place
 * where money is typed (3j §5, the price rule).
 */

const EXTEND_ERROR = {
  not_your_quote: "quotes.error.not_your_quote",
  not_yours_to_extend: "quotes.error.not_yours_to_extend",
  expired: "quotes.error.expired",
  decided: "quotes.error.decided",
  too_far: "quotes.error.too_far",
  backwards: "quotes.error.backwards",
  suspended: "quotes.error.suspended",
} as const;

function revalidatePipeline(enquiryId?: string): void {
  revalidatePath("/dashboard/quotes");
  revalidatePath("/dashboard/leads");
  if (enquiryId) revalidatePath(`/dashboard/leads/${enquiryId}/thread`);
}

export async function extendQuoteAction(input: {
  quoteId: string;
  /** An ISO date. The client owns the picker; the service owns the ceiling. */
  until: string;
}): Promise<{ ok: boolean; error?: string; until?: string }> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("quotes.error.not_your_quote") };

  const until = new Date(input.until);
  if (Number.isNaN(until.getTime())) {
    return { ok: false, error: t("quotes.error.backwards") };
  }

  const result = await extendQuote(seat.actor, seat.businessId, {
    quoteId: input.quoteId,
    until,
  });
  if (!result.ok) return { ok: false, error: t(EXTEND_ERROR[result.error]) };

  revalidatePipeline();
  return { ok: true, until: result.expiresAt.toISOString() };
}

/**
 * The one follow-up, spent from the pipeline.
 *
 * `source` is the only thing that differs from sending it in the thread — the
 * message, the tag and the cap are identical, because they are the same act.
 */
export async function nudgeFromPipelineAction(input: {
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
    source: "pipeline",
  });
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "already_nudged"
          ? t("thread.nudge_help")
          : result.error === "replied"
            ? t("thread.nudge_replied")
            : result.error === "empty"
              ? t("thread.nudge_empty")
              : t("thread.nudge_not_yet"),
    };
  }

  revalidatePipeline(input.enquiryId);
  return { ok: true };
}
