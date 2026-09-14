"use client";

import { AddedBranches } from "@/app/(dashboard)/dashboard/locations/AddedBranches";
import { DedupeActions } from "@/app/(admin)/admin/ingest/dedupe/DedupeActions";
import { BelowFloorNote, QueueEmpty, SignalsCard, TodayCard, WhyCard } from "@/app/(admin)/admin/ingest/dedupe/DedupeRail";
import { PairWorkspace } from "@/app/(admin)/admin/ingest/dedupe/PairWorkspace";
import { ReversibleTable } from "@/app/(admin)/admin/ingest/dedupe/ReversibleTable";
import { signalRows } from "@/app/(admin)/admin/ingest/dedupe/signals";
import type { ActionResult } from "@/app/(admin)/admin/ingest/dedupe/actions";
import type { PairSide, PairView } from "@/lib/dedupe/queue";
import { Section, States } from "../_kit";

/**
 * Board `12b` — the dedupe queue, in every state its spec lists.
 *
 * The board draws one: a record from a run against a claimed, paying listing.
 * The states that regress quietly are the ones it does not draw — two claimed
 * listings, where the merge must not be offered; a register area we cannot
 * place, where merging needs a person to choose; the empty manual band with a
 * bulk merge still waiting; and the owner's side of a branch added in the
 * manual band.
 *
 * Specimens have keyboard handling off: several share one window here, and J
 * would move all of them.
 */

const BANDS = { floor: 0.6, certain: 0.9 };
const inert = async (): Promise<ActionResult> => ({ ok: false, error: "The gallery does not decide pairs." });
const inertBranch = async () => ({ ok: false as const, error: "The gallery does not decide branches.", fix: "Open the dashboard." });

const side = (over: Partial<PairSide>): PairSide => ({
  kind: "listing",
  id: "gallery-side",
  name: "",
  claimed: false,
  paying: false,
  planName: null,
  subscriptionStatus: null,
  reviews: 0,
  rating: null,
  products: 0,
  enquiries: 0,
  licenceNumber: null,
  authority: "DED",
  address: null,
  areaId: null,
  emirate: "dubai",
  phone: null,
  slug: null,
  runNumber: null,
  rowNumber: null,
  ...over,
});

const GULF_COOL = side({
  id: "gallery-gulf-cool",
  name: "Gulf Cool Technical Services",
  claimed: true,
  paying: true,
  planName: "Pro",
  subscriptionStatus: "active",
  reviews: 88,
  rating: 4.6,
  products: 312,
  enquiries: 41,
  licenceNumber: "DED-441908",
  address: "Al Quoz Industrial 3, W/H 7",
  areaId: "gallery-al-quoz-3",
  phone: "043406688",
  slug: "gulf-cool-technical-services",
});

const TYPICAL: PairView = {
  id: "gallery-pair-typical",
  score: 0.74,
  band: "probable",
  kind: "record",
  signals: [
    { key: "licence_root", strength: 1, detail: "441908, suffix 01" },
    { key: "phone", strength: 1, detail: "043406688" },
    { key: "trade_name", strength: 0.94, detail: "94% of the identifying words" },
    { key: "nearby_area", strength: 1, detail: "Al Quoz Industrial 3 and Al Quoz Industrial 4" },
    { key: "activity", strength: 1, detail: "air conditioning maintenance" },
  ],
  a: GULF_COOL,
  b: side({
    kind: "record",
    id: "gallery-record-b",
    name: "Gulf Cool Technical Services (Branch)",
    licenceNumber: "DED-441908-01",
    address: "Al Quoz Industrial 4, Shop 12",
    areaId: "gallery-al-quoz-4",
    phone: "043406688",
    runNumber: 14,
    rowNumber: 3108,
  }),
  bothClaimed: false,
  hint: { kind: "branch_suffix", suffix: "01" },
  resolvedAreaId: "gallery-al-quoz-4",
  areaOptions: [],
};

const BOTH_CLAIMED: PairView = {
  id: "gallery-pair-both-claimed",
  score: 0.81,
  band: "probable",
  kind: "listing",
  signals: [
    { key: "phone", strength: 1, detail: "042671400" },
    { key: "trade_name", strength: 0.88, detail: "88% of the identifying words" },
    { key: "same_area", strength: 1, detail: "same area" },
  ],
  a: side({
    id: "gallery-marina",
    name: "Marina Pumps & Controls",
    claimed: true,
    paying: true,
    planName: "Growth",
    reviews: 23,
    rating: 4.2,
    products: 64,
    licenceNumber: "DED-552017",
    address: "Al Qusais Industrial 4, Unit 9",
    phone: "042671400",
  }),
  b: side({
    id: "gallery-marina-controls",
    name: "Marina Pump Controls",
    claimed: true,
    reviews: 4,
    rating: 4.8,
    products: 11,
    licenceNumber: "DED-618230",
    address: "Al Qusais Industrial 4, Unit 11",
    phone: "042671400",
  }),
  bothClaimed: true,
  hint: null,
  resolvedAreaId: null,
  areaOptions: [],
};

