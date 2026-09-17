"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { PromoteResult } from "./actions";

/**
 * Board `11e` — *"where do you want to be first?"*
 *
 * One slot per subcategory and emirate, a price that follows what buyers do
 * there, a waiting list rather than an auction, and a third of the screen given
 * over to talking the seller out of the purchase.
 *
 * ## One selection, and the panel that prices it
 *
 * The board draws radio-like selection down the list and a panel on the right
 * stating the line, the VAT and the total. That panel is `Corrected at export`
 * §1: the render showed `AED 1,400` unlabelled and then called the same number
 * a total, where `3m`'s invoice computes the booking as
 * `(299 + 1,400) × 1.05`. So the slot price is marked **ex-VAT** wherever it
 * appears, VAT gets its own line, and the only figure called a total carries
 * `incl. VAT`.
 *
 * ## What each row says, and what it refuses to say
 *
 * `14,208 searches a month` is a measurement or it is absent. A scope nobody
 * has visited reads *not measured yet* and prices at the floor, rather than
 * printing a nought that looks like a measurement of nothing. The same rule
 * governs the organic position: `you rank #2` comes off the nightly rank run,
 * and a scope that run has never reached says so instead of showing a dash a
 * seller would read as "last".
 */

export interface SlotRow {
  categoryId: string;
  categoryName: string;
  /** Machine value, posted back with the purchase. Null is a legacy national slot. */
  emirate: string | null;
  /** `Dubai`, or the country-wide label. Already localised. */
  placeName: string;
  band: number;
  monthlyPriceAed: number;
  /** What the holder pays, where the holder is this seller. */
  paidMonthlyAed: number | null;
  /** `14,208 searches a month`, already localised. Null where unmeasured. */
  demand: string | null;
  /** `you rank #2 of 34`, already localised. Null where never ranked. */
  position: string | null;
  mine: boolean;
  takenUntil: string | null;
  queued: boolean;
  ahead: number;
  freed: boolean;
}

export interface SlotBoardProps {
  slots: readonly SlotRow[];
  /** `AED 313.95`, already formatted — what the next invoice adds, incl. VAT. */
  vatRateLabel: string;
  /** The date the booking reaches an invoice. Derived, never a fixed string. */
  billedOn: string;
  takeAction: (formData: FormData) => Promise<PromoteResult>;
  leaveAction: (formData: FormData) => Promise<PromoteResult>;
}

/** VAT as a fraction, for the panel's own line. The rate is statutory. */
const VAT_RATE = 0.05;

