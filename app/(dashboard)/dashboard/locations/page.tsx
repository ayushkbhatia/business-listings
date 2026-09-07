import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import { mayEditListing } from "@/lib/auth/guards";
import { getLocationsBoard } from "@/lib/db/queries/locations";
import { LEAD_TIME_CHOICES, isLeadTimeChoice } from "@/lib/locations/coverage";
import type { Emirate, LocationType } from "@/lib/db/generated/enums";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  deleteLocation,
  dropCoverage,
  previewHide,
  saveCoverage,
  saveLocation,
  savePin,
  setVisibility,
} from "./actions";
import { LocationsWorkspace } from "./LocationsWorkspace";

/**
 * Board 3c — the locations manager.
 *
 * The steady-state half of `2d`. Onboarding took one branch and one pin; this
 * manages a network, where each pin quality and each status carries a different
 * consequence for whether buyers can find the branch at all.
 *
 * Every published area is offered for a branch, not only those in the seller's
 * own emirate. A Sharjah supplier opening a depot in Ras Al Khaimah is
 * ordinary, and a picker that hides it makes them think we do not cover it.
 */
export const metadata = { title: t("locations.title") };
export const dynamic = "force-dynamic";

const EMIRATES: readonly Emirate[] = [
  "dubai",
  "abu_dhabi",
  "sharjah",
  "ajman",
  "ras_al_khaimah",
  "umm_al_quwain",
  "fujairah",
];

const typeLabel = (type: LocationType) =>
  t(`locations.type.${type}` as "locations.type.head_office");

const emirateLabel = (emirate: Emirate) => t(`emirate.${emirate}` as "emirate.dubai");

/**
 * `Same day`, `48 hours`, or the number.
 *
 * The named forms are what the control offers; the fallback exists because the
 * column stores an integer and a value from an earlier set of choices must
 * still render as something a person can read. A promise that renders as its
 * key would be the one thing on this screen a buyer's supplier could not
 * explain.
 */
const leadLabel = (hours: number) =>
  isLeadTimeChoice(hours)
    ? t(`locations.lead.${hours}` as "locations.lead.0")
    : t("locations.lead.other", { hours });

export default async function LocationsPage() {
  const seat = await requireSellerSeat();

  const [board, areas, badges] = await Promise.all([
    /*
       Every label is resolved here, on the server.

       Not a formality: `tests/unit/client-labels` fails the build on a function
       prop crossing into a client component, and it is the repo's most repeated
       defect. It is also the better shape — the table renders a word and the
       chip renders a sentence, so words and sentences are what cross.
    */
    getLocationsBoard(seat.businessId, {
      type: typeLabel,
      scope: (row) =>
        row.areaName === null
          ? t("locations.coverage.whole_emirate", { emirate: emirateLabel(row.emirate) })
          : t("locations.coverage.in_emirate", {
              area: row.areaName,
              emirate: emirateLabel(row.emirate),
            }),
      promise: leadLabel,
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
          { coverage: { some: { businessId: seat.businessId } } },
        ],
      },
      orderBy: [{ emirate: "asc" }, { name: "asc" }],
      select: { id: true, name: true, emirate: true, isFreeZone: true, lat: true, lng: true },
    }),
    getNavBadges(seat.businessId),
  ]);

  /*
     The coverage picker, grouped by emirate and led by the emirate itself.

     Criterion 6 in its concrete form: every option here is a row in the
     taxonomy — an `Area.id`, or an emirate the enum holds — so there is no
     value the control can produce that a buyer's filter could not match. The
     server checks the same thing again on write, because a select is a
     suggestion and a form post is not.
  */
  const coverageGroups = EMIRATES.map((emirate) => ({
    label: emirateLabel(emirate),
    options: [
      {
        value: `emirate:${emirate}`,
        label: t("locations.coverage.emirate_option", { emirate: emirateLabel(emirate) }),
        emirate,
        areaId: "",
      },
      ...areas
        .filter((area) => area.emirate === emirate)
        .map((area) => ({
          value: `area:${area.id}`,
          label: area.name,
          emirate,
          areaId: area.id,
        })),
    ],
  }));

  /*
     Where the map opens for a branch that has no pin yet.

     The area's centre, and never *as* the pin — board 2d's rule, and the whole
     of criterion 4 one screen over: a location with no coordinates is never
     approximated to a centroid. This is where to look, not where the branch is,
     and `BranchPinMap` draws no accuracy ring until a real coordinate exists.
  */
  const areaCentres = Object.fromEntries(
    areas
      .filter((area) => area.lat !== null && area.lng !== null)
      .map((area) => [area.id, { lat: area.lat!, lng: area.lng! }]),
  );

  const leadOptions = LEAD_TIME_CHOICES.map((choice) => ({
    value: String(choice),
    label: leadLabel(choice),
  }));

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/locations"
      eyebrow={t("locations.eyebrow")}
      title={t("locations.title")}
      /*
         Criterion 1. One count, and it reconciles with the table below it and
         the overlay on the map beside it, because all three read the same
         `branchCounts`.
      */
      meta={t("locations.count", {
        count: board.counts.total,
        total: board.counts.total,
        shown: board.counts.shown,
      })}
    >
      <LocationsWorkspace
        branches={board.branches}
        coverage={board.coverage}
        issues={board.issues}
        counts={board.counts}
        areas={areas}
        areaCentres={areaCentres}
        coverageGroups={coverageGroups}
        leadOptions={leadOptions}
        readOnly={!mayEditListing(seat.actor)}
        saveAction={saveLocation}
        deleteAction={deleteLocation}
        pinAction={savePin}
        visibilityAction={setVisibility}
        previewAction={previewHide}
        coverageSaveAction={saveCoverage}
        coverageRemoveAction={dropCoverage}
      />
    </SellerPage>
  );
}
