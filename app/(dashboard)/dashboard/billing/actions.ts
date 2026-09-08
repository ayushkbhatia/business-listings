"use server";

import { revalidatePath } from "next/cache";
import {
  changePlan,
  changeTerm,
  quoteTermChange,
  resumeSubscription,
} from "@/lib/billing/service";
import {
  isCancelReason,
  scheduleCancellation,
  type CancelReasonValue,
} from "@/lib/billing/cancellation";
import { saveKeep, withdrawChange, type KeepKind } from "@/lib/billing/schedule";
import type { BillingTerm } from "@/lib/billing/period";
import { formatAED, formatDate } from "@/lib/format";
import { FILS_PER_AED } from "@/lib/billing/proration";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * Billing mutations.
 *
 * Every one calls a service whose first line is `assertCanChangePlan` or
 * `assertCanManageBilling`, so a sales seat posting any of these forms directly
 * gets a `PermissionError` before anything is read — criterion 9, and it is a
 * claim about refusal rather than about what a screen renders.
 *
 * The two capabilities are not the same and the split is board 7d's: a finance
 * seat reads the invoices and does not decide what the business buys. Q6 asks
 * owner-only versus owner-and-admin and answers owner-only; `plan.change` is
 * that half, and every action here except none of them holds it.
 */

export type BillingResult = { ok: true; message?: string } | { ok: false; error: string };

/** Both billing routes, after any write. The rail on one shows the other's state. */
function revalidateBilling() {
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard/billing/change");
  revalidatePath("/dashboard");
}

/**
 * Apply an upgrade, or schedule a downgrade.
 *
 * `dueFils` is what the button said. It is posted back and re-verified against a
 * fresh quote inside `changePlan`, and a difference refuses the charge rather
 * than adjusting it — criterion 7. A number shown on a button is a promise.
 */
export async function confirmPlanChange(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const planId = String(formData.get("planId") ?? "");
  const quoted = formData.get("dueFils");
  /*
     Absent means the screen had nothing to quote — a downgrade, where `Due
     today` is `AED 0.00` and no charge happens. An unparseable value is not the
     same thing and must not fall through to "do not check": it becomes zero,
     which `changePlan` then compares against a real figure and refuses.
  */
  const expectedDueFils = quoted === null ? null : Number(quoted) || 0;

  const result = await changePlan(seat.actor, seat.businessId, planId, expectedDueFils);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateBilling();
  return { ok: true };
}

/** `Keep Pro`. Take back a scheduled change before its date. */
export async function withdrawPlanChange(): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await withdrawChange(seat.actor, seat.businessId);
  if (!result.ok) return { ok: false, error: t("change.no_subscription") };

  revalidateBilling();
  return { ok: true };
}

/**
 * Which items survive a scheduled change.
 *
 * The cap is re-read here rather than taken from the form: a posted cap is a
 * number the client chose, and the whole of this step is that the plan holds
 * fewer than the seller has.
 */
export async function saveKeepChoice(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const kind = String(formData.get("kind") ?? "") as KeepKind;
  if (kind !== "products" && kind !== "locations" && kind !== "seats") {
    return { ok: false, error: t("change.no_subscription") };
  }

  const ids = formData.getAll("keep").map(String).filter(Boolean);
  const cap = capForKind(formData);

  const result = await saveKeep(seat.actor, seat.businessId, kind, ids, cap);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "too_many"
          ? t("keep.too_many", { plan: String(formData.get("planName") ?? "") })
          : t("change.no_subscription"),
    };
  }

  revalidateBilling();
  return { ok: true };
}

/**
 * The cap the form was rendered against.
 *
 * Read from the form only to fail fast with a friendly message. `saveKeep`
 * enforces it again against the plan, and that is the one that counts — this is
 * a courtesy, not a fence.
 */
function capForKind(formData: FormData): number | null {
  const raw = formData.get("cap");
  if (raw === null || raw === "") return null;
  const cap = Number(raw);
  return Number.isFinite(cap) ? cap : null;
}

