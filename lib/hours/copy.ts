import { DAYS, type Day, type Shift, type WeekHours } from "@/lib/trade/hours";

/**
 * What `Copy to 4 other branches…` is about to overwrite.
 *
 * Board 3d's fourth correction. The control silently wrote one branch's week
 * over every other one — including a depot and a sales office that plainly keep
 * different hours — and a supplier who had already set them lost that work one
 * click from the row they were editing. Board 3f §4's rule for destructive bulk
 * actions applies: **name what it touches before it runs.**
 *
 * The count is in the label for the same reason. `Copy to all branches` does
 * not say how many, and how many is the whole question.
 *
 * Pure, because the preview and the write must agree about which branches are
 * targets — a modal listing four and a service updating five is worse than
 * either alone.
 */

export interface CopyTarget {
  id: string;
  name: string;
  /** What this branch keeps today, so the seller can see what is being lost. */
  summary: string;
  /** True when the hours it keeps already match the source's. */
  unchanged: boolean;
}

export interface CopyPreview {
  targets: CopyTarget[];
  /** Targets whose week would actually move. The number worth confirming. */
  changing: number;
}

/**
 * One line per day, as `Mon–Thu 08:00–13:00, 16:00–20:00`.
 *
 * Days with identical shifts are grouped, because seven rows per branch across
 * five branches is a wall a seller reads none of — and the thing they are
 * checking for is the branch that is different, which grouping makes obvious.
 */
export function summarise(
  hours: WeekHours,
  dayLabel: Record<Day, string>,
  closedLabel: string,
): string {
  const groups: { days: Day[]; shifts: Shift[] }[] = [];

  for (const day of DAYS) {
    const shifts = hours[day] ?? [];
    const last = groups.at(-1);
    if (last && sameShifts(last.shifts, shifts)) last.days.push(day);
    else groups.push({ days: [day], shifts });
  }

  return groups
    .map((group) => {
      const label =
        group.days.length === 1
          ? dayLabel[group.days[0]!]
          : `${dayLabel[group.days[0]!]}–${dayLabel[group.days.at(-1)!]}`;
      const times =
        group.shifts.length === 0
          ? closedLabel
          : group.shifts.map((shift) => `${shift.open}–${shift.close}`).join(", ");
      return `${label} ${times}`;
    })
    .join(" · ");
}

export function sameShifts(a: readonly Shift[], b: readonly Shift[]): boolean {
  return (
    a.length === b.length &&
    a.every((shift, index) => shift.open === b[index]!.open && shift.close === b[index]!.close)
  );
}

export function sameWeek(a: WeekHours, b: WeekHours): boolean {
  return DAYS.every((day) => sameShifts(a[day] ?? [], b[day] ?? []));
}

/**
 * The preview, from the branches the screen already holds.
 *
 * The source branch is never a target — copying a week onto itself is not a
 * change and listing it would pad the count the confirm button carries.
 */
export function copyPreview(
  branches: readonly { id: string; name: string; hours: WeekHours }[],
  sourceId: string,
  source: WeekHours,
  dayLabel: Record<Day, string>,
  closedLabel: string,
): CopyPreview {
  const targets = branches
    .filter((branch) => branch.id !== sourceId)
    .map((branch) => ({
      id: branch.id,
      name: branch.name,
      summary: summarise(branch.hours, dayLabel, closedLabel),
      unchanged: sameWeek(branch.hours, source),
    }));

  return { targets, changing: targets.filter((target) => !target.unchanged).length };
}
