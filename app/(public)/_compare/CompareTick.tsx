"use client";

import { useId } from "react";
import { Check } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import { tickState, type Tray } from "@/lib/compare/tray";
import { COMPARE_ENDPOINT, useCompareSubmit, useTray } from "./store";

/**
 * Board `10d` — *Compare*, on a product.
 *
 * A form rather than a link, because adding to the tray changes something: it
 * posts to `/api/compare`, which works with JavaScript off (the browser comes
 * back to this page with the cookie set) and, with it on, updates every tick
 * and the sticky tray without a navigation.
 *
 * **Products only** (`B8`). Nothing that renders a service or a supplier row is
 * handed one of these: `/compare` sets fields from one spec template side by
 * side, a service has no spec template, and what a buyer compares for a
 * service is the proposals that come back (`1n-s`).
 *
 * The four states and what each says before it is pressed:
 *
 * | State | Button | Why |
 * |---|---|---|
 * | add | *Compare* | — |
 * | in | *In the comparison*, pressed | pressing again takes it out |
 * | switch | *Compare*, described as starting a new comparison | another trade is held; `B1` allows one |
 * | full | *Comparison full*, unavailable, naming the four held | `B7` — refused, and said |
 *
 * The full state is `aria-disabled` rather than `disabled` so it stays in the
 * tab order and its reason can be read. A `disabled` button is skipped by the
 * keyboard, and a refusal nobody can reach is a refusal nobody is told.
 */
export function CompareTick({
  productId,
  productName,
  tradeId,
  className,
  tray: fixed,
}: {
  productId: string;
  productName: string;
  /** The product's own category — the trade its template comes from. */
  tradeId: string;
  className?: string;
  /** A tray to draw against instead of the buyer's cookie. The gallery's specimens; nothing else passes it. */
  tray?: Tray;
}) {
  const live = useTray();
  const tray = fixed ?? live;
  const state = tickState(tray, productId, tradeId);
  const { pending, onSubmit } = useCompareSubmit();
  const describedBy = useId();

  const pressed = state.kind === "in";
  const unavailable = state.kind === "full";

  const description =
    state.kind === "switch"
      ? t("compare.tick_switch", { count: state.held, trade: state.heldTrade })
      : state.kind === "full"
        ? t("compare.tick_full", { names: formatList(state.held.map((item) => item.name)) })
        : null;

  return (
    /*
       `relative` is load-bearing. The two `sr-only` spans are absolutely
       positioned; without a positioned ancestor here they take the page as
       their containing block, escape the `overflow-x: auto` of a card carousel,
       and widen the whole document on a phone — which mobile Chrome answers by
       zooming the page out.
    */
    <form method="post" action={COMPARE_ENDPOINT} onSubmit={onSubmit} className={cn("relative inline-flex", className)}>
      <input type="hidden" name="intent" value={pressed ? "remove" : "add"} />
      <input type="hidden" name="productId" value={productId} />
      <button
        type="submit"
        aria-pressed={pressed}
        aria-disabled={unavailable || undefined}
        aria-busy={pending || undefined}
        aria-describedby={description ? describedBy : undefined}
        title={description ?? undefined}
        onClick={(event) => {
          // Unavailable is refused here and again on the server; this only
          // saves the round trip for a result that is already known.
          if (unavailable) event.preventDefault();
        }}
        data-compare-product={productId}
        className={cn(
          "inline-flex min-h-8 items-center gap-1.5 rounded-tag py-0.5 text-caption",
          "transition-colors duration-120 ease-out focus-visible:outline-none focus-visible:shadow-focus",
          pressed ? "font-medium text-ink" : unavailable ? "cursor-not-allowed text-muted" : "text-moss hover:text-moss-hover",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded-tag border",
            pressed ? "border-moss bg-moss text-on-ink" : "border-line-strong bg-card",
          )}
        >
          {pressed && <Check size={11} />}
        </span>
        {pressed ? t("compare.in_tray") : unavailable ? t("compare.full") : t("action.compare")}
        {/* The product's name in the accessible name: a column of *Compare* buttons is unambiguous to read and not to hear. */}
        <span className="sr-only"> {productName}</span>
      </button>
      {description && (
        <span id={describedBy} className="sr-only">
          {description}
        </span>
      )}
    </form>
  );
}
