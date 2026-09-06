import { prisma } from "@/lib/db/client";
import { nextRamadan, type RamadanHours, type WeekHours } from "@/lib/trade/hours";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { saveBranchHours } from "../listing/actions";
import { HoursForm } from "./HoursForm";

/**
 * Board 3d — hours, holidays and Ramadan.
 *
 * The Ramadan window is computed here and passed as formatted dates. The table
 * behind it is astronomical estimate, not announcement: Ramadan begins on a
 * moon sighting confirmed a day or two beforehand, so the copy says "about"
 * and the component shows it as an approximation rather than a fact.
 */
export const metadata = { title: t("hours.title") };
export const dynamic = "force-dynamic";

export default async function HoursPage() {
  const seat = await requireSellerSeat();

  const [locations, badges] = await Promise.all([
    prisma.location.findMany({
      where: { businessId: seat.businessId },
      orderBy: [{ type: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        type: true,
        addressLine: true,
        hours: true,
        ramadanHours: true,
        area: { select: { name: true } },
      },
    }),
    getNavBadges(seat.businessId),
  ]);

  const window = nextRamadan();

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/hours"
      eyebrow={t("hours.eyebrow")}
      title={t("hours.title")}
    >
      <div className="flex flex-col gap-4">
        <p className="max-w-prose text-body-sm text-muted">{t("hours.intro")}</p>

        <HoursForm
          branches={locations.map((location) => ({
            id: location.id,
            name: `${t(`locations.type.${location.type}` as never)} — ${location.area.name}`,
            hours: (location.hours ?? {}) as WeekHours,
            ramadanHours: (location.ramadanHours ?? null) as RamadanHours | null,
          }))}
          ramadanWindow={
            window
              ? {
                  from: formatDate(window.from),
                  to: formatDate(window.to),
                  active: window.active,
                }
              : null
          }
          action={saveBranchHours}
        />
      </div>
    </SellerPage>
  );
}
