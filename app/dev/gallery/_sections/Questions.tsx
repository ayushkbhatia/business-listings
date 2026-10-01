"use client";

import { QuestionList, type QuestionRow } from "@/app/(admin)/admin/questions/QuestionList";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board 1g's staff side — `/admin/questions` — in the states a row can be in.
 *
 * Answered, unanswered and removed. The removed one stays on the list with its
 * reason, because a removal that leaves no trace reads as a question that was
 * never asked. Removing here does nothing: the action is a refusal.
 */

const REFUSED = async () => ({ ok: false as const, error: t("dev.no_seat_title") });

const LABELS = {
  remove: t("admin.questions.remove"),
  reasonLabel: t("admin.questions.reason_label"),
  removedTone: t("admin.questions.removed_tone"),
  empty: t("admin.questions.none"),
};

const ROWS: QuestionRow[] = [
  {
    id: "q_unanswered",
    business: "Gulf Flow Controls",
    businessSlug: "gulf-flow-controls",
    product: "Butterfly valve, wafer, DN150",
    productSlug: "butterfly-valve-wafer-dn150",
    body: "Do you hold DN200 in the same range?",
    answer: null,
    askedAt: "14 Sep 2026",
    removedAt: null,
    removalReason: null,
  },
  {
    id: "q_answered",
    business: "Gulf Flow Controls",
    businessSlug: "gulf-flow-controls",
    product: "Butterfly valve, wafer, DN150",
    productSlug: "butterfly-valve-wafer-dn150",
    body: "Is the seat EPDM or NBR? We are on potable water and the consultant has specified WRAS.",
    answer:
      "EPDM as standard, and it is WRAS approved — the certificate is on this page. NBR is available on indent, about three weeks.",
    askedAt: "2 Sep 2026",
    removedAt: null,
    removalReason: null,
  },
  {
    id: "q_removed",
    business: "Gulf Flow Controls",
    businessSlug: "gulf-flow-controls",
    product: "Butterfly valve, wafer, DN150",
    productSlug: "butterfly-valve-wafer-dn150",
    body: "Can we agree the price on WhatsApp instead and leave the enquiry out of it?",
    answer: null,
    askedAt: "11 Sep 2026",
    removedAt: "12 Sep 2026",
    removalReason: "Invites the seller to move the deal off-platform.",
  },
];

export function QuestionsGallery() {
  return (
    <Section
      id="admin-questions"
      title="Product questions"
      note="Board 1g — staff removal, with the reason kept on the row"
    >
      <States label="Answered, unanswered and removed" stack>
        <QuestionList rows={ROWS} remove={REFUSED} labels={LABELS} />
      </States>

      <States label="Nothing to review" stack>
        <QuestionList rows={[]} remove={REFUSED} labels={LABELS} />
      </States>
    </Section>
  );
}