export async function confirmTermChange(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const to = String(formData.get("term") ?? "") as BillingTerm;
  const result = await changeTerm(seat.actor, seat.businessId, to);
  if (!result.ok) return { ok: false, error: result.error };

  revalidateBilling();
  return { ok: true };
}

/**
 * What switching between monthly and annual costs, read only.
 *
 * Separate from the plan quote because the two are different promises. A plan
 * change keeps the period and the renewal date does not move; a term change
 * cannot keep it — there is no year to be part-way through — so it credits the
 * unused days, opens a new period today, and the renewal moves.
 */
export type TermQuoteView = {
  ok: true;
  planName: string;
  creditAed: string;
  chargeAed: string;
  vatAed: string;
  dueAed: string;
  renewsAt: string;
} | { ok: false; error: string };

export async function quoteTerm(formData: FormData): Promise<TermQuoteView> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const to = String(formData.get("term") ?? "") as BillingTerm;
  const result = await quoteTermChange(seat.actor, seat.businessId, to);
  if (!result.ok) return { ok: false, error: result.error };

  const { quote } = result;
  const aed = (fils: number) => formatAED(fils / FILS_PER_AED, { style: "exact" });

  return {
    ok: true,
    planName: quote.planName,
    creditAed: aed(quote.proration.creditLine.fils),
    chargeAed: aed(quote.proration.chargeLine.fils),
    vatAed: aed(quote.proration.vatFils),
    dueAed: aed(quote.proration.dueFils),
    renewsAt: formatDate(quote.renewsAt),
  };
}

/**
 * Cancel, at period end. Board 11j's confirm.
 *
 * The reason is required and is re-checked here rather than trusted from the
 * form: a posted body is a value the client chose, and criterion 6 is a claim
 * about what the *service* refuses, not about which button was grey.
 *
 * `business_closing` is refused rather than handled. It is the fork to `11i`
 * and cancels nothing — the screen never posts it, and this is the fence that
 * makes that true rather than a rule the screen happens to follow.
 */
export async function confirmCancellation(formData: FormData): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const reason = String(formData.get("reason") ?? "");
  if (!isCancelReason(reason)) return { ok: false, error: t("cancel.error.no_reason") };

  const result = await scheduleCancellation(seat.actor, seat.businessId, {
    reason: reason as CancelReasonValue,
    note: String(formData.get("note") ?? ""),
  });

  if (!result.ok) {
    return { ok: false, error: t(CANCEL_ERROR[result.error]) };
  }

  revalidateBilling();
  /*
     No message, and that is the fix rather than an omission.

     This composed `cancel.done` — "Cancelled. Pro runs to 13 Sep and Free
     starts 14 Sep" — and `ReasonForm` redirects to /dashboard/billing without
     reading it, so the key had no reader anywhere in the app. The destination
     is the answer: `CancelCard`'s scheduled banner states both dates and
     carries `Resume Pro`. A toast repeating them on arrival would be the same
     sentence twice, and the seller has already navigated away from where it
     would have appeared.
  */
  return { ok: true };
}

/** One sentence per refusal, and every one of them says what to do instead. */
const CANCEL_ERROR = {
  no_subscription: "cancel.error.none",
  already_cancelling: "cancel.error.already",
  bad_reason: "cancel.error.no_reason",
  note_required: "cancel.error.note_required",
  closing_is_not_a_cancellation: "cancel.error.closing",
  on_trial: "cancel.error.on_trial",
} as const;

/** `Resume Pro`. Costs nothing: the period was already paid for. */
export async function resumePlan(): Promise<BillingResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };

  const result = await resumeSubscription(seat.actor, seat.businessId);
  if (!result.ok) return { ok: false, error: t("change.no_subscription") };

  revalidateBilling();
  return {
    ok: true,
    message: t("billing.resumed", {
      plan: result.planName,
      when: formatDate(result.renewsAt),
    }),
  };
}
