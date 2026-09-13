"use client";

import { Suspense } from "react";
import { MappingsTable } from "@/app/(admin)/admin/ingest/categorise/MappingsTable";
import { QueueTable } from "@/app/(admin)/admin/ingest/categorise/QueueTable";
import { DecisionBar, type DecisionBarProps } from "@/app/(admin)/admin/ingest/DecisionBar";
import { RunHistory, SourcesPanel } from "@/app/(admin)/admin/ingest/IngestRail";
import { RunReview } from "@/app/(admin)/admin/ingest/RunReview";
import type { ActionResult } from "@/app/(admin)/admin/ingest/actions";
import {
  HELD_REASONS,
  KEPT_BECAUSE,
  REJECTION_ACTION,
  REJECTION_GROUNDS,
  type HeldReason,
  type KeptBecause,
} from "@/lib/ingest/classify";
import type { RunOverview } from "@/lib/ingest/read";
import { Section, States } from "../_kit";

/**
 * Board `12a` — every state a run's decision bar owes.
 *
 * The board draws one — awaiting review — and its spec lists eight. Seven of
 * them are here side by side, because they are the ones that regress quietly:
 * a rollback control that survives its window, a publish count that forgets
 * the records it is holding back, a zero-new-listings file that reads as an
 * error. The eighth, parsing, is never visible outside the transaction that
 * stages a file, and drawing it would claim a screen state the product cannot
 * reach.
 *
 * The counts are consistent within each specimen — new + duplicates + rejected
 * is the file — because a gallery that draws numbers that cannot happen teaches
 * the eye to accept them.
 */

const inert = async (): Promise<ActionResult> => ({
  ok: false,
  error: "The gallery does not decide runs.",
});

const held = (over: Partial<Record<HeldReason, number>> = {}) =>
  ({ ...Object.fromEntries(HELD_REASONS.map((reason) => [reason, 0])), ...over }) as Record<HeldReason, number>;

const kept = (over: Partial<Record<KeptBecause, number>> = {}) =>
  ({ ...Object.fromEntries(KEPT_BECAUSE.map((why) => [why, 0])), ...over }) as Record<KeptBecause, number>;

function bar(over: Partial<DecisionBarProps>): DecisionBarProps {
  return {
    runId: "gallery",
    number: 14,
    status: "staged",
    newListings: 7312,
    publishable: 6104,
    held: 1208,
    heldBecause: held({ needs_category: 1196, expiry_missing: 12 }),
    rejected: 464,
    live: 0,
    decidedLabel: null,
    decidedBy: null,
    decisionReason: null,
    reversible: false,
    reversibleUntilLabel: null,
    rollback: null,
    preview: null,
    reversibleDays: 30,
    exportHref: "#ingest",
    queueHref: "#ingest",
    publish: inert,
    discard: inert,
    rollbackAction: inert,
    ...over,
  };
}

const RUN: RunOverview = {
  id: "gallery-run",
  number: 14,
  source: "DED",
  filename: "ded-bulk-extract-2026-08.csv",
  status: "staged",
  createdAt: new Date("2026-08-21T05:40:00Z"),
  uploadedBy: "R. Haddad",
  rowCount: 8412,
  truncatedCount: 0,
  newListings: 7312,
  duplicates: 636,
  rejected: 464,
  categorised: 6104,
  queued: 1208,
  published: 0,
  publishable: 6092,
  held: 1220,
  heldBecause: held({ needs_category: 1208, expiry_missing: 12 }),
  byGround: REJECTION_GROUNDS.map((ground, index) => ({
    ground,
    count: [288, 104, 58, 14][index]!,
    action: REJECTION_ACTION[ground],
  })),
  live: 0,
  decision: null,
  reversibleUntil: null,
  reversible: false,
  rollback: null,
  rollbackPreview: null,
};

