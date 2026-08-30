"use client";

import { useState, useTransition } from "react";
import { Button, Input, Radio, RadioGroup } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 4f — account health.
 *
 * Every column is measured. Reply time comes from enquiry-to-first-reply
 * timestamps and profile strength from a pure function over what the seller
 * filled in — neither has a seller-writable path, and neither is invented here.
 *
 * The decision strip is new. `setVerificationTier`, `suspendBusiness` and
 * `liftSuspension` had all been written, audited and tested, and there had
 * never been a control anywhere that called them: staff could read the state
 * of every account on this screen and change none of it.
 */

export interface BusinessRow {
  id: string;
  displayName: string;
  plan: string;
  tier: number;
  replyMs: number | null;
  strength: number | null;
  state: "suspended" | "merged" | "unclaimed" | "live";
  /**
   * Worked out on the server, per row and per seat. A field verifier holds
   * `business.verification_tier.write` but may only tier a business they
   * visited, so this is not the same for every row.
   */
  mayTier: boolean;
  maySuspend: boolean;
}

const TONE = {
  suspended: "bad",
  merged: "neutral",
  unclaimed: "warn",
  live: "ok",
} as const;

const TIERS = [0, 1, 2, 3, 4] as const;
/** The same floor `assertReason` enforces at the fence. Kept in step by hand. */
const MIN_REASON = 4;

export interface BusinessTableProps {
  rows: readonly BusinessRow[];
  setTier: (formData: FormData) => Promise<ActionResult>;
  suspend: (formData: FormData) => Promise<ActionResult>;
  lift: (formData: FormData) => Promise<ActionResult>;
}

export function BusinessTable({ rows, setTier, suspend, lift }: BusinessTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [tier, setTierValue] = useState<string>("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const row = rows.find((candidate) => candidate.id === open) ?? null;
  const ready = reason.trim().length >= MIN_REASON && !pending;

  function act(action: (form: FormData) => Promise<ActionResult>, withTier = false) {
    if (!row) return;
    const form = new FormData();
    form.set("businessId", row.id);
    form.set("reason", reason);
    if (withTier) form.set("tier", tier);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setReason("");
        setTierValue("");
      }
    });
  }

  const columns: Column<BusinessRow>[] = [
    {
      key: "business",
      header: t("admin.businesses.col.business"),
      render: (row) => row.displayName,
    },
    {
      key: "plan",
      header: t("admin.businesses.col.plan"),
      width: "7rem",
      mono: true,
      render: (row) => row.plan,
    },
    {
      key: "tier",
      header: t("admin.businesses.col.tier"),
      numeric: true,
      width: "5rem",
      mono: true,
      render: (row) => String(row.tier),
    },
    {
      key: "reply",
      header: t("admin.businesses.col.reply"),
      numeric: true,
      width: "9rem",
      hideBelow: "md",
      // Measured, never claimed. A dash means not enough replies to say.
      render: (row) => (row.replyMs === null ? "—" : formatDuration(row.replyMs)),
    },
    {
      key: "strength",
      header: t("admin.businesses.col.strength"),
      numeric: true,
      width: "7rem",
      hideBelow: "lg",
      render: (row) => (row.strength === null ? "—" : `${formatCount(row.strength)}%`),
    },
    {
      key: "state",
      header: t("admin.businesses.col.state"),
      width: "9rem",
      render: (row) => (
        <StatusBadge tone={TONE[row.state]}>
          {t(`admin.businesses.state.${row.state}` as never)}
        </StatusBadge>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <DataTable
        caption={t("admin.businesses.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowTone={(row) => (row.state === "suspended" ? "blocked" : "default")}
        /*
           Offered only where the service would accept it. A moderator and a
           finance seat hold neither capability and get no control at all,
           which is what the `staff-moderator` e2e project asserts — it has
           been passing since before any of these buttons existed, because
           there were none, and it has to go on passing now there are.
        */
        rowAction={(row) =>
          row.mayTier || row.maySuspend
            ? {
                label: t("admin.businesses.col.decide"),
                onSelect: () => {
                  setOpen(row.id);
                  setTierValue(String(row.tier));
                  setResult(null);
                },
              }
            : null
        }
        actionsHeader={t("admin.businesses.col.decide")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.businesses.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.businesses.empty.body")}
            </p>
          </div>
        }
      />

      {row && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
          <p className="text-body-sm text-ink">{row.displayName}</p>

          {row.mayTier && (
            <RadioGroup
              legend={t("admin.businesses.tier_legend")}
              orientation="horizontal"
              hint={t("admin.businesses.tier_visit_note")}
            >
              {TIERS.map((value) => (
                <Radio
                  key={value}
                  name="tier"
                  value={String(value)}
                  checked={tier === String(value)}
                  onChange={(event) => setTierValue(event.target.value)}
                  label={String(value)}
                  aria-label={t("admin.businesses.tier_option", { tier: String(value) })}
                />
              ))}
            </RadioGroup>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1">
              <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>

            {row.mayTier && (
              <Button disabled={!ready || tier === ""} onClick={() => act(setTier, true)}>
                {t("admin.businesses.action.tier")}
              </Button>
            )}

            {/*
               Suspension is the destructive half and reads as secondary, and
               a suspended row offers the lift instead — one direction at a
               time, because "we were wrong" and "they fixed it" are different
               facts and each needs its own reason.
            */}
            {row.maySuspend &&
              (row.state === "suspended" ? (
                <Button variant="secondary" disabled={!ready} onClick={() => act(lift)}>
                  {t("admin.businesses.action.lift")}
                </Button>
              ) : (
                <Button variant="secondary" disabled={!ready} onClick={() => act(suspend)}>
                  {t("admin.businesses.action.suspend")}
                </Button>
              ))}

            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
          </div>

          {row.maySuspend && row.state !== "suspended" && (
            <p className="text-caption text-muted">{t("admin.businesses.suspend_note")}</p>
          )}
        </div>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
