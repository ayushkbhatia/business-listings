"use server";

import { revalidatePath } from "next/cache";
import { PermissionError } from "@/lib/auth/errors";
import { getActor } from "@/lib/auth/session";
import { addDomain, removeDomain } from "@/lib/domains/service";
import { t } from "@/lib/i18n";

/** Board 5e's two seller actions. Claiming an address, and giving it up. */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const REFUSAL: Record<string, string> = {
  not_a_hostname: "domain.error.not_a_hostname",
  apex_domain: "domain.error.apex",
  our_own_domain: "domain.error.ours",
  not_entitled: "domain.error.not_entitled",
  taken: "domain.error.taken",
  already_have_one: "domain.error.already",
};

export async function claimDomain(formData: FormData): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("domain.error.not_entitled") };

  try {
    const result = await addDomain(actor, actor.businessId, String(formData.get("hostname") ?? ""));
    if (!result.ok) {
      return { ok: false, error: t((REFUSAL[result.error] ?? "domain.error.not_a_hostname") as never) };
    }
    revalidatePath("/dashboard/domain");
    return { ok: true, message: t("domain.added") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("domain.error.not_entitled") };
    throw error;
  }
}

export async function dropDomain(): Promise<ActionResult> {
  const actor = await getActor();
  if (!actor?.businessId) return { ok: false, error: t("domain.error.not_entitled") };

  try {
    await removeDomain(actor, actor.businessId);
    revalidatePath("/dashboard/domain");
    return { ok: true, message: t("domain.removed") };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("domain.error.not_entitled") };
    throw error;
  }
}
