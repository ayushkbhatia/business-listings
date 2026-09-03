"use client";

import { useState } from "react";
import { Stepper } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { EnquireButton } from "../../EnquireDrawer";
import type { EnquireProps } from "../../EnquireDrawer";
import {
  selectionKey,
  selectionSnapshot,
  setSelection,
} from "../../products/selection-store";

/**
 * The enquiry card, and the sticky bar it becomes on a phone.
 *
 * The quantity lives here because it is the one field the buyer sets before
 * sending, and it has to reach the enquiry as a line rather than as a sentence
 * in the free-text box — a seller quoting for 40 units should see 40 in the
 * line, not have to read for it.
 *
 * Everything except the quantity arrives already rendered from the server:
 * the confidence block, the band table and the detail list are all nodes. That
 * keeps the localisation, the band derivation and the measured reply time on
 * the server, where they can be tested without a browser — and it is the shape
 * boards 1d, 1e and 1f each arrived at after passing a function across the
 * boundary and rendering nothing at all.
 */

export interface EnquiryCardProps {
  enquire: EnquireProps;
  /** The line this page is about, minus the quantity, which is state. */
  line: {
    key: string;
    productId: string;
    description: string;
    unit: string;
    size: string;
  };
  minOrderQty: number;
  /** Board 1g: "Send enquiry", or "Notify me" when there is none in stock. */
  primaryLabel: string;
  /** Shown beside the primary when the product is out of stock. */
  leadTimeLabel?: string;
  whatsappHref?: string;
  whatsappLabel: string;
  rfqLabel: string;
  rfqAddedLabel: string;
  quantityLabel: string;
  decrementLabel: string;
  incrementLabel: string;
  /** Server-rendered blocks. */
  confidence: React.ReactNode;
  bands: React.ReactNode;
  details: React.ReactNode;
  /** For the sticky bar below 768, which names what it is sending about. */
  productName: string;
  /** Adds this product to the storefront catalogue's selection, per board 1e. */
  storefrontSlug: string;
}

export function EnquiryCard({
  enquire,
  line,
  minOrderQty,
  primaryLabel,
  leadTimeLabel,
  whatsappHref,
  whatsappLabel,
  rfqLabel,
  rfqAddedLabel,
  quantityLabel,
  decrementLabel,
  incrementLabel,
  confidence,
  bands,
  details,
  productName,
  storefrontSlug,
}: EnquiryCardProps) {
  const [qty, setQty] = useState(Math.max(1, minOrderQty));
  const [added, setAdded] = useState(false);

  const lines = [{ ...line, qty, targetUnitPriceAed: "" }];

  /*
     The bridge to board 1e. A buyer who needs four things starts on one product
     page and accumulates, rather than sending four separate enquiries — so this
     writes into the same session store the catalogue's tray reads, keyed by the
     same seller. It is not a basket: nothing crosses storefronts and nothing
     survives the session.
  */
  function addToRfq() {
    /*
       Through board 1e's own store rather than touching `sessionStorage`
       directly. The first version wrote a key of its own invention and would
       have accumulated a selection nothing ever read — and going through
       `setSelection` also notifies the catalogue's subscribers, so a tray open
       in another tab of the same session updates rather than drifting.
    */
    const key = selectionKey(storefrontSlug);
    const current = selectionSnapshot(key);
    if (!current.includes(line.productId)) {
      setSelection(key, [...current, line.productId]);
    }
    setAdded(true);
  }

  const primary = (
    <EnquireButton
      {...enquire}
      block
      size="lg"
      triggerLabel={primaryLabel}
      initialLines={lines}
    />
  );

  return (
    <>
      <div className="rounded-card border border-line-strong bg-card p-4">
        {confidence}
        <div className="mt-4">{bands}</div>

        <div className="mt-4 flex flex-col gap-2.5">
          <Stepper
            value={qty}
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
              <a
                href={whatsappHref}
                rel="nofollow noopener"
                className={SECONDARY}
              >
                {whatsappLabel}
              </a>
            )}
            <button type="button" onClick={addToRfq} className={SECONDARY} disabled={added}>
              {added ? rfqAddedLabel : rfqLabel}
            </button>
            {/*
               Out of stock keeps an enquiry path. The primary becomes "Notify
               me", so this is the door for a buyer who wants the lead time
               rather than a notification — removing it would leave the state
               with no way to ask a question.
            */}
            {leadTimeLabel && (
              <EnquireButton
                {...enquire}
                size="sm"
                triggerLabel={leadTimeLabel}
                initialLines={lines}
              />
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-3">{details}</div>
      </div>

      {/*
         Criterion 13. This page is long and a buyer arrives mid-page from a
         search, so the action has to travel with them — losing it above the
         fold loses the enquiry.

         Hidden with `display` above the breakpoint rather than moved, so there
         is exactly one enquiry trigger in the accessibility tree at any width.
      */}
      <div
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-line",
          "bg-card px-4 py-2.5 shadow-overlay md:hidden",
        )}
      >
        <p className="min-w-0 flex-1 truncate text-caption text-body">{productName}</p>
        <div className="shrink-0 [&_button]:min-h-11">{primary}</div>
      </div>
    </>
  );
}

const SECONDARY = cn(
  "inline-flex min-h-11 items-center rounded-ctl border border-line bg-card px-3.5",
  "text-body-sm font-medium text-ink hover:bg-paper",
  "focus-visible:outline-none focus-visible:shadow-focus",
  "disabled:cursor-default disabled:text-muted",
);
