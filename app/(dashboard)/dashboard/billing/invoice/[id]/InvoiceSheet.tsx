import type { TaxInvoiceDocument } from "@/lib/billing/tax-invoice";
import { t } from "@/lib/i18n";

/**
 * The document itself, at A4.
 *
 * Board 11g's rule: **the render is not a preview of the document, it is the
 * document.** This component and `lib/billing/invoice-pdf.ts` render the same
 * `TaxInvoiceDocument` and neither computes a figure — which is what makes the
 * claim checkable rather than asserted. Anything that is a fact about the
 * invoice is inside this sheet; the panels beside it are tagged `Not in the PDF`
 * precisely because they are not.
 *
 * ## The sheet is a page, not a card
 *
 * 210 × 297 mm — 794 × 1123 px at 96 dpi, with 20 mm side margins. It does not
 * grow with its content and it does not scroll: the footnote, the statutory
 * placeholder and the page foot sit at the foot of the sheet whatever the table
 * above them did. A seller comparing this to the PDF is looking at one geometry.
 *
 * A server component. Nothing here is interactive — criterion 10 is that no
 * control on this route writes to the invoice, and the simplest way to hold that
 * is to have no client code in the document at all.
 */
export function InvoiceSheet({ document }: { document: TaxInvoiceDocument }) {
  const isCredit = document.docType === "credit_note";
  const currency = document.totals.currency;

  return (
    <article
      /*
         A4 at 96 dpi, fixed. `min-h` rather than `h` so a table that overflows
         pushes the page taller on screen rather than clipping the evidence —
         the PDF paginates properly, and a clipped total on screen would be the
         worse failure of the two.
      */
      className="mx-auto w-[794px] min-h-[1123px] max-w-full shrink-0 bg-card px-[76px] py-[64px] shadow-sm"
      aria-label={isCredit ? t("invoice.title_credit") : t("invoice.title")}
    >
      <header className="flex items-start justify-between gap-8">
        <div>
          <p className="font-serif text-h2 text-ink">Business Listings</p>
          <div className="mt-2.5 text-caption leading-relaxed text-muted">
            {/*
               The supplier as stored at issue, not as we are today. This entity
               has already been restated once — a UAE company with a TRN became a
               Delaware one with none — and a constant would have rewritten every
               invoice ever sent.
            */}
            <p>{document.supplier.name}</p>
            {document.supplier.addressLines.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {document.supplier.incorporation && <p>{document.supplier.incorporation}</p>}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
            {isCredit ? t("invoice.heading_credit") : t("invoice.heading")}
          </p>
          <p className="mt-1.5 font-mono text-body text-ink">{document.ref}</p>
          <p className="mt-2 inline-flex items-center rounded-pill bg-ok-wash px-2 py-0.5 text-caption font-medium text-ok-ink">
            {document.status === "paid"
              ? t("invoice.paid_badge")
              : document.status === "overdue"
                ? t("invoice.overdue_badge")
                : t("invoice.issued_badge")}
          </p>
        </div>
      </header>

      <div className="mt-7 border-t border-line pt-6">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <p className="text-caption text-muted">{t("invoice.billed_to")}</p>
            <p className="mt-1.5 text-body font-medium text-ink">{document.recipient.name}</p>
            {document.recipient.addressLines.map((line) => (
              <p key={line} className="text-caption text-body-ink">
                {line}
              </p>
            ))}
            {document.recipient.trn && (
              <p className="mt-1 font-mono text-caption text-ink">
                {t("invoice.recipient_trn", { trn: document.recipient.trn })}
              </p>
            )}
          </div>

          <div className="text-caption">
            <p className="text-muted">{t("invoice.dates_heading")}</p>
            {/*
               The heading sits outside the list, and each `dt`/`dd` pair is a
               **direct** child of it.

               Both were wrong first time and axe caught both: a `<p>` inside a
               `<dl>` is a `definition-list` violation, and wrapping the pairs in
               a second `<div>` put every `dt` two levels down, which is
               `dlitem` — twenty nodes of it. A `<div>` around one pair is
               allowed; a `<div>` around all of them is not.
            */}
            <dl className="mt-1.5 flex flex-col gap-1">
              <DateRow label={t("invoice.date_of_issue")} value={document.issuedOn} />
              <DateRow label={t("invoice.date_of_supply")} value={document.suppliedOn} />
              <DateRow label={t("invoice.supply_period")} value={document.supplyPeriod} />
              <DateRow label={t("invoice.place_of_supply")} value={document.placeOfSupply} />
              <DateRow label={t("invoice.currency")} value={currency} />
            </dl>
          </div>
        </div>
      </div>

      {/*
         Per-line VAT, not one blended row.

         A single `VAT 5%` line is arithmetically right for an invoice whose lines
         are all standard-rated and wrong as a document design: the first
         zero-rated, exempt or out-of-scope line has nowhere to go, and a
         document's layout cannot change after issue.
      */}
      <table className="mt-7 w-full border-collapse text-caption">
        <caption className="sr-only">
          {isCredit ? t("invoice.title_credit") : t("invoice.title")} {document.ref}
        </caption>
        <thead>
          <tr className="border-y border-line bg-paper-sunk">
            <th scope="col" className="px-3 py-2.5 text-left font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.description")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.qty")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.unit", { currency })}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.rate")}
            </th>
            <th scope="col" className="px-2 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.vat", { currency })}
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
              {t("invoice.col.amount", { currency })}
            </th>
          </tr>
        </thead>
        <tbody>
          {document.lines.map((line) => (
            <tr key={line.id} className="border-b border-line-soft">
              <th scope="row" className="px-3 py-3 text-left font-normal text-ink">
                {line.description}
                <span className="mt-0.5 block text-caption text-muted">
                  {[line.bookingRef ? t("invoice.booking", { ref: line.bookingRef }) : null, line.detail]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </th>
              <td className="px-2 py-3 text-right tabular-nums text-body-ink">{line.qty}</td>
              <Cell value={line.unitAed} />
              <td className="px-2 py-3 text-right tabular-nums text-body-ink">
                {line.rate ?? <NotStored />}
              </td>
              <Cell value={line.vatAed} />
              <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
                {line.amountAed}
              </td>
            </tr>
          ))}

          <tr className="border-b border-line-soft">
            <th scope="row" colSpan={5} className="px-3 py-3 text-left font-normal text-body-ink">
              {t("invoice.subtotal")}
            </th>
            <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
              {document.totals.subtotalAed}
            </td>
          </tr>
          <tr className="border-b border-line-soft">
            <th scope="row" colSpan={5} className="px-3 py-3 text-left font-normal text-body-ink">
              {t("invoice.vat_total")}
            </th>
            <td className="px-3 py-3 text-right font-mono tabular-nums text-ink">
              {document.totals.vatAed}
            </td>
          </tr>
          <tr className="bg-paper-sunk">
            <th scope="row" colSpan={5} className="px-3 py-3.5 text-left font-medium text-ink">
              {t("invoice.total", { currency })}
            </th>
            <td className="px-3 py-3.5 text-right font-mono text-body font-medium tabular-nums text-ink">
              {document.totals.totalAed}
            </td>
          </tr>
        </tbody>
      </table>

      {/*
         Payment provenance, inside the document.

         The board had the payment date, the card and the bank in a screen-only
         rail — three facts about the transaction, absent from the artefact that
         evidences it. That is the largest correction on this board.
      */}
      {document.payment && (
        <div className="mt-6 grid gap-6 rounded-ctl border border-line px-5 py-4 sm:grid-cols-2">
          <div>
            <p className="font-mono text-eyebrow uppercase tracking-[0.1em] text-muted">
              {t("invoice.payment_heading")}
            </p>
            <p className="mt-2 text-caption text-ink">
              {t("invoice.paid_on", { when: document.payment.paidOn })}
            </p>
            {document.payment.brand && document.payment.last4 && (
              <p className="mt-1 text-caption text-muted">
                {t("invoice.paid_card", {
                  brand: document.payment.brand,
                  last4: document.payment.last4,
                })}
              </p>
            )}
          </div>
          <div>
            <p className="font-mono text-eyebrow uppercase tracking-[0.1em] text-muted">
              {t("invoice.references_heading")}
            </p>
            <div className="mt-2 flex flex-col gap-1 font-mono text-caption text-ink">
              {document.references.pspRef && <span>{document.references.pspRef}</span>}
              {document.references.subscriptionRef && (
                <span>{document.references.subscriptionRef}</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* The credit-note reference slot, reserved by Q5 so a document sellers
          have already downloaded never has to be re-laid-out for it. */}
      {document.correctsRef && (
        <p className="mt-4 text-caption text-muted">
          {t("invoice.corrects", { ref: document.correctsRef })}
        </p>
      )}

      <footer className="mt-10 border-t border-line pt-5">
        <p className="text-caption leading-relaxed text-muted">
          {t("invoice.footnote", { currency, ref: document.ref })}
        </p>

        {/*
           The statutory sentence, held open and visibly so — spec Q3. A US
           supplier charging 5% to a UAE recipient changes the heading, this
           footnote and possibly the VAT lines. A dashed box says which question
           is open; a silently absent footnote would look finished.
        */}
        <p className="mt-4 rounded-ctl border border-dashed border-line-strong px-4 py-3 text-caption leading-relaxed text-muted">
          {t("invoice.statutory_pending")}
        </p>

        <div className="mt-6 flex items-baseline justify-between gap-4 border-t border-line pt-3 font-mono text-eyebrow uppercase tracking-[0.08em] text-muted">
          <span>
            {document.ref} · {document.supplier.name}
          </span>
          <span>{t("invoice.page_foot", { page: "1", pages: "1" })}</span>
        </div>
      </footer>
    </article>
  );
}

function DateRow({ label, value }: { label: string; value: string | null }) {
  // Unfilled data stays visible rather than being hidden — an invoice missing a
  // date of supply is a fact about that invoice, and the reader should see it.
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink">{value ?? <NotStored />}</dd>
    </div>
  );
}

/**
 * A figure that was never stored.
 *
 * An invoice issued before board 11g has no per-line VAT and no unit price, and
 * deriving one now from today's rate would be indistinguishable from one that
 * was actually charged. Saying so is the whole point of criterion 2.
 */
function NotStored() {
  return <span className="text-muted">{t("invoice.not_stored")}</span>;
}

function Cell({ value }: { value: string | null }) {
  return (
    <td className="px-2 py-3 text-right font-mono tabular-nums text-body-ink">
      {value ?? <NotStored />}
    </td>
  );
}
