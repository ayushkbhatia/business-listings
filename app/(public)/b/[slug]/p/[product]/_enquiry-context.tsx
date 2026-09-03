"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { EnquireDrawer, type EnquireProps } from "../../EnquireDrawer";
import type { EnquiryLineDraft } from "@/components/domain";

/**
 * One composer for the whole page, however many things open it.
 *
 * Board 1g puts four triggers on this page — the enquiry card's primary, the
 * sticky bar's on a phone, "enquire about lead time" when there is none in
 * stock, and the one-click spec request. The first build gave each of them an
 * `EnquireButton`, and each of those renders its own `EnquireDrawer`: three
 * forms in the DOM with the same field labels, so "Item on line 1" resolved to
 * three inputs and a screen reader was offered three identical composers.
 *
 * That is board 1d's defect arriving by a different route — it found two
 * composers on the storefront and removed one, for the same reason. Every
 * trigger here is an enquiry to the same seller about the same product; only
 * the requirement seed differs, so the seed is what a trigger sets.
 *
 * A context rather than props, because the triggers are in three different
 * sections of the page and two of them are rendered by the server component
 * between them.
 */

interface EnquiryControls {
  /** Opens the one composer, seeding the free-text box. */
  open: (seed: string) => void;
}

const Ctx = createContext<EnquiryControls | null>(null);

export function useEnquiry(): EnquiryControls {
  const value = useContext(Ctx);
  if (!value) throw new Error("useEnquiry must be used inside ProductEnquiryProvider");
  return value;
}

export function ProductEnquiryProvider({
  enquire,
  line,
  defaultSeed,
  children,
}: {
  /** Everything except the lines and the seed, which the triggers decide. */
  enquire: Omit<EnquireProps, "initialLines" | "initialRequirementSeed">;
  /** The product, as a line. Quantity is set by the card's stepper. */
  line: Omit<EnquiryLineDraft, "qty">;
  defaultSeed: string;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [seed, setSeed] = useState(defaultSeed);
  const [qty, setQty] = useState(1);

  const open = useCallback((next: string) => {
    setSeed(next);
    setIsOpen(true);
  }, []);

  const controls = useMemo<EnquiryControls>(() => ({ open }), [open]);

  return (
    <Ctx.Provider value={controls}>
      <QtyCtx.Provider value={useMemo(() => ({ qty, setQty }), [qty])}>
        {children}
        <EnquireDrawer
          {...enquire}
          open={isOpen}
          onClose={() => setIsOpen(false)}
          initialRequirementSeed={seed}
          initialLines={[{ ...line, qty }]}
        />
      </QtyCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * The quantity, shared between the stepper and the composer.
 *
 * Separate from the open/seed controls because the stepper writes it and the
 * drawer reads it, and neither needs to re-render when the other changes for a
 * different reason.
 */
const QtyCtx = createContext<{ qty: number; setQty: (n: number) => void } | null>(null);

export function useQuantity() {
  const value = useContext(QtyCtx);
  if (!value) throw new Error("useQuantity must be used inside ProductEnquiryProvider");
  return value;
}
