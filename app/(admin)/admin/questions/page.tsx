import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/staff";
import { can } from "@/lib/auth/can";
import { questionsForModeration } from "@/lib/questions/service";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { AdminPage, getAdminNavBadges } from "../../_shell";
import { QuestionList, type QuestionRow } from "./QuestionList";

/**
 * Board 1g — product questions, and removing one.
 *
 * Gated on `question.remove`, which is ops lead alone. A product question
 * carries a buyer's published words and a seller's answer, and taking it down
 * is the same decision as removing a review — so it sits at the same rung
 * rather than with the moderation queue, and a moderator gets a 404 here.
 */

export const dynamic = "force-dynamic";

export default async function AdminQuestionsPage() {
  const seat = await requireStaff();
  if (!can(seat.actor, "question.remove")) notFound();

  const [questions, badges] = await Promise.all([
    questionsForModeration(),
    getAdminNavBadges(seat),
  ]);

  const rows: QuestionRow[] = questions.map((question) => ({
    id: question.id,
    business: question.business.displayName,
    businessSlug: question.business.slug,
    product: question.product.name,
    productSlug: question.product.slug,
    body: question.body,
    answer: question.answer,
    askedAt: formatDate(question.createdAt),
    removedAt: question.removedAt ? formatDate(question.removedAt) : null,
    removalReason: question.removalReason,
  }));

  return (
    <AdminPage
      seat={seat}
      badges={badges}
      activeHref="/admin/questions"
      title={t("admin.questions.title")}
      eyebrow={t("admin.reviews.eyebrow")}
    >
      <QuestionList
        rows={rows}
        labels={{
          remove: t("admin.questions.remove"),
          reasonLabel: t("admin.questions.reason_label"),
          removedTone: t("admin.reviews.removed"),
          empty: t("admin.questions.none"),
        }}
      />
    </AdminPage>
  );
}
