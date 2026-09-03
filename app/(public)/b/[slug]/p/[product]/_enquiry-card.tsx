"use client";

import { useState, useSyncExternalStore } from "react";
import { Stepper } from "@/components/primitives";
import { cn } from "@/lib/cn";
import {
  selectionKey,
  selectionServerSnapshot,
  selectionSnapshot,
  setSelection,
  subscribeSelection,
} from "../../products/selection-store";
import { useEnquiry, useQuantity } from "./_enquiry-context";

/**
 * The enquiry card, and the sticky bar it becomes on a phone.
 *
 * No composer of its own: every trigger on this page opens the one
 * `EnquireDrawer` the provider renders. Three drawers were three identical
 * forms in the DOM, which is board 1d's duplicate-composer defect by a
 * different route.
 *
 * The quantity lives in the provider for the same reason — it is the one field
 * a buyer sets before sending, and it has to reach the enquiry as a line rather
 * than as a sentence in the free-text box. A seller quoting for forty units
 * should see forty in the line, not have to read for it.
 *
 * Everything else arrives already rendered from the server: the confidence
 * block, the band table and the detail list are nodes. That keeps the
 * localisation, the band derivation and the measured reply time on the server,
 * where they can be tested without a browser.
 */

export interface EnquiryCardProps {
  minOrderQty: number;
  productId: string;
  /** Board 1g: "Send enquiry", or "Notify me" when there is none in stock. */
  primaryLabel: string;
  /** Shown beside the primary when the product is out of stock. */
  leadTimeLabel?: string;
  leadTimeSeed?: string;
  enquirySeed: string;
  whatsappHref?: string;
  whatsappLabel: string;
  rfqLabel: string;
  rfqAddedLabel: string;
  /** Shown once the selection holds more than one item. */
  rfqCrossoverLabel: string;
  quantityLabel: string;
  decrementLabel: string;
  incrementLabel: string;
  confidence: React.ReactNode;
  bands: React.ReactNode;
  details: React.ReactNode;
  /** For the sticky bar below 768, which names what it is sending about. */
  productName: string;
  /** Adds this product to the catalogue's selection, per board 1e. */
  storefrontSlug: string;
}

