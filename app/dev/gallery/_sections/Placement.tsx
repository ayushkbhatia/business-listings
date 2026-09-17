"use client";

import { SlotBoard, type SlotRow } from "@/app/(dashboard)/dashboard/promote/SlotBoard";
import type { PromoteResult } from "@/app/(dashboard)/dashboard/promote/actions";
import { RateCard, type Rung } from "@/app/(admin)/admin/placement/RateCard";
import type { RateResult } from "@/app/(admin)/admin/placement/actions";
import { generateCard } from "@/lib/placement/bands";
import { Section, States } from "../_kit";

/**
 * Board `11e` — sponsored placement, in the states it has.
 *
 * Four of them, and each is a thing that would regress silently because a wrong
 * row still looks like a row:
 *
 *   **Available, with demand.** The row a seller decides on. Both figures are
 *   measurements or they are absences — `14,208 searches` is the board's, and
 *   ours says what it actually counted.
 *   **Not measured.** The cold start, and it is a designed state: a scope
 *   nobody has visited reads *demand not measured here yet* and prices at the
 *   floor, rather than printing a nought that looks like a measurement.
 *   **Taken.** Flag 4 — a taken slot shows its price, because a seller joining
 *   a waiting list should know what they are committing to.
 *   **Yours.** The price on the row is what the holder *pays*, frozen at
 *   booking, not today's quote for the scope.
 */

const noTake = async (): Promise<PromoteResult> => ({
  ok: false,
  error: "The gallery does not buy anything.",
});
const noRate = async (): Promise<RateResult> => ({
  ok: false,
  error: "The gallery does not write.",
});

function row(over: Partial<SlotRow> & { categoryId: string }): SlotRow {
  return {
    categoryName: "Valves & actuators",
    emirate: "dubai",
    placeName: "Dubai",
    band: 8,
    monthlyPriceAed: 585,
    paidMonthlyAed: null,
    demand: "14,208 appearances and 2,180 clicks, to 16 Sep 2026",
    position: "you rank #2 of 34 organically",
    mine: false,
    takenUntil: null,
    queued: false,
    ahead: 0,
    freed: false,
    ...over,
  };
}

const LADDER: SlotRow[] = [
  row({ categoryId: "valves-dubai" }),
  row({
    categoryId: "pumps-dubai",
    categoryName: "Pumps & motors",
    band: 6,
    monthlyPriceAed: 483,
    demand: "8,412 appearances and 1,090 clicks, to 16 Sep 2026",
    position: "you rank #7 of 34 organically",
  }),
  row({
    categoryId: "fasteners-dubai",
    categoryName: "Fasteners",
    band: 4,
    monthlyPriceAed: 399,
    takenUntil: "30 Nov 2026",
    demand: "3,104 appearances and 410 clicks, to 16 Sep 2026",
    position: "not ranked here yet",
  }),
  row({
    categoryId: "valves-abu-dhabi",
    emirate: "abu_dhabi",
    placeName: "Abu Dhabi",
    band: 1,
    monthlyPriceAed: 300,
    // The cold start, on one row: never measured, so never a nought.
    demand: null,
    position: null,
  }),
];

const HELD: SlotRow[] = [
  row({ categoryId: "valves-dubai", mine: true, paidMonthlyAed: 439 }),
  row({
    categoryId: "pumps-dubai",
    categoryName: "Pumps & motors",
    takenUntil: "30 Nov 2026",
    queued: true,
    ahead: 2,
  }),
  row({
    categoryId: "fasteners-dubai",
    categoryName: "Fasteners",
    takenUntil: "3 Oct 2026",
    queued: true,
    ahead: 0,
    freed: true,
  }),
];

const RUNGS: Rung[] = generateCard().map((rung, index) => ({
  ...rung,
  override: rung.band === 9,
  scopes: [12, 0, 11, 0, 0, 12, 0, 16, 0, 0][index] ?? 0,
}));

export function PlacementGallery() {
  return (
    <Section
      id="placement"
      title="Sponsored placement"
      note="Board 11e — the slot list, the selection panel and the rate card"
    >
      <States label="Choosing" stack>
        <SlotBoard
          slots={LADDER}
          vatRateLabel="5%"
          billedOn="1 Oct 2026"
          takeAction={noTake}
          leaveAction={noTake}
        />
      </States>

      <States label="Held and queued" stack>
        <SlotBoard
          slots={HELD}
          vatRateLabel="5%"
          billedOn="1 Oct 2026"
          takeAction={noTake}
          leaveAction={noTake}
        />
      </States>

      <States label="Nothing to sell" stack>
        <SlotBoard
          slots={[]}
          vatRateLabel="5%"
          billedOn="1 Oct 2026"
          takeAction={noTake}
          leaveAction={noTake}
        />
      </States>

      <States label="The rate card" stack>
        <RateCard
          rungs={RUNGS}
          basePriceAed={300}
          stepPercent={10}
          canEdit
          saveCurve={noRate}
          saveBandPrice={noRate}
        />
      </States>
    </Section>
  );
}