export function Ingest() {
  return (
    <Section id="ingest" title="12a · licence importer" note="A run, and every state its decision owes">
      <div className="flex flex-col gap-8">
        <States label="run under review" stack>
          <div className="w-full">
            <RunReview
              run={RUN}
              headingId="gallery-run-review"
              publish={inert}
              discard={inert}
              rollback={inert}
              reversibleDays={30}
            />
          </div>
        </States>

        <States label="all waiting" stack>
          <div className="w-full">
            <DecisionBar
              {...bar({ publishable: 0, held: 1208, heldBecause: held({ needs_category: 1208 }) })}
            />
          </div>
        </States>

        <States label="nothing new" stack>
          <div className="w-full">
            <DecisionBar {...bar({ newListings: 0, publishable: 0, held: 0, heldBecause: held() })} />
          </div>
        </States>

        <States label="published, window open" stack>
          <div className="w-full">
            <DecisionBar
              {...bar({
                status: "approved",
                publishable: 84,
                held: 1124,
                heldBecause: held({ needs_category: 1124 }),
                live: 6104,
                decidedLabel: "21 Aug 2026",
                decidedBy: "R. Haddad",
                decisionReason: "Spot-checked twenty licences against the DED portal.",
                reversible: true,
                reversibleUntilLabel: "20 Sep 2026",
                preview: { withdraw: 6090, kept: 14, keptBecause: kept({ claimed: 11, claim_in_progress: 3 }) },
              })}
            />
          </div>
        </States>

        <States label="window closed" stack>
          <div className="w-full">
            <DecisionBar
              {...bar({
                status: "approved",
                publishable: 0,
                held: 0,
                heldBecause: held(),
                live: 5882,
                decidedLabel: "2 Jun 2026",
                decidedBy: "R. Haddad",
                decisionReason: "May DED delta.",
                reversibleUntilLabel: "2 Jul 2026",
              })}
            />
          </div>
        </States>

        <States label="discarded" stack>
          <div className="w-full">
            <DecisionBar
              {...bar({
                status: "discarded",
                publishable: 0,
                held: 0,
                heldBecause: held(),
                decidedLabel: "15 Aug 2026",
                decidedBy: "S. Nair",
                decisionReason: "July's extract uploaded in place of August's.",
              })}
            />
          </div>
        </States>

        <States label="rolled back" stack>
          <div className="w-full">
            <DecisionBar
              {...bar({
                number: 10,
                status: "rolled_back",
                publishable: 0,
                held: 0,
                heldBecause: held(),
                rejected: 0,
                rollback: {
                  atLabel: "9 May 2026",
                  by: "R. Haddad",
                  reason: "The source file duplicated a whole free zone.",
                  withdrawn: 1204,
                  kept: 3,
                },
              })}
            />
          </div>
        </States>

        {/*
           The queue's two empties are different sentences: nothing waiting is
           the job done, and nothing matching is a search that went too far.
           Suspense because the table reads the URL's search params.
        */}
        <States label="queue, cleared" stack>
          <div className="w-full">
            <Suspense>
              <QueueTable rows={[]} page={1} pageSize={50} totalGroups={0} runId={null} query="" options={[]} categorise={inert} />
            </Suspense>
          </div>
        </States>

        <States label="queue, no match" stack>
          <div className="w-full">
            <Suspense>
              <QueueTable
                rows={[]}
                page={1}
                pageSize={50}
                totalGroups={0}
                runId={null}
                query="rope access"
                options={[]}
                categorise={inert}
              />
            </Suspense>
          </div>
        </States>

        <States label="queue, grouped" stack>
          <div className="w-full">
            <Suspense>
              <QueueTable
                rows={[
                  { key: "general trading", activity: "General Trading", records: 412, runNumbers: [13, 14], emirates: [{ emirate: "dubai", count: 380 }, { emirate: "sharjah", count: 32 }], authorities: ["DED", "SHJ"] },
                  { key: "marine equipment trading", activity: "Marine Equipment Trading", records: 84, runNumbers: [14], emirates: [{ emirate: "dubai", count: 84 }], authorities: ["DED"] },
                  { key: "", activity: null, records: 6, runNumbers: [14], emirates: [{ emirate: "dubai", count: 6 }], authorities: ["DED"] },
                ]}
                page={1}
                pageSize={50}
                totalGroups={3}
                runId={null}
                query=""
                options={[]}
                categorise={inert}
              />
            </Suspense>
          </div>
        </States>

        <States label="nothing remembered" stack>
          <div className="w-full">
            <MappingsTable rows={[]} forget={inert} />
          </div>
        </States>

        <States label="rail" stack>
          <div className="grid w-full max-w-sm gap-4">
            <SourcesPanel
              rows={[
                { emirate: "abu_dhabi", authorities: 6, imported: ["ADDED"], lastRunAt: new Date("2026-08-14"), lastSource: "ADDED" },
                { emirate: "dubai", authorities: 18, imported: ["DED", "DMCC"], lastRunAt: new Date("2026-08-21"), lastSource: "DED" },
                { emirate: "sharjah", authorities: 4, imported: [], lastRunAt: null, lastSource: null },
                { emirate: "fujairah", authorities: 2, imported: [], lastRunAt: null, lastSource: null },
              ]}
            />
            <RunHistory
              reversibleDays={30}
              rows={[
                { id: "h13", number: 13, source: "ADDED", status: "approved", net: 2104, createdAt: new Date() },
                { id: "h12", number: 12, source: "DMCC", status: "approved", net: 418, createdAt: new Date() },
                { id: "h11", number: 11, source: "DED", status: "staged", net: null, createdAt: new Date() },
                { id: "h10", number: 10, source: "SAIF", status: "rolled_back", net: -1204, createdAt: new Date() },
              ]}
            />
          </div>
        </States>
      </div>
    </Section>
  );
}