export function SlotBoard({
  slots,
  vatRateLabel,
  billedOn,
  takeAction,
  leaveAction,
}: SlotBoardProps) {
  const available = slots.filter((slot) => !slot.mine && slot.takenUntil === null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const keyOf = (slot: SlotRow) => `${slot.categoryId}|${slot.emirate ?? ""}`;
  const chosen = available.find((slot) => keyOf(slot) === selected) ?? null;

  function run(action: (form: FormData) => Promise<PromoteResult>, slot: SlotRow) {
    const form = new FormData();
    form.set("categoryId", slot.categoryId);
    if (slot.emirate) form.set("emirate", slot.emirate);
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSelected(null);
      setNotice(result.queued ? t("promote.joined") : t("promote.taken"));
    });
  }

  const net = chosen?.monthlyPriceAed ?? 0;
  const vat = Math.round(net * VAT_RATE * 100) / 100;

  return (
    <div className="flex flex-col gap-[var(--gutter)] lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        {error && (
          <Alert tone="bad" live="assertive">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert tone="ok" live="polite">
            {notice}
          </Alert>
        )}

        <ul className="flex flex-col gap-2">
          {slots.map((slot) => {
            const key = keyOf(slot);
            const taken = slot.takenUntil !== null;
            const selectable = !slot.mine && !taken;
            return (
              <li key={key}>
                <div
                  /*
                     A taken row is not dimmed.

                     It was, and the contrast pass caught what that cost: 80%
                     opacity over a card takes `--text-muted` to 3.11:1 and
                     `--warn-ink` to 3.38:1, both under the 4.5 floor — on the
                     two lines a taken row exists to carry, which are the demand
                     figures and the seller's own place in the queue. Board flag
                     4 asks that a taken slot show its price for the same
                     reason: a seller joining a waiting list is deciding, and
                     greying out the thing they are deciding on is decoration
                     paid for in legibility. The state is carried by the badge,
                     which is a word.
                  */
                  className={cn(
                    "flex flex-wrap items-start justify-between gap-3 rounded-card border bg-card p-3",
                    selected === key ? "border-[1.5px] border-moss bg-moss-wash" : "border-line",
                  )}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    {selectable ? (
                      <input
                        type="radio"
                        name="slot"
                        id={`slot-${key}`}
                        checked={selected === key}
                        onChange={() => setSelected(key)}
                        className="mt-1 size-4 accent-[var(--moss)] focus-visible:shadow-focus focus-visible:outline-none"
                      />
                    ) : (
                      <span className="mt-1 size-4" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <label
                        htmlFor={selectable ? `slot-${key}` : undefined}
                        className="block text-body-sm font-medium text-ink"
                      >
                        {slot.categoryName} · {slot.placeName}
                      </label>
                      <p className="mt-0.5 text-caption text-muted">
                        {/*
                           Two measurements or two absences, never a nought
                           standing in for either. A scope nobody has visited and
                           a scope with no visitors are different sentences.
                        */}
                        {slot.demand ?? t("promote.demand.unmeasured")}
                        {" · "}
                        {slot.position ?? t("promote.position.unranked")}
                      </p>
                      {slot.queued && (
                        <p className="mt-1 text-caption text-warn-ink">
                          {slot.freed
                            ? t("promote.queue.freed")
                            : t("promote.queue.position", { count: formatCount(slot.ahead) })}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      <p className="font-mono text-body-sm tabular-nums text-ink">
                        {formatAED(slot.mine ? (slot.paidMonthlyAed ?? slot.monthlyPriceAed) : slot.monthlyPriceAed)}
                      </p>
                      <p className="font-mono text-eyebrow uppercase text-muted">
                        {t("promote.per_month_ex_vat")}
                      </p>
                    </div>

                    {slot.mine ? (
                      <StatusBadge tone="ok">{t("promote.state.yours")}</StatusBadge>
                    ) : taken ? (
                      <div className="flex flex-col items-end gap-1">
                        <StatusBadge tone="neutral">
                          {t("promote.state.taken", { when: slot.takenUntil ?? "" })}
                        </StatusBadge>
                        <Button
                          variant={slot.queued ? "ghost" : "secondary"}
                          size="sm"
                          disabled={pending}
                          onClick={() => run(slot.queued ? leaveAction : takeAction, slot)}
                        >
                          {slot.queued ? t("promote.queue.leave") : t("promote.queue.join")}
                        </Button>
                      </div>
                    ) : (
                      <StatusBadge tone="ok">{t("promote.state.available")}</StatusBadge>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/*
         The selection panel. `Corrected at export` §1 in three lines: the slot
         ex-VAT, VAT on its own row, and one total that says `incl. VAT`.

         A `role="group"`, not an `<aside>`. An aside is a complementary
         landmark — a region a screen-reader user navigates *between* — and the
         gallery renders this board in four states, which would put four
         identical entries in the landmark list. The same trade board `12c`'s
         publish strip and `12e`'s matrix already make.
      */}
      <div
        role="group"
        aria-label={t("promote.selection.title")}
        className="w-full shrink-0 rounded-panel border border-line bg-card p-4 lg:w-80"
      >
        <h2 className="text-h3 text-ink">{t("promote.selection.title")}</h2>

        {chosen ? (
          <>
            <dl className="mt-3 flex flex-col gap-2 text-body-sm">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="min-w-0 text-body">
                  {chosen.categoryName} · {chosen.placeName}
                </dt>
                <dd className="font-mono tabular-nums text-ink">
                  {formatAED(chosen.monthlyPriceAed)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-muted">
                <dt>{t("promote.selection.vat", { rate: vatRateLabel })}</dt>
                <dd className="font-mono tabular-nums">{formatAED(vat, { style: "exact" })}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2">
                <dt className="font-medium text-ink">{t("promote.selection.total")}</dt>
                <dd className="font-mono text-body font-medium tabular-nums text-ink">
                  {formatAED(net + vat, { style: "exact" })}
                </dd>
              </div>
            </dl>

            <p className="mt-3 text-caption text-muted">
              {/*
                 `Corrected at export` §2. The board's button read `Start on
                 1 Sep` on the seventeenth — a date sixteen days gone, on the one
                 control that takes money. The slot starts the moment it is
                 taken; what is derived is when it reaches an invoice, which is
                 the seller's own renewal date.
              */}
              {t("promote.selection.billed_on", { when: billedOn })}
            </p>

            <div className="mt-3">
              <Button disabled={pending} onClick={() => run(takeAction, chosen)}>
                {t("promote.selection.start")}
              </Button>
            </div>
            <p className="mt-2 text-caption text-muted">{t("promote.selection.cancel_any")}</p>
          </>
        ) : (
          <p className="mt-2 max-w-prose text-body-sm text-muted">
            {available.length === 0
              ? t("promote.selection.none_free")
              : t("promote.selection.choose")}
          </p>
        )}
      </div>
    </div>
  );
}
