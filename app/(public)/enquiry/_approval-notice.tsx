import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import type { RequestCard } from "@/lib/buyer-company/queue";
import { formatDate, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * Board `7b` — a line on the comparison and the thread saying a quote on this
 * enquiry is with a colleague for approval, so the person does not accept a
 * second one wondering where the first went.
 */
export function ApprovalNotice({ card }: { card: RequestCard }) {
  const text =
    card.state.kind === "queried"
      ? t("company.notice.queried", { quote: card.quoteRef, name: card.decidedByName ?? t("company.approval.a_colleague") })
      : card.state.kind === "pending"
        ? t("company.notice.pending", {
            quote: card.quoteRef,
            names: card.approverNames.length > 0 ? formatList(card.approverNames) : t("company.rule.an_admin"),
            date: formatDate(card.raisedAt),
          })
        : t("company.notice.lapsed", { quote: card.quoteRef });
  return (
    <div className="mt-4">
      <Alert
        tone={card.state.kind === "queried" ? "warn" : "info"}
        live="off"
        action={
          <Link
            href={`/account/company/approvals/${card.id}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("company.notice.open")}
          </Link>
        }
      >
        {text}
      </Alert>
    </div>
  );
}
