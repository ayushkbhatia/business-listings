"use client";

import { useState, useTransition } from "react";
import { Button, Input, Radio, RadioGroup } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { formatCount, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";
import { TOP_ACHIEVABLE_TIER } from "@/lib/verification";
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
  state: "suspended" | "merged" | "closed" | "closing" | "unclaimed" | "live";
  /**
   * Worked out on the server, per seat. `business.verification_tier.write` is
   * ops lead alone since the field verifier was retired (board 4i), so today it
   * is the same on every row — kept per row so a subject rule can return
   * without reshaping the table.
   */
  mayTier: boolean;
  maySuspend: boolean;
  /** Board 11i. Ops lead only — `business.close`. */
  mayClose: boolean;
  /** The open closure, dated: when a notice takes effect, or the last day to reverse. */
  closure: { kind: "notice" | "closing"; date: string } | null;
  /** B8 applies only to a licence that has actually lapsed. */
  licenceLapsed: boolean;
}

const TONE = {
  suspended: "bad",
  merged: "neutral",
  closed: "neutral",
  closing: "warn",
  unclaimed: "warn",
  live: "ok",
} as const;

/*
   The rungs an ops lead may set, derived rather than listed.

   This was `[0, 1, 2, 3, 4]` — two radios past the end of a ladder that has been
   shorter than five since site visits were withdrawn. `setVerificationTier`
   refused 4 and the CHECK refused it underneath, so clicking it produced an
   error rather than a write; 3 went through into a rung nothing drew. Offering
   a control that cannot work is the staff-side of the defect the buyer's facet
   rail had — an option the interface promises and the fence refuses.

   `TOP_ACHIEVABLE_TIER` is the same number `MAX_TIER` in
   lib/verification/service.ts refuses above and the same number
   `business_verification_tier_range` holds at 2, so the radios cannot outlive
   the ladder again.
*/
const TIERS = Array.from({ length: TOP_ACHIEVABLE_TIER + 1 }, (_, tier) => tier);
/** The same floor `assertReason` enforces at the fence. Kept in step by hand. */
const MIN_REASON = 4;

export interface BusinessTableProps {
  rows: readonly BusinessRow[];
  setTier: (formData: FormData) => Promise<ActionResult>;
  suspend: (formData: FormData) => Promise<ActionResult>;
  lift: (formData: FormData) => Promise<ActionResult>;
  giveNotice: (formData: FormData) => Promise<ActionResult>;
  withdraw: (formData: FormData) => Promise<ActionResult>;
  reopen: (formData: FormData) => Promise<ActionResult>;
}

export function BusinessTable({
  rows,
  setTier,
  suspend,
  lift,
  giveNotice,
  withdraw,
  reopen,
}: BusinessTableProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
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
    form.set("ownerEmail", ownerEmail);
    if (withTier) form.set("tier", tier);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setReason("");
        setOwnerEmail("");
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
        <span className="flex flex-col items-start gap-0.5">
          <StatusBadge tone={TONE[row.state]}>
            {t(`admin.businesses.state.${row.state}` as never)}
          </StatusBadge>
          {row.closure && (
            <span className="text-caption text-muted">
              {t(`admin.businesses.closure.until_${row.closure.kind}` as "admin.businesses.closure.until_notice", {
                date: row.closure.date,
              })}
            </span>
          )}
        </span>
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
          row.mayTier || row.maySuspend || row.mayClose
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

            {/*
               Board 11i. One closure control at a time, chosen by where the
               business is: notice for a lapsed licence with nothing open,
               withdraw for anything open, reopen for a closure already final.
               Offering "give notice" over a current licence would be offering
               a control the service refuses, which this screen stopped doing.
            */}
            {row.mayClose && row.closure && (
              <Button variant="secondary" disabled={!ready} onClick={() => act(withdraw)}>
                {t("admin.businesses.closure.action.withdraw")}
              </Button>
            )}
            {row.mayClose && !row.closure && row.state === "live" && row.licenceLapsed && (
              <Button variant="secondary" disabled={!ready} onClick={() => act(giveNotice)}>
                {t("admin.businesses.closure.action.notice")}
              </Button>
            )}

            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
          </div>

          {row.mayClose && row.state === "closed" && (
            <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <label className="flex min-w-64 flex-1 flex-col gap-1">
                <span className="text-body-sm text-ink">{t("admin.businesses.closure.owner_email")}</span>
                <Input
                  type="email"
                  autoComplete="off"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                />
              </label>
              <Button
                variant="secondary"
                disabled={!ready || !ownerEmail.includes("@")}
                onClick={() => act(reopen)}
              >
                {t("admin.businesses.closure.action.reopen")}
              </Button>
              <p className="w-full text-caption text-muted">{t("admin.businesses.closure.reopen_note")}</p>
            </div>
          )}

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
