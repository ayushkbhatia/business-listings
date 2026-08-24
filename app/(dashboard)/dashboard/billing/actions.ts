"use server";

import { revalidatePath } from "next/cache";
import { cancelSubscription, changePlan, quotePlanChange } from "@/lib/billing/service";
import { filsToAed } from "@/lib/billing/proration";
import { formatDate } from "@/lib/format";
import type { ChangeQuote } from "./change/PlanChooser";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Billing mutations.
 *
 * Both call a service whose first line is `assertCanChangePlan`, so a sales
 * seat posting either of these forms directly gets a PermissionError before
 * anything is read — criterion 9, and it is a claim about refusal rather than
 * about what a screen renders.
 */

export type BillingResult = { ok: true } | { ok: false; error: string };

export type QuoteActionResult =
  | { ok: true; quote: ChangeQuote }
  | { ok: false; error: string };

/** Reads only. Nothing is charged and nothing is written until confirm. */
export async function quoteChange(formData: FormData): Promise<QuoteActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await quotePlanChange(
    seat.actor,
    seat.businessId,
    String(formData.get("planId") ?? ""),
  );
  if (!result.ok) return result;

  const { quote } = result;
  return {
    ok: true,
    quote: {
      planId: quote.toPlan.id,
      planName: quote.toPlan.name,
      credit:
        quote.proration.creditLine.fils > 0
          ? {
              planName: quote.fromPlan.name,
              days: quote.proration.creditLine.days,
              aed: filsToAed(quote.proration.creditLine.fils),
            }
          : null,
      charge: {
        planName: quote.toPlan.name,
        days: quote.proration.chargeLine.days,
        aed: filsToAed(quote.proration.chargeLine.fils),
      },
      netAed: filsToAed(Math.abs(quote.proration.netFils)),
      netIsCharge: quote.proration.netFils >= 0,
      renewsAt: formatDate(quote.proration.renewsAt),
    },
  };
}

export async function confirmPlanChange(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await changePlan(seat.actor, seat.businessId, String(formData.get("planId") ?? ""));
  if (!result.ok) return result;

  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function confirmCancellation(): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await cancelSubscription(seat.actor, seat.businessId);
  if (!result.ok) return result;

  revalidatePath("/dashboard/billing");
  return { ok: true };
}
