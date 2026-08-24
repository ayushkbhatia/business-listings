import Link from "next/link";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";

/**
 * A 404 with a reason.
 *
 * `getLeadDetail` returns null both for an enquiry that does not exist and for
 * one that was sent to a different supplier — deliberately the same answer, so
 * the page cannot be used to find out which enquiries exist. The copy says the
 * true thing for both cases without confirming either.
 */
export default function LeadNotFound() {
  return (
    <div className="p-[var(--section-pad)]">
      <Card padded>
        <h1 className="text-h3 text-ink">{t("lead.not_found_title")}</h1>
        <p className="mt-2 max-w-prose text-body-sm text-muted">{t("lead.not_found_body")}</p>
        <p className="mt-4">
          <Link
            href="/dashboard/leads"
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("lead.back_to_leads")}
          </Link>
        </p>
      </Card>
    </div>
  );
}
