import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { deleteLocation, saveLocation } from "./actions";
import { LocationsForm } from "./LocationsForm";

/**
 * Board 3c — locations and coverage.
 *
 * Every published area is offered, not only those in the seller's own emirate.
 * A Sharjah supplier opening a depot in Ras Al Khaimah is ordinary, and a
 * picker that hides it makes them think we do not cover it.
 */
export const metadata = { title: "Locations" };
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const seat = await requireSellerSeat();

  const [locations, areas, badges] = await Promise.all([
    prisma.location.findMany({
      where: { businessId: seat.businessId },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        emirate: true,
        areaId: true,
        addressLine: true,
        phone: true,
        whatsapp: true,
        serviceRadiusKm: true,
        published: true,
        area: { select: { name: true, isFreeZone: true } },
      },
    }),
    /*
     * Published areas, plus any this business already sits in.
     *
     * The second half is not a nicety. An area can be unpublished — held back
     * while the taxonomy is checked — and a branch already assigned to one
     * would then have no matching option in the select. The seller opens the
     * branch, saves an unrelated field, and the area silently becomes whatever
     * the select fell back to. Losing a supplier's address by editing their
     * phone number is the kind of bug nobody reports because nobody sees it
     * happen.
     */
    prisma.area.findMany({
      where: {
        OR: [
          { publishedAt: { not: null } },
          { locations: { some: { businessId: seat.businessId } } },
        ],
      },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true, isFreeZone: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/locations"
      eyebrow={t("locations.eyebrow")}
      title={t("locations.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-muted">{t("locations.intro")}</p>

        <LocationsForm
          branches={locations.map((location) => ({
            id: location.id,
            type: location.type,
            emirate: location.emirate,
            areaId: location.areaId,
            areaName: location.area.name,
            isFreeZone: location.area.isFreeZone,
            addressLine: location.addressLine,
            phone: location.phone,
            whatsapp: location.whatsapp,
            serviceRadiusKm: location.serviceRadiusKm,
            published: location.published,
          }))}
          areas={areas}
          saveAction={saveLocation}
          deleteAction={deleteLocation}
        />
      </div>
    </SellerPage>
  );
}
