import { questionsForSeller } from "@/lib/questions/service";
import { formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { QuestionCard } from "./QuestionCards";

/**
 * Board 1g's other half, for the seller.
 *
 * The product page renders one answered question and counts the rest, and
 * nothing on the platform could answer one until this screen existed. A model
 * with no writer is the bug the licence-expiry job was — a rule the schema
 * promises and nothing performs.
 *
 * Unanswered first, because those are the ones costing the seller: a buyer who
 * asked and got nothing is a buyer who went to the next supplier, and the
 * question is a lead with the intent already written down.
 */
export const metadata = { title: "Questions" };
export const dynamic = "force-dynamic";

export default async function SellerQuestionsPage() {
  const seat = await requireSellerSeat();
  const [questions, badges] = await Promise.all([
    questionsForSeller(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  const business = await import("@/lib/db/client").then(({ prisma }) =>
    prisma.business.findUnique({ where: { id: seat.businessId }, select: { slug: true } }),
  );

  const waiting = questions.filter((question) => question.answeredAt === null).length;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/questions"
      eyebrow={t("questions.eyebrow")}
      title={t("questions.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-body">{t("questions.intro")}</p>

        {waiting > 0 && (
          <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-warn-ink">
            {t("questions.unanswered", { count: waiting })}
          </p>
        )}

        {questions.length === 0 ? (
          <p className="text-body-sm text-body">{t("questions.none")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {questions.map((question) => (
              <QuestionCard
                key={question.id}
                question={{
                  id: question.id,
                  body: question.body,
                  answer: question.answer,
                  answeredLabel: question.answeredAt
                    ? t("questions.answered_when", { when: formatRelative(question.answeredAt) })
                    : null,
                  askedLabel: t("questions.asked_when", {
                    when: formatRelative(question.createdAt),
                  }),
                  productName: question.product.name,
                  productHref: business
                    ? `/b/${business.slug}/p/${question.product.slug}`
                    : "#",
                }}
                labels={{
                  about: t("questions.asked_about", { product: question.product.name }),
                  answerLabel: t("questions.answer_label"),
                  answerHint: t("questions.answer_hint"),
                  submit: t("questions.answer_submit"),
                  viewProduct: t("questions.view_product"),
                }}
              />
            ))}
          </div>
        )}
      </div>
    </SellerPage>
  );
}
