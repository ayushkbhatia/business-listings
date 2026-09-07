import { t } from "@/lib/i18n";
import { formatDate, formatDateRange } from "@/lib/format";
import { mayEditListing } from "@/lib/auth/guards";
import { getHoursBoard, needsConfirming, ramadanCollisions } from "@/lib/db/queries/hours";
import { JUMUAH_BREAK, keepsJumuah } from "@/lib/trade/closures";
import type { Day } from "@/lib/trade/hours";
import type { LocationType } from "@/lib/db/generated/enums";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  addDate,
  confirmRamadan,
  copyToBranches,
  dropDate,
  endClosure,
  saveClosure,
  saveWeek,
} from "./actions";
import { HoursWorkspace, type WorkspaceBranch } from "./HoursWorkspace";
import type { HolidayRow } from "./HolidayRail";

/**
 * Board 3d — hours, holidays and Ramadan. The other half of `2d`.
 *
 * Every string the client needs is resolved here. That is not a formality:
 * `tests/unit/client-labels` fails the build on a function prop crossing into a
 * client component, and it is the repo's most repeated defect.
 */
export const metadata = { title: t("hours.title") };
export const dynamic = "force-dynamic";

const DAY_LABELS: Record<Day, string> = {
  sun: t("storefront.day.sun"),
  mon: t("storefront.day.mon"),
  tue: t("storefront.day.tue"),
  wed: t("storefront.day.wed"),
  thu: t("storefront.day.thu"),
  fri: t("storefront.day.fri"),
  sat: t("storefront.day.sat"),
};

const typeLabel = (type: LocationType) =>
  t(`locations.type.${type}` as "locations.type.head_office");

export default async function HoursPage() {
  const seat = await requireSellerSeat();
  const now = new Date();

  const [board, badges] = await Promise.all([
    getHoursBoard(seat.businessId, typeLabel, now),
    getNavBadges(seat.businessId),
  ]);

  /*
     The rail's heading, from the dates it actually holds.

     `Public holidays 2026–27` on the render is a hardcoded pair. Derived here,
     so a calendar the platform extends moves the heading with it rather than
     leaving a year that stopped being true.
  */
  const years = board.holidays.length
    ? Array.from(
        new Set(
          board.holidays.flatMap((holiday) => [
            holiday.startsOn.getUTCFullYear(),
            holiday.endsOn.getUTCFullYear(),
          ]),
        ),
      )
        .sort()
        .filter((_, index, all) => index === 0 || index === all.length - 1)
        .join("–")
    : String(now.getUTCFullYear());

  const branches: WorkspaceBranch[] = board.branches.map((branch) => {
    const clashes = ramadanCollisions(branch, board.holidays);

    const official: HolidayRow[] = board.holidays.map((holiday) => ({
      id: holiday.id,
      name: holiday.name,
      dates: formatDateRange(holiday.startsOn, holiday.endsOn),
      official: true,
      halfDay:
        holiday.openFrom && holiday.openUntil
          ? t("hours.holiday_half_hours", { from: holiday.openFrom, to: holiday.openUntil })
          : null,
      alsoRamadan: clashes.has(holiday.id)
        ? t("hours.holiday_also_ramadan", { date: formatDate(holiday.startsOn) })
        : null,
      estimated: holiday.confirmed === false,
    }));

    const own: HolidayRow[] = branch.closures.map((closure) => ({
      id: closure.id,
      name: closure.reason,
      dates: formatDateRange(closure.startsOn, closure.endsOn),
      official: false,
      halfDay:
        closure.openFrom && closure.openUntil
          ? t("hours.holiday_half_hours", { from: closure.openFrom, to: closure.openUntil })
          : null,
      alsoRamadan: null,
      estimated: false,
    }));

    return {
      id: branch.id,
      name: branch.name,
      hours: branch.hours,
      ramadanHours: branch.ramadanHours,
      ramadanConfirmedYear: branch.ramadanConfirmedYear,
      hidden: branch.hidden,
      needsConfirming: needsConfirming(branch, board),
      closure: branch.closure
        ? {
            from: formatDate(branch.closure.from),
            until: formatDate(branch.closure.until),
            reason: branch.closure.reason,
          }
        : null,
      holidays: [...own, ...official].sort((a, b) => a.dates.localeCompare(b.dates)),
    };
  });

  /*
     The Jumu'ah note, for the branch the picker opens on.

     Reported rather than enforced: it appears only while the gap is actually in
     that branch's Friday. The board asserted `Jumu'ah break applied` beside a
     single range that ended at noon — a note contradicting the control beside
     it — and it is not the platform's place to decide a business closes for
     prayer.
  */
  const first = board.branches[0];
  const jumuah =
    first && keepsJumuah(first.hours.fri ?? [])
      ? t("hours.jumuah_note", { from: JUMUAH_BREAK.from, to: JUMUAH_BREAK.to })
      : "";

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/hours"
      eyebrow={t("hours.eyebrow")}
      title={t("hours.title")}
    >
      <HoursWorkspace
        branches={branches}
        dayLabels={DAY_LABELS}
        holidayYears={years}
        ramadan={
          board.ramadan
            ? {
                year: board.ramadan.year,
                from: formatDate(board.ramadan.from),
                to: formatDate(board.ramadan.to),
                confirmed: board.ramadan.confirmed,
              }
            : null
        }
        jumuahNote={jumuah}
        readOnly={!mayEditListing(seat.actor)}
        saveAction={saveWeek}
        copyAction={copyToBranches}
        confirmAction={confirmRamadan}
        addDateAction={addDate}
        dropDateAction={dropDate}
        saveClosureAction={saveClosure}
        endClosureAction={endClosure}
      />
    </SellerPage>
  );
}
