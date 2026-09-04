"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { startTrial, type StartTrialResult } from "@/lib/billing/trial";
import { t } from "@/lib/i18n";

/**
 * Board 2e's one mutation.
 *
 * Choosing Basic, or Pro without a trial, is a link to `/dashboard/billing/change`
 * rather than an action here — that screen quotes the proration and takes the
 * confirmation, and a plan bought from a card on an onboarding page with no
 * quote in front of it is a charge somebody did not agree to. The trial is
 * different precisely because there is nothing to agree to: criterion 12, no
 * card, so the only decision is whether it starts.
 */

export type TrialActionResult = { ok: true; endsAt: string } | { ok: false; error: string };

export async function beginProTrial(): Promise<TrialActionResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("dev.no_seat_title") };

  const result: StartTrialResult = await startTrial(actor, actor.businessId);
  if (!result.ok) {
    return { ok: false, error: t(`plan_step.trial_error.${result.reason}` as never) };
  }

  /*
     Both surfaces, because the plan a seller is on decides what each of them
     renders: the funnel's own step and the dashboard they land on next. The
     storefront is left alone — a plan change moves ranking weight and caps, not
     anything a buyer reads on the page.
  */
  revalidatePath("/onboarding/plan");
  revalidatePath("/dashboard");
  return { ok: true, endsAt: result.endsAt.toISOString() };
}
