"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@/components/primitives";
import { BUYER_REFERENCE_MAX } from "@/lib/enquiry/accepted-record";
import { t } from "@/lib/i18n";
import { saveReferenceAction } from "./actions";
import { IDLE, type RecordFormState } from "./_state";

/**
 * Board `7c` — *"your PO-2026-0418"*, and the control that puts it there.
 *
 * The board draws the reference in the header summary as a fact the record
 * already holds. Nothing wrote it, so this is the writer: closed, it reads as
 * the fact (or an offer to add one); open, it is one field and two buttons.
 *
 * The editor is keyed on each opening, so a refusal from the last attempt is
 * not waiting in the field the next time the buyer opens it.
 */
export function ReferenceForm({
  enquiryId,
  token,
  current,
}: {
  enquiryId: string;
  token: string | null;
  current: string | null;
}) {
  const [opening, setOpening] = useState(0);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const openerId = useId();
  // Set when the editor closes, so focus goes back to the control that opened
  // it rather than to the top of the document.
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      document.getElementById(openerId)?.focus();
    }
  }, [editing, openerId]);

  const close = (message: string | null) => {
    returnFocus.current = true;
    setSaved(message);
    setEditing(false);
  };

  if (editing) {
    return (
      <ReferenceEditor
        key={opening}
        enquiryId={enquiryId}
        token={token}
        initial={current ?? ""}
        onDone={close}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {current ? (
        <span className="text-body-sm text-body">
          {t("accepted.reference.label")} <span className="font-mono text-ink">{current}</span>
        </span>
      ) : null}
      <Button
        id={openerId}
        variant="link"
        type="button"
        onClick={() => {
          setSaved(null);
          setOpening((n) => n + 1);
          setEditing(true);
        }}
      >
        {current ? t("accepted.reference.change") : t("accepted.reference.add")}
      </Button>
      <span role="status" className="text-caption text-ok-ink">
        {saved ?? ""}
      </span>
    </div>
  );
}

function ReferenceEditor({
  enquiryId,
  token,
  initial,
  onDone,
}: {
  enquiryId: string;
  token: string | null;
  initial: string;
  onDone: (message: string | null) => void;
}) {
  /*
     Controlled, deliberately. A form action resets an uncontrolled form once it
     settles, and a refusal that also wiped what the buyer typed would make them
     type it again to find out what was wrong with it.
  */
  const [value, setValue] = useState(initial);
  const [state, action, pending] = useActionState(
    async (previous: RecordFormState, formData: FormData) => {
      const next = await saveReferenceAction(previous, formData);
      if (next.status === "saved") onDone(next.message);
      return next;
    },
    IDLE,
  );
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const failed = state.status === "error";

  return (
    <form action={action} className="mt-1 flex max-w-md flex-col gap-2">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      {token ? <input type="hidden" name="t" value={token} /> : null}
      <label htmlFor={inputId} className="text-body-sm text-ink">
        {t("accepted.reference.input")}
      </label>
      <Input
        // Opened by the buyer's own press, so moving focus into it is expected.
        autoFocus
        id={inputId}
        name="reference"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        mono
        aria-describedby={failed ? `${hintId} ${errorId}` : hintId}
        invalid={failed}
        onKeyDown={(event) => {
          if (event.key === "Escape") onDone(null);
        }}
      />
      <p id={hintId} className="text-caption text-muted">
        {t("accepted.reference.hint", { max: BUYER_REFERENCE_MAX })}
      </p>
      {failed ? (
        // A failed save is the one live region here that interrupts.
        <p id={errorId} role="alert" className="text-caption text-bad-ink">
          {state.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>
          {pending ? t("accepted.reference.saving") : t("accepted.reference.save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onDone(null)}>
          {t("accepted.reference.cancel")}
        </Button>
      </div>
    </form>
  );
}
