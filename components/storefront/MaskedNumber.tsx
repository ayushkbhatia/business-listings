"use client";

import { createContext, useContext } from "react";
import type { LandlineNumber } from "@/lib/contact/lead-form";
import { t } from "@/lib/i18n";

/**
 * Board `1d` amendment — the reveal's state, as far as a number on the page
 * needs to know it.
 *
 * The provider is `ContactReveal` in `app/(public)/b/[slug]`, which owns the
 * dialog and the server actions. This file holds only what a storefront section
 * reads, so `components/storefront` does not import from a route.
 */

export interface RevealApi {
  numbers: Record<string, LandlineNumber> | null;
  headLocationId: string | null;
  pending: boolean;
  /** Ask for the numbers. `from` is where focus goes back to if the dialog is dismissed. */
  request: (from: HTMLElement | null) => void;
  /** The id the revealed head chip carries, so focus can land on it after the dialog. */
  focusId: string;
  note: string;
  whatsAppOpened: () => void;
}

export const RevealContext = createContext<RevealApi | null>(null);

export { teamNumberKey } from "@/lib/contact/number-keys";

/**
 * One masked number — a branch's landline, a team member's line — revealed
 * with the listing's.
 *
 * Masked until the listing is revealed, then the number as a `tel:` link.
 * Clicking the mask opens the same form as the identity block's chip, and one
 * answer reveals every number on the listing for the session.
 *
 * Outside a provider — a template page, the builder's preview — it is the mask
 * and nothing else: a number with no reveal behind it stays hidden rather than
 * printing.
 */
export function MaskedNumber({
  numberKey,
  masked,
  className = "font-mono tabular-nums",
}: {
  numberKey: string;
  masked: string;
  className?: string;
}) {
  const reveal = useContext(RevealContext);
  const number = reveal?.numbers?.[numberKey];

  if (number) {
    return (
      <a href={`tel:${number.tel}`} className={`${className} hover:underline`}>
        {number.display}
      </a>
    );
  }
  if (!reveal) return <span className={className}>{masked}</span>;
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t("contact.masked_label", { masked })}
      disabled={reveal.pending}
      onClick={(event) => reveal.request(event.currentTarget)}
      className={`${className} rounded-ctl text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink focus-visible:outline-none focus-visible:shadow-focus disabled:text-muted`}
    >
      {masked}
    </button>
  );
}
