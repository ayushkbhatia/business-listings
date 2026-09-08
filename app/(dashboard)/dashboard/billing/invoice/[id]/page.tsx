import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { mayManageBilling } from "@/lib/auth/guards";
import { taxInvoiceDocument, type TaxInvoiceDocument } from "@/lib/billing/tax-invoice";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { InvoiceSheet } from "./InvoiceSheet";
import { EmailInvoice } from "./EmailInvoice";

/**
 * Board 11g — the tax invoice.
 *
 * The only screen on the platform that is a legal document. Everything else on
 * the seller surface is an interface onto live records; this is a rendering of a
 * record that must never change again.
 *
 * ## The rule
 *
 * **The render is not a preview of the document. It is the document.** So
 * anything that is a fact about the invoice sits inside the sheet, and the three
 * panels beside it — provenance, delivery and the plain-language restatement —
 * are each tagged `Not in the PDF`. That tag is the design decision rather than
 * decoration: it is how a reader can tell what a forwarded PDF will and will not
 * say.
 *
 * ## Nothing on this route writes to the invoice
 *
 * Criterion 10. The two actions that exist — download and email — write to the
 * *delivery log*, which is a record of what happened to the document rather than
 * a change to it.
 */
/**
 * The tab says which document this is.
 *
 * A static `Tax invoice` was wrong on every credit note — and a seller with
 * three tabs open looking for the correction has only the title to go on. Read
 * from the row rather than from the route, because the route is the same one.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await prisma.invoice.findUnique({
    where: { id },
    select: { docType: true, ref: true },
  });
  if (!invoice) return { title: t("invoice.title") };
  const kind = invoice.docType === "credit_note" ? t("invoice.title_credit") : t("invoice.title");
  return { title: `${kind} ${invoice.ref}` };
}

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const seat = await requireSellerSeat();

  /*
     Owner and finance, by navigation and by URL — criterion 11.

     `taxInvoiceDocument` asserts the same capability and would throw, but a
     throw is a 500 and this is a route a manager could type. `notFound` is the
     honest answer: for them, this document does not exist.
  */
  if (!mayManageBilling(seat.actor)) notFound();

  const { id } = await params;
  const [document, badges] = await Promise.all([
    taxInvoiceDocument(seat.actor, seat.businessId, id),
    getNavBadges(seat.businessId),
  ]);

  // Another business's invoice, or a draft. A 404 either way: a seller who edits
  // the id in the address bar has made a mistake, not an attack.
  if (!document) notFound();

  const isCredit = document.docType === "credit_note";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("invoice.eyebrow")}
      title={isCredit ? t("invoice.title_credit") : t("invoice.title")}
      meta={<span className="font-mono text-caption text-muted">{document.ref}</span>}
      breadcrumb={
        <Link
          href="/dashboard/billing"
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("invoice.back")}
        </Link>
      }
      actions={
        <EmailInvoice
          invoiceId={document.id}
          address={document.billingEmail}
          sendLabel={
            document.billingEmail
              ? t("invoice.email_to", { address: document.billingEmail })
              : t("invoice.email_none")
          }
          downloadLabel={t("invoice.download")}
          downloadHref={document.pdf ? `/dashboard/billing/invoice/${document.id}/pdf` : null}
        />
      }
    >
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,794px)_minmax(0,1fr)]">
        <div className="min-w-0 overflow-x-auto">
          <InvoiceSheet document={document} />
        </div>
        <Rail document={document} />
      </div>
    </SellerPage>
  );
}

/**
 * The three panels that are on screen and not in the document.
 *
 * Each carries the tag, and the tag is load-bearing: the board put the payment
 * date, the card and the bank in a screen-only rail while claiming the PDF and
 * the screen were identical. They are inside the sheet now, and what is left out
 * here says that it is left out.
 */
