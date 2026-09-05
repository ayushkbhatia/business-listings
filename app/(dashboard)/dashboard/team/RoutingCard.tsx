"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Radio, Select } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { TeamActionResult } from "./actions";

/**
 * Board 7d §4 — who a lead goes to, and what happens when the answer is nobody.
 *
 * ## The lede states a measured thing
 *
 * The board's card read "protects your response score". There is no score in
 * this product. What the setting actually moves is the median first reply, and
 * that is two real things: a weight in search ranking, read live from the
 * ranking weights rather than written here as a number, and the band a buyer
 * sees on the listing. Both are checkable; "your response score" is not.
 *
 * ## Why all three modes are offered
 *
 * §4 renders "Everyone sees everything, fastest to claim it wins" disabled,
 * because first-to-claim needs a `Claim` action board 3j did not ship. It is
 * the *claim* that is missing, not the mode: `everyone` is the stored default
 * for every business on the platform and it does exactly what its description
 * says — every seat sees every enquiry and anybody can answer. Disabling it
 * would leave most sellers reading that their current setting is unavailable.
 *
 * So the mode ships and the racing does not, and the hint says so rather than
 * implying a scramble the inbox has no button for.
 */

export interface RoutingMode {
  value: string;
  label: string;
  hint: string;
}

export interface RoutingCardProps {
  routing: string;
  escalationMinutes: number;
  modes: readonly RoutingMode[];
  escalationChoices: readonly { value: string; label: string }[];
  /** Pre-resolved with the live ranking weight, so it is a query not a constant. */
  lede: string;
  /**
   * Set on a one-seat business, and then the modes are not offered at all.
   * §7: "routing card collapses to one line: everything comes to you. No
   * round-robin over one seat."
   */
  singleSeat: boolean;
  /** "2 seats have no verified channel and are skipped." Null when none are. */
  unreachableNote: string | null;
  action: (formData: FormData) => Promise<TeamActionResult>;
}

export function RoutingCard(props: RoutingCardProps) {
  const [routing, setRouting] = useState(props.routing);
  const [escalation, setEscalation] = useState(props.escalationMinutes);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await props.action(form);
      if (!result.ok) setError(result.error);
      else setNotice(t("routing.saved"));
    });
  }

  return (
    <Panel title={t("routing.heading")} description={props.lede}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(new FormData(event.currentTarget));
        }}
      >
        {error && <Alert tone="bad" live="assertive">{error}</Alert>}

        {props.singleSeat ? (
          <>
            <p className="max-w-prose text-body-sm text-ink">{t("routing.single_seat")}</p>
            {/*
              Posted anyway. The seller cannot choose here and the stored value
              must not silently become `everyone` the first time they touch the
              escalation control — a business that had round-robin set, then
              lost a seat, keeps it for when the seat comes back.
            */}
            <input type="hidden" name="routing" value={routing} />
          </>
        ) : (
          <fieldset className="min-w-0 border-0 p-0">
            <legend className="sr-only">{t("routing.heading")}</legend>
            <div className="flex flex-col gap-2">
              {props.modes.map((mode) => (
                <Radio
                  key={mode.value}
                  name="routing"
                  value={mode.value}
                  checked={routing === mode.value}
                  onChange={() => setRouting(mode.value)}
                  label={mode.label}
                  description={mode.hint}
                />
              ))}
            </div>
          </fieldset>
        )}

        <label className="flex max-w-xs flex-col gap-1">
          <span className="text-body-sm text-ink">{t("routing.escalation")}</span>
          <Select
            name="escalationMinutes"
            value={String(escalation)}
            onChange={(event) => setEscalation(Number(event.target.value))}
            options={[...props.escalationChoices]}
          />
          <span className="text-caption text-muted">{t("routing.escalation_hint")}</span>
        </label>

        <div className="flex flex-col gap-1.5 border-t border-line pt-3">
          {/*
            The failure this pair of screens exists to close, said on the screen
            that causes it. §4: "if no seat is reachable the lead goes to the
            owner and is marked unrouted" — a seller who does not know that will
            read an unassigned lead as a bug in the inbox.
          */}
          <p className="max-w-prose text-caption text-muted">{t("routing.unroutable")}</p>
          <p className="max-w-prose text-caption text-muted">{t("routing.hours_source")}</p>
          {props.unreachableNote && (
            <p className="max-w-prose text-caption text-warn-ink">{props.unreachableNote}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending}>
            {t("routing.save")}
          </Button>
          <span aria-live="polite" className="text-body-sm text-muted">
            {notice}
          </span>
        </div>
      </form>
    </Panel>
  );
}
