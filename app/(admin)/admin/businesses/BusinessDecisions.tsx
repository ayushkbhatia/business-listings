"use client";

import { useState, useTransition } from "react";
import { Button, Input, Radio, RadioGroup } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import { TOP_ACHIEVABLE_TIER } from "@/lib/verification";
import type { ActionResult } from "./actions";

/**
 * Board 4f — the decisions on one account, on its own page.
 *
 * `B10`: opening a business from the list is read-only; the account's page is
 * where anything changes, and every change here is a logged `staffMutation`
 * with a written reason. Suspension and closure are ops lead alone, tier is ops
 * lead alone, and the controls a seat does not hold are not offered — the
 * service refuses them regardless.
 *
 * Moved from the list rather than rewritten. These controls were proven by the
 * acceptance suite against the services underneath; a board that re-drew them
 * would re-open questions those tests had closed.
 */

export interface DecisionSubject {
  id: string;
  displayName: string;
  tier: number;
  state: "suspended" | "merged" | "closed" | "closing" | "unclaimed" | "live";
  /**
   * Worked out on the server, per seat. `business.verification_tier.write` is
   * ops lead alone since the field verifier was retired (board 4i).
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

/*
   The rungs an ops lead may set, derived rather than listed.

   This was `[0, 1, 2, 3, 4]` — two radios past the end of a ladder that has been
   shorter than five since site visits were withdrawn. `TOP_ACHIEVABLE_TIER` is
   the same number `MAX_TIER` in lib/verification/service.ts refuses above and
   the same number `business_verification_tier_range` holds at 2, so the radios
   cannot outlive the ladder again (board 4f `B3`).
*/
const TIERS = Array.from({ length: TOP_ACHIEVABLE_TIER + 1 }, (_, tier) => tier);
/** The same floor `assertReason` enforces at the fence. Kept in step by hand. */
const MIN_REASON = 4;

export interface BusinessDecisionsProps {
  subject: DecisionSubject;
  setTier: (formData: FormData) => Promise<ActionResult>;
  suspend: (formData: FormData) => Promise<ActionResult>;
  lift: (formData: FormData) => Promise<ActionResult>;
  giveNotice: (formData: FormData) => Promise<ActionResult>;
  withdraw: (formData: FormData) => Promise<ActionResult>;
  reopen: (formData: FormData) => Promise<ActionResult>;
}

export function BusinessDecisions({ subject, setTier, suspend, lift, giveNotice, withdraw, reopen }: BusinessDecisionsProps) {
  const [reason, setReason] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [tier, setTierValue] = useState<string>(String(subject.tier));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = reason.trim().length >= MIN_REASON && !pending;

  function act(action: (form: FormData) => Promise<ActionResult>, withTier = false) {
    const form = new FormData();
    form.set("businessId", subject.id);
    form.set("reason", reason);
    form.set("ownerEmail", ownerEmail);
    if (withTier) form.set("tier", tier);
    startTransition(async () => {
      const outcome = await action(form);
      setResult(outcome);
      if (outcome.ok) {
        setReason("");
        setOwnerEmail("");
      }
    });
  }

  if (!subject.mayTier && !subject.maySuspend && !subject.mayClose) {
    return <p className="text-body-sm text-body">{t("admin.businesses.decisions.none")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {subject.mayTier && (
        <RadioGroup legend={t("admin.businesses.tier_legend")} orientation="horizontal">
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

      <label className="flex flex-col gap-1">
        <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {subject.mayTier && (
          <Button disabled={!ready || tier === ""} onClick={() => act(setTier, true)}>
            {t("admin.businesses.action.tier")}
          </Button>
        )}

        {/*
           Suspension is the destructive half and reads as secondary, and a
           suspended account offers the lift instead — one direction at a time,
           because "we were wrong" and "they fixed it" are different facts and
           each needs its own reason.
        */}
        {subject.maySuspend &&
          (subject.state === "suspended" ? (
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
           business is: notice for a lapsed licence with nothing open, withdraw
           for anything open, reopen for a closure already final.
        */}
        {subject.mayClose && subject.closure && (
          <Button variant="secondary" disabled={!ready} onClick={() => act(withdraw)}>
            {t("admin.businesses.closure.action.withdraw")}
          </Button>
        )}
        {subject.mayClose && !subject.closure && subject.state === "live" && subject.licenceLapsed && (
          <Button variant="secondary" disabled={!ready} onClick={() => act(giveNotice)}>
            {t("admin.businesses.closure.action.notice")}
          </Button>
        )}
      </div>

      {subject.mayClose && subject.state === "closed" && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("admin.businesses.closure.owner_email")}</span>
            <Input
              type="email"
              autoComplete="off"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
            />
          </label>
          <div>
            <Button variant="secondary" disabled={!ready || !ownerEmail.includes("@")} onClick={() => act(reopen)}>
              {t("admin.businesses.closure.action.reopen")}
            </Button>
          </div>
          <p className="text-caption text-body">{t("admin.businesses.closure.reopen_note")}</p>
        </div>
      )}

      {subject.maySuspend && subject.state !== "suspended" && (
        <p className="text-caption text-body">{t("admin.businesses.suspend_note")}</p>
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
