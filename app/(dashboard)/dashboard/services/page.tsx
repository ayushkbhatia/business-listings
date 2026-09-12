import { notFound } from "next/navigation";
import { can } from "@/lib/auth/can";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { servicesBoardFor } from "@/lib/services/service";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { addService, publishServices, removeService, saveServiceOrder } from "./actions";
import { ServicesWorkspace } from "./ServicesWorkspace";

/**
 * Board `3f-s` — the services list.
 *
 * The goods catalogue is hundreds of rows with stock, price, a spreadsheet
 * importer and a search box. **The volume assumption inverts**: an FM
 * contractor has six services and an audit practice four, so this is a short
 * dense table with no search, no pagination and no import — `3f-s` B1 and B7.
 *
 * The column that does the work is `Scope sheet`, `n of 6`, computed from the
 * same helper the editor uses. It is the one number that explains to a seller
 * why a live listing underperforms, and it is the reason this screen is more
 * than a navigation index.
 *
 * **It gates nothing.** A 4-of-6 service is live and stays live; the line under
 * the table names it and says what it costs, in the seller's terms rather than
 * ours, and leaves the choice with them.
 */
export const metadata = { title: t("services.title") };
export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const seat = await requireSellerSeat();

  /*
     Gated here as well as at every write.

     Board 3g learned this the expensive way: with no check on the route a
     `seller_sales` seat opened the editor, filled every input, and discovered
     on submit that the guard throws — an error boundary rather than a message.
  */
  if (!can(seat.actor, "product.edit")) notFound();

  const [board, badges] = await Promise.all([
    servicesBoardFor(seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/services"
      eyebrow={t("services.eyebrow")}
      title={t("services.title")}
      /*
         One count, and it reconciles with the table below it: live and draft
         are counted from the same rows the table renders, not from a second
         query that could disagree.
      */
      meta={
        board.rows.length === 0
          ? t("services.meta", { count: 0 })
          : t("services.counts", {
              live: formatCount(board.live),
              draft: formatCount(board.draft),
            })
      }
    >
      <ServicesWorkspace
        board={board}
        businessSlug={seat.businessSlug}
        canEdit={can(seat.actor, "product.edit")}
        actions={{
          add: addService,
          publish: publishServices,
          reorder: saveServiceOrder,
          remove: removeService,
        }}
      />
    </SellerPage>
  );
}
