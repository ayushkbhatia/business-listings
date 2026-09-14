"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { Button } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { AddedBranchResult } from "./actions";

/**
 * Board 12b Q2, on the owner's side.
 *
 * A staff member at 74% confidence is one click from adding a branch to a
 * listing with a live subscription, and the owner is the only person who
 * actually knows whether Shop 12 in Al Quoz is theirs. So the branch waits
 * here until they say — or, when a bulk merge added it live, stays removable
 * for as long as the decision is reversible.
 */

export interface AddedBranchRow {
  locationId: string;
  area: string;
  address: string;
  licence: string | null;
  source: string | null;
  confirmation: "awaiting" | "informed";
  /** Pre-formatted: the day the owner can no longer remove a live branch. */
  untilLabel: string | null;
}

export interface AddedBranchesProps {
  rows: readonly AddedBranchRow[];
  readOnly: boolean;
  decide: (formData: FormData) => Promise<AddedBranchResult>;
}

export function AddedBranches({ rows, readOnly, decide }: AddedBranchesProps) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState<AddedBranchRow | null>(null);
  const [result, setResult] = useState<AddedBranchResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0 && !result) return null;

  function send(row: AddedBranchRow, decision: "confirm" | "reject") {
    const form = new FormData();
    form.set("locationId", row.locationId);
    form.set("decision", decision);
    form.set("area", row.area);
    startTransition(async () => {
      const outcome = await decide(form);
      setResult(outcome);
      setRejecting(null);
      router.refresh();
    });
  }

  return (
    <Panel title={t("locations.added.title")} description={t("locations.added.description")}>
      <div className="flex flex-col gap-3">
        {result && (
          <Alert
            tone={result.ok ? "ok" : "bad"}
            live={result.ok ? "polite" : "assertive"}
            {...(result.ok ? {} : { fix: result.fix })}
          >
            {result.ok ? result.message : result.error}
          </Alert>
        )}
        {rows.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {rows.map((row) => (
              <li key={row.locationId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-body text-ink">{row.area}</p>
                  {row.address && row.address !== row.area && <p className="text-body-sm text-body">{row.address}</p>}
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-body">
                    <StatusBadge tone={row.confirmation === "awaiting" ? "warn" : "neutral"} size="sm">
                      {row.confirmation === "awaiting"
                        ? t("locations.added.awaiting")
                        : t("locations.added.informed", { date: row.untilLabel ?? "" })}
                    </StatusBadge>
                    {row.licence && (
                      <span className="font-mono">{t("locations.added.licence", { licence: row.licence })}</span>
                    )}
                    {row.source && <span>{t("locations.added.source", { source: row.source })}</span>}
                  </p>
                </div>
                {!readOnly && (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" disabled={pending} onClick={() => setRejecting(row)}>
                      {t("locations.added.reject")}
                    </Button>
                    {row.confirmation === "awaiting" && (
                      <Button size="sm" loading={pending} disabled={pending} onClick={() => send(row, "confirm")}>
                        {t("locations.added.confirm")}
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={rejecting !== null}
        onClose={() => {
          if (!pending) setRejecting(null);
        }}
        title={t("locations.added.reject_title", { area: rejecting?.area ?? "" })}
        description={t("locations.added.reject_description")}
        closeLabel={t("action.cancel")}
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setRejecting(null)}>
              {t("action.cancel")}
            </Button>
            <Button variant="danger" loading={pending} disabled={pending} onClick={() => rejecting && send(rejecting, "reject")}>
              {t("locations.added.reject_confirm")}
            </Button>
          </>
        }
      />
    </Panel>
  );
}
