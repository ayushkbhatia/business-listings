"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth/session";
import { isSellsChoice, setSellsKind } from "@/lib/onboarding/kind";
import { t } from "@/lib/i18n";

/**
 * Board `2b-s` — record the declaration and move on.
 *
 * Thin, like every other action here: read the form, ask the service, redirect.
 * The rule about what may be answered lives in `lib/onboarding/kind.ts`, where
 * it is tested without a request.
 */
export async function chooseKind(formData: FormData): Promise<{ ok: false; error: string } | void> {
  const actor = await getActor();
  if (!actor?.businessId) redirect("/onboarding/claim");

  const kind = String(formData.get("kind") ?? "");
  if (!isSellsChoice(kind)) return { ok: false, error: t("kind.continue_none") };

  const result = await setSellsKind(actor.businessId, kind);
  if (!result.ok) {
    /*
       A published seller who reaches this action has come back to a URL rather
       than through the funnel. Send them where the change actually belongs
       instead of refusing in place — Settings confirms it and says what it
       costs, which this screen deliberately does not.
    */
    if (result.error === "published") redirect("/dashboard/settings");
    return { ok: false, error: t("kind.error_generic") };
  }

  revalidatePath("/onboarding/kind");
  revalidatePath("/onboarding/profile");
  redirect("/onboarding/profile");
}
