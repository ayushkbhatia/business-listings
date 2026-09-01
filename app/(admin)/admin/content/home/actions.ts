"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { HOME_CACHE_TAG } from "@/lib/db/queries/home";
import { setOnHome } from "@/lib/content/homepage";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function toggleHome(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  try {
    const result = await setOnHome(
      seat.actor,
      String(formData.get("categoryId") ?? ""),
      formData.get("showOnHome") === "on",
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    revalidatePath("/admin/content/home");
    /*
       The home page reads the session — a signed-in seller must not be shown a
       claim CTA — so it is a dynamic route and has no path cache for
       `revalidatePath("/")` to clear. Its *data* is what is cached, under one
       tag, so clearing the tag is what actually makes a trade appear there.
    */
    // Two arguments in Next 16 — the single-argument form is deprecated.
    // `expire: 0` rather than the "max" profile: "max" is stale-while-
    // revalidate, and a staff member who has just put a trade on the home page
    // should be able to load the home page and see it there.
    revalidateTag(HOME_CACHE_TAG, { expire: 0 });
    return { ok: true, message: t("home.saved", { count: formatCount(result.shown) }) };
  } catch (error) {
    if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
    if (error instanceof AuditReasonError) return { ok: false, error: t("builder.needs_reason") };
    throw error;
  }
}
