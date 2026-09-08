import { PositionReason, PositionValue } from "@/components/domain";
import { DEFAULT_WEIGHTS } from "@/lib/search/ranking";
import type { Attribution, FactorDay, RawFactors } from "@/lib/analytics/attribution";
import { attribute } from "@/lib/analytics/attribution";
import { Section, States } from "../_kit";

/**
 * The `3a`/`3l` amendment, in all thirteen states.
 *
 * Two of them are the reason this section exists rather than a screenshot of the
 * card: **`Not ranked` and `Not measured` must not share a rendering**, and the
 * only way that regresses silently is if nobody ever sees them side by side. So
 * they are next to each other here, above `no comparison yet`, which is the
 * third kind of absence and says a third thing.
 *
 * The attribution states are built by running the real `attribute()` over
 * synthetic vectors rather than by hand-writing the sentences. A gallery that
 * types out the copy it is supposed to be checking will keep rendering the old
 * sentence for a year after the arithmetic changed.
 */

const HOUR = 3_600_000;

const RAW: RawFactors = {
  relevance: 1,
  verificationTier: 2,
  responseTimeMedianMs: 4 * HOUR,
  specCompleteness: 0.74,
  distanceKm: null,
  planMultiplier: 1.35,
};

function day(over: Partial<FactorDay> = {}): FactorDay {
  return {
    scores: {
      relevance: 1,
      verificationTier: 1,
      responseTime: 1,
      specCompleteness: 0.74,
      distance: 0.5,
      planTier: 1,
    },
    raw: RAW,
    weights: DEFAULT_WEIGHTS,
    boostPoints: 0,
    ...over,
  };
}

const ON = new Date("2026-09-02T00:00:00Z");
const HISTORY_FROM = new Date("2026-06-10T00:00:00Z");

/** Every reason, through the real arithmetic. */
const REASONS: { label: string; reason: Attribution; category?: string }[] = [
  {
    label: "08 seller",
    reason: attribute({
      before: day(),
      after: day({
        scores: { ...day().scores, responseTime: 0.2 },
        raw: { ...RAW, responseTimeMedianMs: 31 * HOUR },
      }),
      positionBefore: 8,
      positionAfter: 14,
      historyStarts: HISTORY_FROM,
      on: ON,
    }),
  },
  {
    label: "09 platform",
    reason: attribute({
      before: day(),
      /*
         Two weights moved and their totals still sum to 100, which is what
         board 12c enforces — but they must not cancel *against this listing's
         scores*. The first fixture here moved 14 points off response time and
         14 onto relevance, and both scored 1, so the platform delta was exactly
         zero and state 09 rendered nothing at all.
      */
      after: day({ weights: { ...DEFAULT_WEIGHTS, responseTime: 4, specCompleteness: 26 } }),
      positionBefore: 2,
      positionAfter: 6,
      historyStarts: HISTORY_FROM,
      on: ON,
    }),
  },
  {
    label: "10 commercial",
    category: "Marine & oilfield",
    reason: attribute({
      before: day({ boostPoints: 15 }),
      after: day({ boostPoints: 0 }),
      positionBefore: 4,
      positionAfter: 9,
      historyStarts: HISTORY_FROM,
      on: ON,
      boostEndedOn: new Date("2026-08-30T00:00:00Z"),
      earnedRank: 9,
    }),
  },
  {
    label: "10 · no earned rank",
    category: "Marine & oilfield",
    reason: attribute({
      before: day({ boostPoints: 15 }),
      after: day({ boostPoints: 0 }),
      positionBefore: 4,
      positionAfter: 9,
      historyStarts: HISTORY_FROM,
      on: ON,
      boostEndedOn: new Date("2026-08-30T00:00:00Z"),
    }),
  },
  {
    label: "11 competitor",
    reason: attribute({
      before: day(),
      after: day(),
      positionBefore: 11,
      positionAfter: 13,
      historyStarts: HISTORY_FROM,
      on: ON,
      overtakenBy: { count: 2, factor: "responseTime" },
    }),
  },
  {
    label: "12 several",
    reason: attribute({
      before: day(),
      after: day({
        scores: { ...day().scores, responseTime: 0.2, specCompleteness: 0.5, distance: 0.4 },
        raw: { ...RAW, responseTimeMedianMs: 31 * HOUR },
      }),
      positionBefore: 8,
      positionAfter: 14,
      historyStarts: HISTORY_FROM,
      on: ON,
    }),
  },
  {
    label: "12 · no leader",
    reason: attribute({
      before: day(),
      after: day({
        scores: { ...day().scores, responseTime: 0.8, specCompleteness: 0.44, distance: 0.15 },
      }),
      positionBefore: 8,
      positionAfter: 14,
      historyStarts: HISTORY_FROM,
      on: ON,
    }),
  },
  {
    label: "13 unexplained",
    reason: attribute({
      before: null,
      after: day(),
      positionBefore: 8,
      positionAfter: 14,
      historyStarts: HISTORY_FROM,
      on: ON,
    }),
  },
];

export function Position() {
  return (
    <Section
      id="position"
      title="Position and attribution"
      note="Boards 3a and 3l. One component, two placements — a category rank and a query rank are different numbers rendering identically. Seven position states, six reasons, and a reason is optional."
    >
      <States label="01 improved">
        <PositionValue state="ranked" rank={2} total={34} movement={{ kind: "places", value: -1 }} />
      </States>
      <States label="02 fell">
        <PositionValue state="ranked" rank={14} total={88} movement={{ kind: "places", value: 6 }} />
      </States>
      <States label="03 held">
        <PositionValue state="ranked" rank={1} total={34} movement={{ kind: "places", value: 0 }} />
      </States>
      <States label="04 no history">
        <PositionValue state="ranked" rank={7} total={61} movement={{ kind: "none" }} />
      </States>

      {/*
         The pair that must never converge. "You are not in the results" and "we
         do not know" are different sentences, and collapsing them tells a seller
         something untrue in whichever direction the collapse went.
      */}
      <States label="05 not ranked" stack>
        <PositionValue state="not_ranked" rank={null} total={null} movement={{ kind: "none" }} />
        <PositionReason reason={{ kind: "none" }} state="not_ranked" />
      </States>
      <States label="06 not measured" stack>
        <PositionValue state="not_measured" rank={null} total={null} movement={{ kind: "none" }} />
        <PositionReason
          reason={{ kind: "none" }}
          state="not_measured"
          lastMeasured={new Date("2026-09-02T00:00:00Z")}
        />
      </States>
      <States label="06 · never" stack>
        <PositionReason reason={{ kind: "none" }} state="not_measured" lastMeasured={null} />
      </States>

      {/*
         The launch state, and the argument for Q1. `#3` on its own reads as an
         achievement in a category holding five listings; the denominator is
         what makes the same row a report.
      */}
      <States label="07 cold start">
        <PositionValue state="ranked" rank={3} total={5} movement={{ kind: "places", value: 0 }} />
      </States>
      <States label="· without it">
        <PositionValue state="ranked" rank={3} total={null} movement={{ kind: "places", value: 0 }} />
      </States>

      {REASONS.map((entry) => (
        <States key={entry.label} label={entry.label} stack>
          <PositionReason reason={entry.reason} categoryName={entry.category} />
        </States>
      ))}

      {/* A reason is optional, and its absence is finished rather than pending. */}
      <States label="no reason" stack>
        <PositionValue state="ranked" rank={1} total={34} movement={{ kind: "places", value: 0 }} />
        <PositionReason reason={{ kind: "none" }} />
      </States>
    </Section>
  );
}
