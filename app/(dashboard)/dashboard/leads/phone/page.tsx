import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/structure";
import { buttonClassName } from "@/components/primitives";
import { can } from "@/lib/auth/can";
import { hasPublishedLandline, leadsForBusiness, pageFrom } from "@/lib/contact/leads";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { ContactLeadTable, LeadPager } from "./_table";

/**
 * Board `1d` amendment — the seller's phone leads.
 *
 * The owner's ask, 15 Sep: a click on the masked landline registers as a lead in
 * the seller's panel as well as the site owner's. Each row is a buyer who gave a
 * name, work email and mobile on the storefront to see the number, and was told
 * on that form that this supplier receives them.
 *
 * ## A lead, not an enquiry
 *
 * No thread, no quote, no status, no notification (`B7`). The inbox beside this
 * is where enquiries are answered; a phone lead is answered by phone, so the row
 * carries the two ways to do that and nothing to move through a pipeline.
 *
 * ## The numbers are queries
 *
 * The header's two counts are counted over the same rows the table pages
 * through, and *Visits* is the reveal rows the lead unlocked — one per browser
 * session, so a buyer who reloads is not three leads.
 *
 * `force-dynamic` because a lead that arrived a minute ago is the one worth
 * calling.
 */
export const metadata = { title: t("phoneleads.title") };
export const dynamic = "force-dynamic";

export default async function PhoneLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const seat = await requireSellerSeat();
  if (!can(seat.actor, "contact_lead.read")) notFound();

  const params = await searchParams;
  const now = new Date();
  const [page, badges, landline] = await Promise.all([
    leadsForBusiness(seat.businessId, pageFrom(params["page"]), now),
    getNavBadges(seat.businessId),
    hasPublishedLandline(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/leads/phone"
      title={t("phoneleads.title")}
      meta={
        <span className="text-caption tabular-nums text-muted">
          {t("phoneleads.meta", {
            count: page.total,
            formatted: formatCount(page.total),
            recent: formatCount(page.recent),
          })}
        </span>
      }
    >
      <p className="mb-[var(--gutter)] max-w-[var(--measure-prose)] text-body-sm text-body">
        {t("phoneleads.lede")}
      </p>

      {page.total === 0 ? (
        /*
           Two empty states, because they are two different facts. No leads yet
           is a storefront nobody has asked; no landline is a storefront nobody
           can ask, and saying "none yet" over that would be a promise with
           nothing behind it.
        */
        <Card>
          {landline ? (
            <>
              <h2 className="text-h3 text-ink">{t("phoneleads.empty_title")}</h2>
              <p className="mt-1 text-body-sm text-muted">{t("phoneleads.empty_body")}</p>
            </>
          ) : (
            <>
              <h2 className="text-h3 text-ink">{t("phoneleads.no_landline_title")}</h2>
              <p className="mt-1 text-body-sm text-muted">{t("phoneleads.no_landline_body")}</p>
              {can(seat.actor, "listing.edit") && (
                <Link href="/dashboard/locations" className={`mt-3 ${buttonClassName({ variant: "secondary" })}`}>
                  {t("phoneleads.no_landline_action")}
                </Link>
              )}
            </>
          )}
        </Card>
      ) : (
        <>
          <ContactLeadTable page={page} audience="seller" caption={t("phoneleads.caption")} />
          <LeadPager page={page} hrefFor={(n) => `/dashboard/leads/phone?page=${n}`} />
        </>
      )}
    </SellerPage>
  );
}