export function EnquiryCard({
  minOrderQty,
  productId,
  primaryLabel,
  leadTimeLabel,
  leadTimeSeed,
  enquirySeed,
  whatsappHref,
  whatsappLabel,
  rfqLabel,
  rfqAddedLabel,
  rfqCrossoverLabel,
  quantityLabel,
  decrementLabel,
  incrementLabel,
  confidence,
  bands,
  details,
  productName,
  storefrontSlug,
}: EnquiryCardProps) {
  const { open } = useEnquiry();
  const { qty, setQty } = useQuantity();
  const [added, setAdded] = useState(false);

  /*
     The live selection, read from board 1e's store rather than mirrored into
     local state. A count kept here would go stale the moment the buyer added
     something from the catalogue in another tab, and the store already
     publishes changes — the same `useSyncExternalStore` shape 1e uses.
  */
  const key = selectionKey(storefrontSlug);
  const selected = useSyncExternalStore(
    subscribeSelection(key),
    () => selectionSnapshot(key),
    selectionServerSnapshot,
  );

  /*
     The bridge to board 1e. A buyer who needs four things starts on one product
     page and accumulates rather than sending four separate enquiries — so this
     writes through the catalogue's own store, keyed by the same seller. Going
     through `setSelection` also notifies its subscribers, so a tray open in
     another tab of the same session updates rather than drifting.

     It is not a basket: nothing crosses storefronts and nothing survives the
     session.
  */
  /*
     Two handoffs give this button different destinations, and it does both.

     Board 1g calls it "the bridge to 1e's selection mechanic — a buyer who
     needs four things starts here and accumulates". Board 1h's composer model
     lists it as the one control that "crosses over" to `/rfq/new`.

     Accumulating first is right either way: a buyer who has added one thing has
     not yet said whether they want several *suppliers*. The crossover appears
     once there is more than one item, which is the moment the composer model
     describes — a buyer who "realises they need several things from several
     suppliers". Neither document specifies this exact shape; it is a product
     decision, flagged as one in the PR.
  */
  function addToRfq() {
    const current = selectionSnapshot(key);
    if (!current.includes(productId)) setSelection(key, [...current, productId]);
    setAdded(true);
  }

  const primary = (
    <button type="button" onClick={() => open(enquirySeed)} className={PRIMARY}>
      {primaryLabel}
    </button>
  );

  return (
    <>
      <div className="rounded-card border border-line-strong bg-card p-4">
        {confidence}
        <div className="mt-4">{bands}</div>

        <div className="mt-4 flex flex-col gap-2.5">
          <Stepper
            value={Math.max(qty, minOrderQty)}
            onChange={setQty}
            min={Math.max(1, minOrderQty)}
            label={quantityLabel}
            decrementLabel={decrementLabel}
            incrementLabel={incrementLabel}
            suffix="pcs"
          />
          {primary}

          <div className="flex flex-wrap gap-2">
            {whatsappHref && (
              <a href={whatsappHref} rel="nofollow noopener" className={SECONDARY}>
                {whatsappLabel}
              </a>
            )}
            <button type="button" onClick={addToRfq} className={SECONDARY} disabled={added}>
              {added ? rfqAddedLabel : rfqLabel}
            </button>
            {/*
               The crossover, once there is more than one thing to ask about.
               Below that it would be a fan-out button on a single item, which
               is the enquiry the primary already sends.
            */}
            {selected.length > 1 && (
              <a
                href={`/rfq/new?products=${encodeURIComponent(selected.join(","))}`}
                className={SECONDARY}
              >
                {rfqCrossoverLabel}
              </a>
            )}
            {/*
               Out of stock keeps an enquiry path. The primary becomes "Notify
               me", so this is the door for a buyer who wants the lead time
               rather than a notification — removing it would leave the state
               with no way to ask a question.
            */}
            {leadTimeLabel && leadTimeSeed && (
              <button
                type="button"
                onClick={() => open(leadTimeSeed)}
                className={SECONDARY}
              >
                {leadTimeLabel}
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-3">{details}</div>
      </div>

      {/*
         Criterion 13. This page is long and a buyer arrives mid-page from a
         search, so the action has to travel with them — losing it above the
         fold loses the enquiry.

         Hidden with `display` above the breakpoint, so exactly one trigger is
         in the accessibility tree at any width.
      */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line",
          "bg-card px-4 py-2.5 shadow-overlay md:hidden",
        )}
      >
        <p className="min-w-0 flex-1 truncate text-caption text-body">{productName}</p>
        <button
          type="button"
          onClick={() => open(enquirySeed)}
          className={cn(PRIMARY, "w-auto shrink-0 px-5")}
        >
          {primaryLabel}
        </button>
      </div>
    </>
  );
}

/** The one-click request for the fields the seller has not filled. */
export function SpecRequestButton({ label, seed }: { label: string; seed: string }) {
  const { open } = useEnquiry();
  return (
    <button type="button" onClick={() => open(seed)} className={SECONDARY}>
      {label}
    </button>
  );
}

const PRIMARY = cn(
  "inline-flex min-h-11 w-full items-center justify-center rounded-ctl bg-moss px-4",
  "text-body-sm font-medium text-white hover:bg-moss-deep",
  "focus-visible:outline-none focus-visible:shadow-focus",
);

const SECONDARY = cn(
  "inline-flex min-h-11 items-center rounded-ctl border border-line bg-card px-3.5",
  "text-body-sm font-medium text-ink hover:bg-paper",
  "focus-visible:outline-none focus-visible:shadow-focus",
  "disabled:cursor-default disabled:text-muted",
);
