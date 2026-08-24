import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, KeyValuePanel, Panel, PublicShell } from "@/components/structure";
import { getAcceptedRecord } from "@/lib/db/queries/enquiry";
import { formatAED, formatDate, formatPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { resolveBuyerId, trackingTokenFor } from "../../_buyer";

/**
 * Board 7c — the accepted quote record.
 *
 * The terminal state, and it is a record rather than a receipt. Nothing was
 * paid here and nothing will be: the supplier contacts the buyer, they settle
 * it between them, and this page is the evidence of what was agreed. The copy
 * says that plainly, because a page that looks like a checkout confirmation
 * will be read as one.
 */
export const dynamic = "force-dynamic";

export default async function AcceptedPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const token = typeof query["t"] === "string" ? query["t"] : null;

  const buyerId = await resolveBuyerId(token);
  if (!buyerId) notFound();

  const record = await getAcceptedRecord(buyerId, id);
  if (!record) notFound();

  const carry = (await trackingTokenFor(buyerId)) ?? null;
  const location = record.business.locations[0];

  return (
    <PublicShell nav={<DirectoryNav />} footer={<DirectoryFooter />}>
      <div className="mx-auto w-full max-w-[46rem] px-[var(--section-pad)] py-8">
      <p className="font-mono text-eyebrow uppercase text-faint">{t("enquiry.ref", { ref: record.ref })}</p>
      <h1 className="mt-2 font-serif text-h1-serif text-ink">{t("accepted.title")}</h1>
      <p className="mt-2 max-w-[var(--measure-prose)] text-prose text-prose">
        {t("accepted.lede", { supplier: record.business.displayName })}
      </p>

      <div className="mt-6 space-y-[var(--gutter)]">
        <Panel title={t("accepted.contact")}>
          <p className="text-body text-ink">{record.business.displayName}</p>
          {location?.addressLine ? (
            <p className="mt-0.5 text-body-sm text-muted">
              {[location.addressLine, location.area?.name].filter(Boolean).join(", ")}
            </p>
          ) : null}
          <dl className="mt-3 space-y-1">
            {location?.phone ? (
              <div className="flex gap-2">
                <dt className="text-caption text-muted">{t("storefront.phone")}</dt>
                <dd className="font-mono text-body-sm text-ink">{formatPhone(location.phone)}</dd>
              </div>
            ) : null}
            {location?.whatsapp ? (
              <div className="flex gap-2">
                <dt className="text-caption text-muted">WhatsApp</dt>
                <dd className="font-mono text-body-sm text-ink">{formatPhone(location.whatsapp)}</dd>
              </div>
            ) : null}
          </dl>
        </Panel>

        <Panel title={t("accepted.record")} description={t("accepted.record_body")}>
          <KeyValuePanel
            columns={2}
            notProvidedLabel={t("table.not_provided")}
            entries={[
              { key: "quote", label: t("term.quote"), value: `${record.quoteRef} · r${record.revision}` },
              {
                key: "accepted",
                label: t("accepted.accepted_on"),
                value: record.acceptedAt ? formatDate(record.acceptedAt) : undefined,
              },
              { key: "value", label: t("accepted.value"), value: formatAED(record.totalAed) },
              { key: "supplier", label: t("accepted.supplier"), value: record.business.displayName },
            ]}
          />
          <p className="mt-2 text-caption text-muted">{t("accepted.value_note")}</p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">{t("compare.quotes_caption")}</caption>
              <thead>
                <tr className="bg-paper-sunk">
                  <th scope="col" className="px-3 py-1.5 text-caption font-normal text-muted">{t("compare.line")}</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">{t("quote.col.qty")}</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">{t("quote.col.unit_price")}</th>
                  <th scope="col" className="px-3 py-1.5 text-right text-caption font-normal text-muted">{t("compare.lead_time")}</th>
                </tr>
              </thead>
              <tbody>
                {record.lines.map((line) => (
                  <tr key={line.id} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-body-sm text-ink">
                      {line.description}
                    </th>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-body-sm">{line.qty}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-body-sm">
                      {formatAED(line.unitPrice, { style: "quote" })}
                    </td>
                    <td className="px-3 py-2 text-right text-body-sm text-muted">
                      {line.leadTimeDays === null
                        ? t("table.not_provided")
                        : t("quote.validity_days", { count: line.leadTimeDays })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {record.note ? (
            <p className="mt-3 max-w-[var(--measure-prose)] text-body-sm text-prose">{record.note}</p>
          ) : null}
        </Panel>

        {/* No invoice, no payment, no delivery tracking. Said, not implied. */}
        <Card padded>
          <h2 className="text-body-sm text-ink">{t("accepted.what_next")}</h2>
          <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted">
            {t("accepted.what_next_body")}
          </p>
        </Card>

        <p className="flex flex-wrap gap-4">
          <Link
            href={
              carry
                ? `/review/new?enq=${record.enquiryId}&t=${carry}`
                : `/review/new?enq=${record.enquiryId}`
            }
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("accepted.review")}
          </Link>
          <Link
            href={carry ? `/enquiry/${record.enquiryId}?t=${carry}` : `/enquiry/${record.enquiryId}`}
            className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("enquiry.track")}
          </Link>
        </p>
      </div>
      </div>
    </PublicShell>
  );
}
