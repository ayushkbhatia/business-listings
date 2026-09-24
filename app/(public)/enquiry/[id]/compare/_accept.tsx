"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal, useFormStatus } from "react-dom";
import { Alert } from "@/components/display/Alert";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure/Modal";

/**
 * Board `1n` — *Accept → confirm sheet → result state*.
 *
 * Accept is on every quoted row (`B4`), so nothing about the row's position is
 * a recommendation; what makes the click safe is this sheet, which states the
 * whole of what accepting does before the button that does it. The words
 * arrive from the server, already worded — the same facts `10h`'s dialog lists,
 * so accepting from the comparison and from a thread say the same thing (`10h`
 * B6) — and the form posts the same action.
 *
 * The result state is the server's: the action lands on the accepted record, or
 * back here with a refusal said in words.
 */
export interface AcceptSheet {
  title: string;
  description: string;
  facts: string[];
  /** Lines this quote leaves unpriced, said before accepting it. */
  warning: string | null;
  warningFix: string | null;
  confirm: string;
  cancel: string;
  close: string;
}

export function AcceptQuote({
  label,
  accessibleName,
  sheet,
  quoteId,
  enquiryId,
  token,
  action,
  primary,
}: {
  /** What the button says: `Accept`. */
  label: string;
  /** What it does, for somebody who cannot see which row it sits in. */
  accessibleName: string;
  sheet: AcceptSheet;
  quoteId: string;
  enquiryId: string;
  token: string | null;
  /** The accept server action. Absent in the gallery, where nothing posts. */
  action?: (formData: FormData) => Promise<void>;
  primary: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Client-side only, without an effect: the sheet mounts once there is a body to portal into.
  const client = useSyncExternalStore(subscribeNothing, () => true, () => false);

  /*
     Portalled to the body. The button sits in a table cell inside a frame that
     scrolls sideways on a phone, and a dialog left inside it — top layer or not
     — has its scroll-into-view spent on that frame: the footer's buttons could
     not be reached at 412px. The dialog is the page's, not the cell's.
  */
  const dialog = (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={sheet.title}
      description={sheet.description}
      closeLabel={sheet.close}
      footer={
        /*
           A form only where it can post. The gallery draws the sheet with
           nothing to post to, and a page of unnamed forms is a page of
           landmarks nobody can tell apart.
        */
        action ? (
          <form action={action} className="flex flex-wrap items-center justify-end gap-2">
            <input type="hidden" name="quoteId" value={quoteId} />
            <input type="hidden" name="enquiryId" value={enquiryId} />
            <input type="hidden" name="from" value="compare" />
            {token ? <input type="hidden" name="token" value={token} /> : null}
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {sheet.cancel}
            </Button>
            <Confirm label={sheet.confirm} />
          </form>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {sheet.cancel}
            </Button>
            <Button disabled>{sheet.confirm}</Button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        {sheet.warning ? (
          <Alert tone="warn" live="off" fix={sheet.warningFix ?? undefined}>
            {sheet.warning}
          </Alert>
        ) : null}
        <ul className="list-disc space-y-1.5 pl-5 text-body-sm text-body">
          {sheet.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </div>
    </Modal>
  );

  return (
    <>
      <Button size="sm" variant={primary ? "primary" : "secondary"} aria-label={accessibleName} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {client ? createPortal(dialog, document.body) : null}
    </>
  );
}

const subscribeNothing = () => () => {};

/** Repeats the verb, and holds itself while the accept is in flight. */
function Confirm({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}
