"use server";

import { revalidatePath } from "next/cache";
import {
  cancelSubscription,
  changePlan,
  changeTerm,
  quotePlanChange,
  quoteTermChange,
} from "@/lib/billing/service";
import type { BillingTerm } from "@/lib/billing/period";
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
      // A plan change keeps the period. The screen says so, and it is only
      // true of this action — see `quoteTerm` below.
      renewalMoves: false,
    },
  };
}

/**
 * What switching between monthly and annual costs.
 *
 * Separate from `quoteChange` because the two are different promises. A plan
 * change keeps the period and the renewal date does not move; a term change
 * cannot keep it — there is no year to be part-way through — so it credits the
 * unused days, opens a new period today, and the renewal date moves.
 */
export async function quoteTerm(formData: FormData): Promise<QuoteActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const to = String(formData.get("term") ?? "") as BillingTerm;
  const result = await quoteTermChange(seat.actor, seat.businessId, to);
  if (!result.ok) return result;

  const { quote } = result;
  return {
    ok: true,
    quote: {
      planId: to,
      planName: quote.planName,
      credit:
        quote.proration.creditLine.fils > 0
          ? {
              planName: quote.planName,
              days: quote.proration.creditLine.days,
              aed: filsToAed(quote.proration.creditLine.fils),
            }
          : null,
      charge: {
        planName: quote.planName,
        days: quote.proration.chargeLine.days,
        aed: filsToAed(quote.proration.chargeLine.fils),
      },
      netAed: filsToAed(Math.abs(quote.proration.netFils)),
      netIsCharge: quote.proration.netFils >= 0,
      renewsAt: formatDate(quote.renewsAt),
      renewalMoves: true,
    },
  };
}

export async function confirmTermChange(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await changeTerm(
    seat.actor,
    seat.businessId,
    String(formData.get("term") ?? "") as BillingTerm,
  );
  if (!result.ok) return result;

  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard");
  return { ok: true };
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
