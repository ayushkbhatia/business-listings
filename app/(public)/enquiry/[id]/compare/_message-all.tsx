"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/display/Alert";
import { Button, Label, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure/Modal";
import type { MessageAllState } from "./actions";

/**
 * Board `1n` — *Message all*.
 *
 * One message, written once and posted into each supplier's own thread — the
 * dialog says so before anything is sent, and names who it goes to, because a
 * buyer writing to five suppliers at once should know it is five threads and
 * not one room.
 *
 * The text is held in state rather than left to the form: a server action
 * resets an uncontrolled field when it returns, and a refusal (too long, sent a
 * moment ago) must not cost the buyer what they wrote (`7b`'s trap). On success
 * the dialog closes and the page says how many it reached, politely.
 */
export interface MessageAllWords {
  button: string;
  title: string;
  description: string;
  label: string;
  hint: string;
  recipients: string;
  send: string;
  cancel: string;
  close: string;
  counter: string;
}

export function MessageAll({
  words,
  enquiryId,
  token,
  max,
  action,
}: {
  words: MessageAllWords;
  enquiryId: string;
  token: string | null;
  max: number;
  /** The server action. Absent in the gallery, where nothing posts. */
  action?: (state: MessageAllState, formData: FormData) => Promise<MessageAllState>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [state, formAction] = useActionState<MessageAllState, FormData>(async (current, formData) => {
    if (!action) return current;
    const next = await action(current, formData);
    // Sent: the dialog closes and the page says how many it reached. Refused:
    // the dialog stays open with the words the buyer wrote.
    if (next.status === "sent") {
      setOpen(false);
      setBody("");
    }
    return next;
  }, { status: "idle" });
  const fieldId = useId();

  return (
    <div className="flex flex-col items-end gap-2">
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {words.button}
      </Button>
      {state.status === "sent" ? (
        <div className="w-full max-w-md">
          <Alert tone="ok" live="polite">
            {state.message}
          </Alert>
        </div>
      ) : null}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={words.title}
        description={words.description}
        closeLabel={words.close}
      >
        {action ? (
          <form action={formAction} className="space-y-3">
            <Fields
              words={words}
              fieldId={fieldId}
              body={body}
              setBody={setBody}
              max={max}
              enquiryId={enquiryId}
              token={token}
              error={state.status === "error" ? state.message : null}
            />
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {words.cancel}
              </Button>
              <Send label={words.send} disabled={body.trim().length === 0 || body.length > max} />
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <Fields words={words} fieldId={fieldId} body={body} setBody={setBody} max={max} enquiryId={enquiryId} token={token} error={null} />
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                {words.cancel}
              </Button>
              <Button disabled>{words.send}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Fields({
  words,
  fieldId,
  body,
  setBody,
  max,
  enquiryId,
  token,
  error,
}: {
  words: MessageAllWords;
  fieldId: string;
  body: string;
  setBody: (value: string) => void;
  max: number;
  enquiryId: string;
  token: string | null;
  error: string | null;
}) {
  return (
    <>
      <input type="hidden" name="enquiryId" value={enquiryId} />
      {token ? <input type="hidden" name="token" value={token} /> : null}
      <p className="text-body-sm text-body">{words.recipients}</p>
      <Label htmlFor={fieldId} hint={words.hint}>
        {words.label}
      </Label>
      <Textarea
        id={fieldId}
        name="body"
        rows={5}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        limit={max}
        counterLabel={(used, limit) => words.counter.replace("{used}", String(used)).replace("{limit}", String(limit))}
      />
      {error ? (
        <Alert tone="bad" live="assertive" fix={words.hint}>
          {error}
        </Alert>
      ) : null}
    </>
  );
}

function Send({ label, disabled }: { label: string; disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={disabled}>
      {label}
    </Button>
  );
}
