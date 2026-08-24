import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { publishAndContinue } from "../actions";
import { deleteLocation, saveLocation } from "../../../(dashboard)/dashboard/locations/actions";
import { LocationsForm } from "../../../(dashboard)/dashboard/locations/LocationsForm";

/**
 * Board 2d — where you are, and where criterion 3 happens.
 *
 * The button at the bottom publishes. Everything after this point — the plan
 * screen included — happens to a listing that is already on the directory, so a
 * supplier who closes the tab at the pricing table is listed, findable, and
 * receiving enquiries up to the Free cap.
 */
export const metadata = { title: "Where you are" };
export const dynamic = "force-dynamic";

export default async function LocationsStepPage() {
  const actor = await requireClaimant("locations");
  if (!actor.businessId) redirect("/onboarding/claim");

  const [locations, areas] = await Promise.all([
    prisma.location.findMany({
      where: { businessId: actor.businessId },
      orderBy: [{ createdAt: "asc" }],
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
    prisma.area.findMany({
      where: {
        OR: [
          { publishedAt: { not: null } },
          { locations: { some: { businessId: actor.businessId } } },
        ],
      },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true, isFreeZone: true },
    }),
  ]);

  return (
    <OnboardingPage
      step="locations"
      title={t("locations_step.title")}
      intro={t("locations_step.intro")}
    >
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

      <form action={publishAndContinue} className="flex flex-col items-end gap-2 border-t border-line pt-4">
        <p className="max-w-prose text-caption text-muted">{t("locations_step.live_note")}</p>
        <button
          type="submit"
          disabled={locations.length === 0}
          className="inline-flex items-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover disabled:border-disabled-fill disabled:bg-disabled-fill disabled:text-disabled-text focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("locations_step.go_live")}
        </button>
      </form>
    </OnboardingPage>
  );
}
