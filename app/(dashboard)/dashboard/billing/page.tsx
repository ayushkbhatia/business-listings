import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { StatusBadge, type StatusTone } from "@/components/display";
import { Panel } from "@/components/structure";
import { prisma } from "@/lib/db/client";
import { invoicesFor } from "@/lib/billing/service";
import { paymentProvider } from "@/lib/billing/provider";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";

/**
 * Board 3m — the subscription and its invoices.
 *
 * A tax invoice carries both TRNs: ours because UAE VAT requires it of the
 * supplier, and the seller's because their accountant needs it to reclaim.
 * A missing seller TRN is said out loud with what to do about it rather than
 * left as a blank line somebody notices at year end.
 */
export const metadata = { title: "Subscription" };
export const dynamic = "force-dynamic";

/** Ours. A constant rather than a setting, because it is a fact about us. */
const PLATFORM_TRN = "100123456700003";

const STATUS_TONE: Record<string, StatusTone> = {
  paid: "ok",
  issued: "info",
  overdue: "bad",
  draft: "neutral",
  void: "neutral",
};

export default async function BillingPage() {
  const seat = await requireSellerSeat();

  const [business, badges] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        trn: true,
        plan: { select: { id: true, name: true, monthlyPriceAed: true } },
        subscription: { select: { renewsAt: true, cancelledAt: true, endsAt: true, term: true } },
      },
    }),
    getNavBadges(seat.businessId),
  ]);

  const invoices = await invoicesFor(seat.actor, seat.businessId);
  const planName = business.plan?.name ?? t("plan.free");
  const subscription = business.subscription;

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("billing.title")}
    >
      <div className="flex flex-col gap-5">
        <Panel
          title={t("billing.on_plan", { plan: planName })}
          /*
             The term and the date, in words.

             "Renews 4 March 2027" on its own is a puzzle for an annual seller,
             who has to work out from the distance that they must be paying
             yearly. Saying which, beside the date, is the difference between a
             screen that reports and one that answers.
          */
          description={
            subscription?.endsAt
              ? t("billing.ending", { when: formatDate(subscription.endsAt) })
              : subscription
                ? t(
                    subscription.term === "annual"
                      ? "billing.renews_annual"
                      : "billing.renews_monthly",
                    { when: formatDate(subscription.renewsAt) },
                  )
                : t("billing.free_forever")
          }
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/dashboard/billing/change"
                className={buttonClassName({ variant: "secondary", size: "sm" })}
              >
                {t("billing.change")}
              </Link>
              {subscription && !subscription.cancelledAt && (
                <Link
                  href="/dashboard/billing/cancel"
                  className={buttonClassName({ variant: "ghost", size: "sm" })}
                >
                  {t("billing.cancel")}
                </Link>
              )}
            </div>
          }
        >
          <dl className="grid gap-2 text-body-sm sm:grid-cols-2">
            <div>
              <dt className="text-caption text-muted">{t("billing.our_trn", { trn: "" }).trim()}</dt>
              <dd className="font-mono text-ink">{PLATFORM_TRN}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted">{t("billing.your_trn", { trn: "" }).trim()}</dt>
              <dd className="font-mono text-ink">
                {business.trn ?? <span className="text-caption text-muted">{t("billing.no_trn")}</span>}
              </dd>
            </div>
          </dl>

          {/*
            Said plainly. A stub that renders a receipt for a payment that did
            not happen is how a staging environment convinces somebody the
            billing works.
          */}
          {!paymentProvider().live && (
            <p className="mt-3 rounded-ctl border border-line bg-paper-sunk px-3 py-2 text-caption text-muted">
              {t("billing.not_live")}
            </p>
          )}
        </Panel>

        <Panel title={t("billing.invoices")} padded={invoices.length === 0}>
          {invoices.length === 0 ? (
            <p className="text-body-sm text-muted">{t("billing.no_invoices")}</p>
          ) : (
            <div className="overflow-x-auto contain-paint">
              <table className="w-full min-w-[44rem] border-collapse text-left">
                <caption className="sr-only">{t("billing.invoice_caption")}</caption>
                <thead>
                  <tr className="bg-paper-sunk">
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("billing.col.ref")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("billing.col.issued")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right text-caption font-normal text-muted">
                      {t("billing.col.amount")}
                    </th>
                    <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
                      {t("billing.col.status")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => {
                    const total = invoice.lines.reduce(
                      (sum, line) => sum + Number(line.amountAed) * line.qty,
                      0,
                    );
                    return (
                      <tr key={invoice.id} className="border-t border-line align-top">
                        <th scope="row" className="px-3 py-3 text-left font-normal">
                          <span className="font-mono text-body-sm text-ink">{invoice.ref}</span>
                          <span className="mt-0.5 block text-caption text-muted">
                            {invoice.lines.map((l) => l.description).join(" · ")}
                          </span>
                        </th>
                        <td className="px-3 py-3 text-body-sm text-ink">
                          {invoice.issuedAt ? formatDate(invoice.issuedAt) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums text-body-sm text-ink">
                          AED {total.toFixed(2)}
                          <span className="mt-0.5 block text-caption font-normal text-muted">
                            {t("billing.vat", {
                              rate: `${(Number(invoice.vatRate) * 100).toFixed(0)}%`,
                            })}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge
                            tone={STATUS_TONE[invoice.status] ?? "neutral"}
                            shape="chip"
                            size="sm"
                          >
                            {t(`billing.status.${invoice.status}` as never)}
                          </StatusBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </SellerPage>
  );
}
