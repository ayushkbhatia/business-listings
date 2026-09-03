"use server";

import { revalidatePath } from "next/cache";
import { assertCan } from "@/lib/auth/can";
import { prisma } from "@/lib/db/client";
import { answerQuestion } from "@/lib/questions/service";
import { t } from "@/lib/i18n";
import { getSellerSeat } from "../_shell";

/**
 * The one thing a seller may do about a question: answer it, once.
 *
 * Not here and never will be: deleting one. A question a supplier can make
 * disappear is a question nobody believes the answer to — the same rule
 * `dashboard/reviews/actions.ts` states about reviews, and for the same reason.
 * Removal goes to a person, with a written reason on an audit row.
 */
export type QuestionActionResult = { ok: true } | { ok: false; error: string };

export async function postAnswer(formData: FormData): Promise<QuestionActionResult> {
  const seat = await getSellerSeat();
  if (!seat) return { ok: false, error: t("dev.no_seat_title") };
  assertCan(seat.actor, "listing.edit");

  const result = await answerQuestion({
    businessId: seat.businessId,
    questionId: String(formData.get("questionId") ?? ""),
    answer: String(formData.get("answer") ?? ""),
    answeredBy: seat.actor.id,
  });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.error === "already_answered"
          ? t("questions.answer_once")
          : result.error === "removed"
            ? t("questions.removed")
            : result.error === "empty"
              ? t("questions.answer_empty")
              : result.error === "too_long"
                ? t("questions.answer_too_long")
                : t("dev.no_seat_title"),
    };
  }

  revalidatePath("/dashboard/questions");

  /*
     And the storefront the answer appears on. The product page revalidates
     every five minutes on its own, but a seller who answers and immediately
     checks their own listing should see it there rather than wonder whether it
     saved. The slug is looked up because a seat carries the business id and
     name, not the slug.
  */
  const business = await prisma.business.findUnique({
    where: { id: seat.businessId },
    select: { slug: true },
  });
  if (business) revalidatePath(`/b/${business.slug}`, "layout");
  return { ok: true };
}
