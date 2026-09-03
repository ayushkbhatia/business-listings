"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import { requireStaff } from "@/lib/auth/staff";
import { deleteTestimonial, TESTIMONIAL_CACHE_TAG, saveTestimonial, setTestimonialPublished } from "@/lib/content/testimonials";
import { asAudience } from "@/app/(public)/_entry/audience";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * The three writes behind `/admin/content/testimonials`.
 *
 * Each one revalidates the entry-page tag rather than a path. `/for-buyers` and
 * `/list-your-business` cache their quotes for an hour under `TESTIMONIAL_CACHE_TAG`,
 * so clearing the tag is the thing that actually makes an edit appear — the
 * same reasoning `/admin/content/home` writes down for the home page.
 */
function refresh(): void {
  revalidatePath("/admin/content/testimonials");
  // Two arguments in Next 16; `expire: 0` rather than the "max" profile, which
  // is stale-while-revalidate. Somebody who has just published a quote should
  // be able to load the page and see it.
  revalidateTag(TESTIMONIAL_CACHE_TAG, { expire: 0 });
}

function failure(error: unknown): ActionResult {
  if (error instanceof PermissionError) return { ok: false, error: t("matrix.not_yours") };
  if (error instanceof AuditReasonError) return { ok: false, error: t("testimonial.needs_reason") };
  throw error;
}

export async function saveQuote(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const audience = asAudience(formData.get("audience"));
  if (!audience) return { ok: false, error: t("testimonial.audience") };

  const rawOrder = String(formData.get("sortOrder") ?? "").trim();
  const parsedOrder = Number.parseInt(rawOrder, 10);

  try {
    const result = await saveTestimonial(
      seat.actor,
      {
        ...(formData.get("id") ? { id: String(formData.get("id")) } : {}),
        audience,
        body: String(formData.get("body") ?? ""),
        attribution: String(formData.get("attribution") ?? ""),
        context: String(formData.get("context") ?? ""),
        ...(Number.isFinite(parsedOrder) ? { sortOrder: parsedOrder } : {}),
      },
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    refresh();
    return { ok: true, message: t("testimonial.saved") };
  } catch (error) {
    return failure(error);
  }
}

export async function publishQuote(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();
  const published = formData.get("published") === "on";

  try {
    const result = await setTestimonialPublished(
      seat.actor,
      String(formData.get("id") ?? ""),
      published,
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    refresh();
    return {
      ok: true,
      message: t(published ? "testimonial.published_count" : "testimonial.unpublished_count", {
        count: formatCount(result.shown),
      }),
    };
  } catch (error) {
    return failure(error);
  }
}

export async function removeQuote(formData: FormData): Promise<ActionResult> {
  const seat = await requireStaff();

  try {
    const result = await deleteTestimonial(
      seat.actor,
      String(formData.get("id") ?? ""),
      String(formData.get("reason") ?? ""),
    );
    if (!result.ok) return { ok: false, error: result.message };

    refresh();
    return { ok: true, message: t("testimonial.deleted") };
  } catch (error) {
    return failure(error);
  }
}
