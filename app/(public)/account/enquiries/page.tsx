import Link from "next/link";
import { Card, PublicShell } from "@/components/structure";
import { StatusBadge, type StatusTone } from "@/components/display/StatusBadge";
import { requireBuyerSeat } from "@/lib/auth/buyer";
import { getBuyerEnquiries } from "@/lib/db/queries/enquiry";
import { formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";

/**
 * Board 10e — the buyer's enquiry inbox.
 *
 * Signed in only. A buyer with no account tracks a single enquiry by the link
 * they were given; a list of everything they have ever sent needs an identity
 * that survives a browser, which is what an account is for.
 */
export const metadata = { title: t("account.enquiries.title") };
export const dynamic = "force-dynamic";

export default async function AccountEnquiriesPage() {
  const { actor } = await requireBuyerSeat("/account/enquiries");

  const enquiries = await getBuyerEnquiries(actor.id);
  const now = new Date();

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[56rem] px-[var(--section-pad)] py-8">
      <h1 className="font-serif text-h1-serif text-ink">{t("account.enquiries.title")}</h1>

      {enquiries.length === 0 ? (
        <div className="mt-6">
          <Card padded>
            <h2 className="text-h3 text-ink">{t("account.enquiries.empty_title")}</h2>
            <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-muted">
              {t("account.enquiries.empty_body")}
            </p>
            <p className="mt-3">
              <Link
                href="/"
                className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("account.enquiries.browse")}
              </Link>
            </p>
          </Card>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-card border border-line bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left">
              <caption className="sr-only">{t("account.enquiries.caption")}</caption>
              <thead>
                <tr className="bg-paper-sunk">
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("account.enquiries.col.ref")}</th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("account.enquiries.col.requirement")}</th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("account.enquiries.col.sent")}</th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("account.enquiries.col.quotes")}</th>
                  <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">{t("account.enquiries.col.status")}</th>
                </tr>
              </thead>
              <tbody>
                {enquiries.map((enquiry) => {
                  const open = !enquiry.accepted && enquiry.closesAt.getTime() > now.getTime();
                  const tone: StatusTone = enquiry.accepted ? "ok" : open ? "info" : "neutral";
                  return (
                    <tr key={enquiry.id} className="border-t border-line align-top">
                      <th scope="row" className="px-3 py-3 text-left font-normal">
                        <Link
                          href={`/enquiry/${enquiry.id}`}
                          className="rounded-tag font-mono text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                        >
                          {enquiry.ref}
                        </Link>
                      </th>
                      <td className="max-w-[24rem] px-3 py-3">
                        <span className="line-clamp-2 text-body-sm text-ink">{enquiry.requirement}</span>
                      </td>
                      <td className="px-3 py-3 text-body-sm text-muted">
                        {formatRelative(enquiry.createdAt, { now })}
                      </td>
                      <td className="px-3 py-3 text-body-sm text-ink">
                        {t("account.enquiries.quotes_count", { count: enquiry.quoteCount })}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge tone={tone} size="sm" shape="chip">
                          {enquiry.accepted
                            ? t("account.enquiries.status.accepted")
                            : open
                              ? t("account.enquiries.status.open")
                              : t("account.enquiries.status.closed")}
                        </StatusBadge>
                        {!open && !enquiry.accepted ? (
                          <span className="mt-0.5 block text-caption text-muted">
                            {formatDate(enquiry.closesAt)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </PublicShell>
  );
}
