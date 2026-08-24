"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createReview } from "@/lib/reviews/service";
import { t } from "@/lib/i18n";
import { resolveBuyerId } from "@/app/(public)/enquiry/_buyer";

/**
 * Posting a review.
 *
 * Thin: resolve who is asking, hand it to the service. Every rule about who
 * may write one is in lib/reviews, where it is tested against a real database
 * — the page offering the form is not the thing that decides.
 */
export type PostReviewResult = { ok: false; error: string };

export async function postReview(formData: FormData): Promise<PostReviewResult> {
  const enquiryId = String(formData.get("enquiryId") ?? "");
  const token = formData.get("t");
  const buyerId = await resolveBuyerId(typeof token === "string" ? token : null);
  if (!buyerId) return { ok: false, error: t("review.error.not_your_enquiry") };

  const score = (name: string): number => Number(formData.get(name) ?? 0);

  const result = await createReview({
    buyerId,
    enquiryId,
    ratings: {
      overall: score("overall"),
      quotedAccurate: score("quotedAccurate"),
      onTime: score("onTime"),
      asDescribed: score("asDescribed"),
      responsiveness: score("responsiveness"),
    },
    body: String(formData.get("body") ?? ""),
    showCompanyName: formData.get("showCompanyName") === "on",
  });

  if (!result.ok) {
    return {
      ok: false,
      error: t(`review.error.${result.error}` as "review.error.no_accepted_quote"),
    };
  }

  revalidatePath(`/enquiry/${enquiryId}`);
  revalidatePath("/dashboard/reviews");
  const carry = typeof token === "string" && token ? `&t=${token}` : "";
  redirect(`/review/new?enq=${enquiryId}&posted=1${carry}`);
}
