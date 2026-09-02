"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { Card } from "@/components/structure";
import { formatPhone, maskPhone } from "@/lib/format";
import { t } from "@/lib/i18n";
import { revealContact } from "./actions";

/**
 * The supplier's number, masked until asked for.
 *
 * Board 10j. This is the other direction from rule 1 — a supplier's number is
 * theirs to publish and we do publish it; the mask exists so that asking for it
 * is an event we can count. That count is what tells a seller the directory
 * delivered them something, and it is the number their subscription is
 * ultimately judged on.
 *
 * So the reveal is recorded before the digits appear, and it never blocks: a
 * failed write loses a statistic, and refusing to show a published phone number
 * over a statistic would be absurd.
 */
export function ContactCard({
  businessId,
  businessSlug,
  phone,
  whatsapp,
  enquire,
  layout = "card",
  saveAction,
}: {
  businessId: string;
  businessSlug: string;
  phone: string | null;
  whatsapp: string | null;
  /** The composer's trigger, rendered by the server page. */
  enquire: React.ReactNode;
  /**
   * `card` in a rail, `row` in board 1d's identity block.
   *
   * One component rather than two because the thing that must not be
   * duplicated is the reveal: it writes the event that proves the platform
   * delivered the enquiry, and a second implementation is a second chance to
   * forget the write. Only the arrangement differs.
   */
  layout?: "card" | "row";
  /** The save control, rendered by the caller. Row layout only. */
  saveAction?: React.ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);
  const [pending, startTransition] = useTransition();

  function reveal(channel: "phone" | "whatsapp") {
    setRevealed(true);
    startTransition(async () => {
      await revealContact({ businessId, channel, surface: `/b/${businessSlug}` });
    });
  }

  if (layout === "row") {
    /*
       Board 1d's identity actions, in the order the board sets: the quote
       first because it is what the page is for, then the two channels, then
       save. The number renders masked and stays masked until asked for — the
       reveal is the same call either way.
    */
    return (
      <div className="flex flex-wrap items-center gap-2">
        {enquire}

        {whatsapp && (
          <Button
            size="md"
            variant="secondary"
            loading={pending}
            onClick={() => reveal("whatsapp")}
          >
            {revealed ? formatPhone(whatsapp) : t("storefront.whatsapp")}
          </Button>
        )}

        {phone && (
          <Button size="md" variant="secondary" loading={pending} onClick={() => reveal("phone")}>
            <span className="font-mono">{revealed ? formatPhone(phone) : maskPhone(phone)}</span>
          </Button>
        )}

        {saveAction}
      </div>
    );
  }

  return (
    <Card>
      <p className="text-caption text-muted">{t("storefront.phone")}</p>
      <p className="mt-0.5 font-mono text-body text-ink">
        {phone ? (revealed ? formatPhone(phone) : maskPhone(phone)) : t("table.not_provided")}
      </p>

      {phone && !revealed ? (
        <div className="mt-2">
          <Button size="sm" variant="secondary" block loading={pending} onClick={() => reveal("phone")}>
            {t("storefront.reveal")}
          </Button>
        </div>
      ) : null}

      {revealed && whatsapp ? (
        <p className="mt-1 font-mono text-caption text-muted">{formatPhone(whatsapp)}</p>
      ) : null}

      <div className="mt-2">
        {enquire}
      </div>

      <p className="mt-2 text-caption text-faint">{t("storefront.enquiry_note")}</p>
    </Card>
  );
}
