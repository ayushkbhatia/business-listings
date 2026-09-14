"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { PermissionError } from "@/lib/auth/errors";
import { requestClosure, reverseAsOwner } from "@/lib/closure/service";
import { CLOSURE_DONE_COOKIE, encodeDone, type ClosureDoneCookie } from "@/lib/closure/done-cookie";
import { revalidateClosure } from "@/lib/closure/revalidate";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../../_shell";

/**
 * Board `11i` — the two writes an owner makes on this screen.
 *
 * Nothing here decides anything. `requestClosure` asserts the capability,
 * re-reads both blockers inside its own transaction and refuses on its own;
 * this resolves the seat, maps the refusal to words, and revalidates.
 */

export type RequestClosureActionResult = { ok: false; error: string };

function maskEmail(address: string | null): string | null {
  if (!address) return null;
  const [local, domain] = address.split("@");
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

export async function requestClosureAction(formData: FormData): Promise<RequestClosureActionResult> {
  const seat = await getSellerSeat();
  if (!seat || seat.viewingAs || seat.isDevSeat) {
    return { ok: false, error: t("closure.error.no_seat") };
  }

  // The checkbox is part of the request, not only of the form. A request posted
  // without it was not made by somebody who read what they were agreeing to.
  if (formData.get("understood") !== "yes") {
    return { ok: false, error: t("closure.error.not_understood") };
  }

  try {
    const result = await requestClosure(seat.actor);
    if (!result.ok) {
      switch (result.error) {
        case "blocked":
          return { ok: false, error: t("closure.error.blocked") };
        case "already_closing":
          return { ok: false, error: t("closure.error.already_closing") };
        case "closed":
          return { ok: false, error: t("closure.error.closed") };
        default:
          return { ok: false, error: t("closure.error.not_found") };
      }
    }

    const done: ClosureDoneCookie = {
      businessName: seat.businessName,
      finalOn: formatDate(result.finalAt),
      emailed: result.emailDelivered,
      emailTo: maskEmail(result.emailTo),
    };
    (await cookies()).set(CLOSURE_DONE_COOKIE, encodeDone(done), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/account/closed",
      maxAge: 60 * 30,
    });
    revalidateClosure(result.slug);
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("closure.error.owner_only") };
    throw error;
  }

  // Outside the try: `redirect` works by throwing, and the catch above would
  // otherwise see it as an error to classify.
  redirect("/account/closed");
}

export type ReverseActionResult = { ok: false; error: string };

/** The reversal screen's button, for an owner who signed in again during the window. */
export async function reverseAsOwnerAction(): Promise<ReverseActionResult> {
  const actor = await getActor();
  if (!actor) redirect("/signin?next=/dashboard/account/close");

  const result = await reverseAsOwner(actor);
  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "expired" || result.error === "final"
          ? t("closure.reopen.error_expired")
          : result.error === "already_reversed"
            ? t("closure.reopen.error_already")
            : t("closure.reopen.error_generic"),
    };
  }

  revalidateClosure(result.slug);
  redirect("/dashboard?notice=reopened");
}
