"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/errors";
import { getActor } from "@/lib/auth/session";
import { claimSubdomain, releaseSubdomain } from "@/lib/domains/service";
import { t } from "@/lib/i18n";

/** Board 5e's two seller actions. Taking the address, and giving it up. */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/**
 * Every refusal the service can return, mapped to something a seller can act on.
 *
 * `empty`, `too_long`, `not_a_label` and `reserved` describe a slug that cannot
 * become an address. None is the seller's fault and none is fixable by them —
 * a slug is set on the listing, and a business genuinely called "WWW" cannot be
 * given `www`. They all say the same thing for that reason: ask us.
 */
const REFUSAL: Record<string, string> = {
  empty: "domain.error.unusable",
  too_long: "domain.error.unusable",
  not_a_label: "domain.error.unusable",
  reserved: "domain.error.unusable",
  not_entitled: "domain.error.not_entitled",
  taken: "domain.error.taken",
  already_have_one: "domain.error.already",
};

export async function claimAddress(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("domain.error.not_entitled") };

  try {
    const result = await claimSubdomain(actor, actor.businessId);
    if (!result.ok) {
      return { ok: false, error: t((REFUSAL[result.error] ?? "domain.error.unusable") as never) };
    }
    revalidatePath("/dashboard/domain");
    return { ok: true, message: t("domain.added") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("domain.error.not_entitled") };
    throw error;
  }
}

export async function dropAddress(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("domain.error.not_entitled") };

  try {
    await releaseSubdomain(actor, actor.businessId);
    revalidatePath("/dashboard/domain");
    return { ok: true, message: t("domain.removed") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("domain.error.not_entitled") };
    throw error;
  }
}