const AREA_NEEDED: PairView = {
  ...TYPICAL,
  id: "gallery-pair-area",
  score: 0.66,
  signals: [
    { key: "licence_root", strength: 1, detail: "441908, suffix 02" },
    { key: "trade_name", strength: 0.94, detail: "94% of the identifying words" },
  ],
  a: { ...GULF_COOL, paying: false, planName: null, reviews: 0, products: 0, rating: null },
  b: { ...TYPICAL.b, id: "gallery-record-c", licenceNumber: "DED-441908-02", address: "Near Dragon Mart", areaId: null, phone: null },
  hint: { kind: "branch_suffix", suffix: "02" },
  resolvedAreaId: null,
  areaOptions: [
    { id: "gallery-international-city", name: "International City" },
    { id: "gallery-al-warsan", name: "Al Warsan" },
  ],
};

export function Dedupe() {
  return (
    <Section id="dedupe" title="12b · dedupe queue" note="One pair at a time, and the states the board does not draw">
      <States label="header actions" stack>
        <div className="w-full">
          <DedupeActions
            certain={1412}
            bands={BANDS}
            runId={null}
            reversibleDays={30}
            bulkLimit={2000}
            bulkMerge={inert}
            preview={async () => ({ ok: false, error: "The gallery does not preview." })}
            tune={inert}
            rescan={inert}
          />
        </div>
      </States>

      <States label="record into a paying listing" stack>
        <div className="grid w-full items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <PairWorkspace
            pair={TYPICAL}
            position={1}
            total={432}
            runId={null}
            reversibleDays={30}
            resolve={inert}
            onResult={() => {}}
            keyboard={false}
          />
          <div className="flex flex-col gap-4">
            <SignalsCard rows={signalRows(TYPICAL.signals)} />
            <WhyCard score={TYPICAL.score} bands={BANDS} />
            <TodayCard tally={{ reviewed: 118, merged: 64, separated: 41, discarded: 13, bulkBatches: 1, bulkPairs: 1412 }} />
            <BelowFloorNote count={57} floor={BANDS.floor} />
          </div>
        </div>
      </States>

      <States label="both claimed" stack>
        <div className="w-full">
          <PairWorkspace
            pair={BOTH_CLAIMED}
            position={2}
            total={432}
            runId={null}
            reversibleDays={30}
            resolve={inert}
            onResult={() => {}}
            keyboard={false}
          />
        </div>
      </States>

      <States label="area to choose" stack>
        <div className="w-full">
          <PairWorkspace
            pair={AREA_NEEDED}
            position={3}
            total={432}
            runId={null}
            reversibleDays={30}
            resolve={inert}
            onResult={() => {}}
            keyboard={false}
          />
        </div>
      </States>

      <States label="queue empty" stack>
        <div className="grid w-full items-start gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <QueueEmpty certain={1412} bands={BANDS} />
          <WhyCard score={null} bands={BANDS} />
        </div>
      </States>

      <States label="put back" stack>
        <div className="w-full">
          <ReversibleTable
            reverse={inert}
            rows={[
              {
                kind: "batch",
                id: "gallery-batch",
                decision: "Bulk merge · 1,412 pairs",
                owner: null,
                reason: "Identical licence numbers; spot-checked twenty against the DED portal.",
                decidedBy: "R. Haddad · 14 Sep 2026",
                daysLeft: 30,
              },
              {
                kind: "pair",
                id: "gallery-pair-merged",
                decision: "Gulf Cool Technical Services gained Gulf Cool Technical Services (Branch)",
                owner: "awaiting",
                reason: "Merged as a branch: licence root 441908, suffix 01, same phone.",
                decidedBy: "R. Haddad · 13 Sep 2026",
                daysLeft: 29,
              },
              {
                kind: "pair",
                id: "gallery-pair-confirmed",
                decision: "Technopump Trading gained Technopump Trading (Jebel Ali)",
                owner: "confirmed",
                reason: "Merged as a branch: licence root 700000, suffix 03.",
                decidedBy: "R. Haddad · 2 Sep 2026",
                daysLeft: 18,
              },
            ]}
          />
        </div>
      </States>

      <States label="nothing to put back" stack>
        <div className="w-full">
          <ReversibleTable reverse={inert} rows={[]} />
        </div>
      </States>

      <States label="owner's branches" stack>
        <div className="w-full">
          <AddedBranches
            readOnly={false}
            decide={inertBranch}
            rows={[
              {
                locationId: "gallery-branch-held",
                area: "Al Quoz Industrial 4",
                address: "Shop 12",
                licence: "DED-441908-01",
                source: "DED",
                confirmation: "awaiting",
                untilLabel: null,
              },
              {
                locationId: "gallery-branch-live",
                area: "Jebel Ali Industrial 1",
                address: "Warehouse 4",
                licence: "DED-441908-03",
                source: "DED",
                confirmation: "informed",
                untilLabel: "14 Oct 2026",
              },
            ]}
          />
        </div>
      </States>
    </Section>
  );
}
