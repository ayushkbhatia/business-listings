"use client";

import { buttonClassName } from "@/components/primitives";

/**
 * Board `10d`'s *Export as PDF*, and `Q3`'s answer.
 *
 * The browser's print dialog, which saves a PDF in every browser a buyer uses,
 * over a print stylesheet written on the page itself: no nav, no tray, no
 * buttons, the table at full width with its tint kept. Nothing else on the
 * platform generates a PDF except `11g`'s tax invoice, which is a legal record
 * written once and stored — a comparison is neither, so it gets no document
 * pipeline, no dependency and no file on a server.
 *
 * The label says what happens — *Print or save as PDF* — rather than promising
 * an export the browser, not the site, performs.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" onClick={() => window.print()} className={buttonClassName({ variant: "secondary" })}>
      {label}
    </button>
  );
}
