"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Label } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { sendInvoice } from "./actions";

/**
 * The two controls in the page header: send, and download.
 *
 * The send button **names the address**. The board's version read `Email to
 * accounts` against nobody in particular, which is a button whose consequence
 * the reader cannot see — and on a document that goes to somebody's accountant
 * that is the wrong place to be vague.
 *
 * Spec Q6 gives the second path: a one-off address that does not change where
 * the next invoice goes. It is disclosed rather than offered up front, because
 * the default is right almost every time and a form beside a button invites
 * typing into it.
 *
 * Every label arrives from `t()` at module scope on the client, which this file
 * may do — it is the *function* boundary that the repo's most repeated defect
 * lives on, not the catalogue.
 */
export interface EmailInvoiceProps {
  invoiceId: string;
  /** Null when there is no billing address to send to. */
  address: string | null;
  /** Already resolved — names the address, or says there is none. */
  sendLabel: string;
  downloadLabel: string;
  /** Null when no PDF was stored, so nothing offers a download. */
  downloadHref: string | null;
}

export function EmailInvoice({
  invoiceId,
  address,
  sendLabel,
  downloadLabel,
  downloadHref,
}: EmailInvoiceProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [other, setOther] = useState<string | null>(null);

  const send = (to: string | null) => {
    setNote(null);
    const form = new FormData();
    form.set("invoiceId", invoiceId);
    if (to !== null) form.set("to", to);

    startTransition(async () => {
      const result = await sendInvoice(form);
      if (result.ok) {
        setNote({ ok: true, text: result.message });
        setOther(null);
        router.refresh();
      } else {
        setNote({ ok: false, text: result.error });
      }
    });
  };

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={pending || !address}
          onClick={() => send(null)}
        >
          {sendLabel}
        </Button>

        {downloadHref ? (
          <a
            href={downloadHref}
            className="inline-flex h-8 items-center rounded-ctl bg-moss px-3 text-caption font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
          >
            {downloadLabel}
          </a>
        ) : (
          /*
             No stored file, no download. Not a disabled button that looks like
             one: the rail says why, and a control that cannot ever work on this
             invoice should not be on it.
          */
          <span className="text-caption text-muted">{downloadLabel}</span>
        )}
      </div>

      {address && other === null && (
        <button
          type="button"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          onClick={() => setOther("")}
        >
          {t("invoice.email_other")}
        </button>
      )}

      {other !== null && (
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="invoice-other-address">{t("invoice.email_other_label")}</Label>
            <Input
              id="invoice-other-address"
              type="email"
              value={other}
              autoFocus
              disabled={pending}
              onChange={(event) => setOther(event.target.value)}
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || other.trim().length === 0}
            onClick={() => send(other)}
          >
            {t("invoice.email_send")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setOther(null)}>
            {t("invoice.email_cancel")}
          </Button>
        </div>
      )}

      {note && (
        <p
          role={note.ok ? "status" : "alert"}
          className={note.ok ? "text-caption text-ok-ink" : "text-caption text-bad-ink"}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}
