"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { formatPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { RevealSurface } from "@/lib/audit/contact-reveal";
import { revealContact } from "./reveal-actions";

/**
 * The WhatsApp number on a result row, behind one click.
 *
 * The storefront's `ContactCard` does this for one supplier; a results page
 * does it twenty at a time, which changes the stakes rather than the mechanism.
 * A number printed straight into the markup is twenty numbers a scraper takes
 * in one request. Behind a click it is twenty clicks, each of them a
 * `ContactReveal` row naming the business — and that count is the number a
 * seller's subscription is ultimately judged on, so making it real matters as
 * much as the privacy does.
 *
 * The reveal never blocks on the write. A failed insert loses a statistic;
 * refusing to show a published phone number over a statistic would be absurd,
 * which is the same call `ContactCard` makes.
 *
 * Nothing is rendered at all where a seller has published no number. A button
 * that reveals nothing is worse than no button.
 */
export function RevealWhatsApp({
  businessId,
  whatsapp,
  surface,
}: {
  businessId: string;
  whatsapp: string | null;
  /** Where the reveal happened, for the record. A closed set, never a path. */
  surface: RevealSurface;
}) {
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!whatsapp) return null;

  if (revealed) {
    return (
      <a
        href={`https://wa.me/${whatsapp.replace(/[^\d]/g, "")}`}
        rel="noopener noreferrer"
        target="_blank"
        className="flex-1 rounded-ctl border border-line-strong bg-card px-2 py-1.5 text-center font-mono text-caption tabular-nums text-ink hover:bg-fill focus-visible:outline-none focus-visible:shadow-focus"
      >
        {formatPhone(whatsapp)}
      </a>
    );
  }

  return (
    <span className="flex-1">
      <Button
        size="sm"
        variant="secondary"
        block
        loading={pending}
        onClick={() => {
          setRevealed(true);
          startTransition(async () => {
            await revealContact({ businessId, channel: "whatsapp", surface });
          });
        }}
      >
        {t("storefront.whatsapp")}
      </Button>
    </span>
  );
}
