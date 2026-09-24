import Link from "next/link";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";

/**
 * Whether the viewer's own seat is on this business — its owner, a manager, a
 * sales seat.
 *
 * No business enquires to itself: `createEnquiry` refuses a send that names the
 * sender's own business, and keeps it out of every fan-out. So a storefront
 * offers its own team no composer and no control that opens one — the rail
 * composer, the drawers, the catalogue tray — rather than a form whose send is
 * refused. Links to pages stay; a seat looking at its own storefront still sees
 * what a buyer sees everywhere a buyer is not about to write.
 *
 * Read off the session. A signed-out owner has no session to recognise, gets
 * the composer like any visitor, and is refused by the send when the number
 * they type turns out to be their own.
 */
export function isOwnListing(actor: { businessId?: string } | null, businessId: string): boolean {
  return actor?.businessId === businessId;
}

/**
 * What sits where the composer would, for that team: what the space is for, and
 * where the enquiries it sends arrive.
 */
export function OwnListingNote() {
  return (
    <Alert
      tone="info"
      live="off"
      title={t("storefront.own.title")}
      action={
        <Link
          href="/dashboard/leads"
          className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("storefront.own.leads")}
        </Link>
      }
    >
      {t("storefront.own.body")}
    </Alert>
  );
}