function Rail({ document }: { document: TaxInvoiceDocument }) {
  return (
    <aside className="flex flex-col gap-3.5">
      <Card surface="card" padded>
        <PanelHead label={t("invoice.document_heading")} tagged={false} />
        <p className="mt-2.5 text-caption leading-relaxed text-body-ink">
          {t("invoice.document_note")}
        </p>

        {document.pdf ? (
          <div className="mt-3.5 flex items-center gap-3 border-t border-line-soft pt-3.5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-tag bg-fill font-mono text-eyebrow uppercase text-muted"
            >
              PDF
            </span>
            <span className="min-w-0">
              <span className="block truncate font-mono text-caption text-ink">
                {t("invoice.document_file", { ref: document.ref })}
              </span>
              <span className="mt-0.5 block text-caption text-muted">
                {t("invoice.document_meta", {
                  when: document.issuedOn,
                  size: formatBytes(document.pdf.bytes),
                })}
              </span>
            </span>
          </div>
        ) : (
          /*
             No stored file. Said plainly rather than offering a download that
             would have to render one on demand — which would be a different
             document from the one this screen claims to be showing.
          */
          <p className="mt-3.5 border-t border-line-soft pt-3.5 text-caption leading-relaxed text-muted">
            {t("invoice.document_missing")}
          </p>
        )}
      </Card>

      <Card surface="card" padded>
        <PanelHead label={t("invoice.delivery_heading")} tagged />
        {document.delivery.length === 0 ? (
          <p className="mt-2.5 text-caption text-muted">{t("invoice.delivery.none")}</p>
        ) : (
          <ul className="mt-2.5 flex flex-col gap-2">
            {document.delivery.map((event) => (
              <li key={event.id} className="flex items-baseline justify-between gap-3 text-caption">
                <span className="min-w-0 text-body-ink">
                  {event.kind === "emailed"
                    ? t("invoice.delivery.emailed", { who: event.who })
                    : t("invoice.delivery.downloaded", { who: event.who })}
                </span>
                <span className="shrink-0 text-muted">{event.when}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3.5 border-t border-line-soft pt-3 text-caption leading-relaxed text-muted">
          {t("invoice.delivery.address_note")}
        </p>
      </Card>

      <Card surface="card" padded>
        <PanelHead label={t("invoice.covers_heading")} tagged />
        <ul className="mt-2.5 flex flex-col gap-2.5">
          {document.lines.map((line) => (
            <li key={line.id} className="flex items-baseline justify-between gap-3 text-caption">
              <span className="min-w-0 text-body-ink">
                {line.description}
                <span className="mt-0.5 block text-muted">{line.detail}</span>
              </span>
              {line.bookingRef ? (
                /*
                   Text, not a link. `11e` owns the booking detail page and is
                   blocked on `12c`, so there is no route to send anybody to —
                   the same refusal `11d` makes about a quote list that does not
                   exist.
                */
                <span className="shrink-0 text-muted">{t("invoice.covers_no_page")}</span>
              ) : (
                <Link
                  href="/dashboard/billing/change"
                  className="shrink-0 rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
                >
                  {t("invoice.covers_plan")}
                </Link>
              )}
            </li>
          ))}
        </ul>
        {document.lines.some((line) => line.bookingRef) && (
          <p className="mt-3 border-t border-line-soft pt-3 text-caption leading-relaxed text-warn-ink">
            {t("invoice.covers_placement_note")}
          </p>
        )}
      </Card>

      <Card surface="paper" padded>
        <p className="text-caption font-medium text-ink">{t("invoice.fixed_heading")}</p>
        <p className="mt-2 text-caption leading-relaxed text-body-ink">{t("invoice.fixed_body")}</p>
        <p className="mt-2 text-caption leading-relaxed text-muted">{t("invoice.fixed_access")}</p>
      </Card>
    </aside>
  );
}

function PanelHead({ label, tagged }: { label: string; tagged: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">{label}</p>
      {tagged && (
        <span className="shrink-0 rounded-tag border border-line px-1.5 py-0.5 font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
          {t("invoice.not_in_pdf")}
        </span>
      )}
    </div>
  );
}
