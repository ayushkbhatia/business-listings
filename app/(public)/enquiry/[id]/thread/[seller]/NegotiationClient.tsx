"use client";

import { useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Thread, type ThreadChip, type ThreadMessageView } from "@/components/domain";
import { Button, buttonClassName } from "@/components/primitives";
import { Alert } from "@/components/display/Alert";
import { Modal } from "@/components/structure/Modal";
import { threadLabels } from "@/lib/messaging/negotiation-words";
import { MAX_THREAD_ATTACHMENTS, THREAD_ATTACHMENT_TYPES } from "@/lib/messaging/attachments";
import { t } from "@/lib/i18n";
import { acceptQuoteAction } from "../../../actions";
import { sendBuyerMessage, signBuyerAttachment } from "../../../thread-actions";

/**
 * Board `10h` — the buyer's side of one thread, where it moves.
 *
 * Everything drawn here arrives worded from the server; this owns only what a
 * person does: write, attach, send, and accept. Accepting opens a dialog that
 * states the whole of what it does before the button that does it — `7c`'s three
 * consequences, the names of the suppliers it declines, and that no payment is
 * taken — and posts the same action the comparison posts (`B6`).
 */

export type AcceptControl =
  | {
      kind: "offer";
      quoteId: string;
      revision: number;
      /** `Accept r2 — AED 14,600`. */
      buttonLabel: string;
      /** The sentence under the composer. */
      footnote: string;
      dialog: {
        title: string;
        description: string;
        facts: string[];
        /** Requirement lines this revision leaves unpriced, said before accepting it. */
        warning: string | null;
        confirm: string;
      };
    }
  /** Board `7b`: a company enquiry is accepted on the accept screen, under the company's rule. */
  | { kind: "company"; href: string; buttonLabel: string; footnote: string }
  | { kind: "expired"; buttonLabel: string; footnote: string }
  | { kind: "record"; href: string; label: string }
  | { kind: "none" };

export interface BuyerNegotiationProps {
  enquiryId: string;
  businessId: string;
  supplierSlug: string;
  supplierName: string;
  token: string | null;
  messages: readonly ThreadMessageView[];
  readOnly: boolean;
  /** The notice above the log: accepted, declined, closed. Already worded. */
  notice: { tone: "ok" | "neutral"; text: string; action?: { href: string; label: string } } | null;
  accept: AcceptControl;
  /** Extra chips ahead of the three the board draws — *ask for a new revision* on an expired one. */
  leadingChips?: readonly ThreadChip[];
  /** An accept that came back refused, already worded. */
  acceptError: string | null;
  /** Off in the gallery, which renders states rather than a live thread. */
  live?: boolean;
  /**
   * Appended to the composer's landmark name. The gallery draws several states
   * of one supplier's thread, and two forms named alike are two landmarks a
   * screen reader cannot tell apart.
   */
  specimen?: string;
}

export function BuyerNegotiation({
  enquiryId,
  businessId,
  supplierSlug,
  supplierName,
  token,
  messages,
  readOnly,
  notice,
  accept,
  leadingChips = [],
  acceptError,
  live = true,
  specimen,
}: BuyerNegotiationProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

  const labels = threadLabels(
    {
      logLabel: t("negotiation.log", { supplier: supplierName }),
      formLabel: [t("negotiation.form", { supplier: supplierName }), specimen].filter(Boolean).join(" · "),
    },
    "buyer",
  );

  return (
    <>
      <Thread
        fill
        messages={messages}
        labels={labels}
        readOnly={readOnly}
        busy={pending}
        /*
           A refused send, or an accept that came back refused. Both belong
           beside the control that was pressed, and the accept's words already
           say what to do instead.
        */
        {...(error || acceptError ? { error: error ?? acceptError ?? "" } : {})}
        notice={
          notice ? (
            <div className="space-y-2">
              {notice ? (
                <Alert
                  tone={notice.tone}
                  action={
                    notice.action ? (
                      <a href={notice.action.href} className={buttonClassName({ variant: "secondary", size: "sm" })}>
                        {notice.action.label}
                      </a>
                    ) : undefined
                  }
                >
                  {notice.text}
                </Alert>
              ) : null}
            </div>
          ) : undefined
        }
        quickReplies={[
          ...leadingChips,
          { label: t("thread.chip.validity"), text: t("thread.chip.validity_text") },
          { label: t("thread.chip.datasheets"), text: t("thread.chip.datasheets_text") },
          { label: t("thread.chip.credit"), text: t("thread.chip.credit_text") },
        ]}
        upload={{
          label: t("negotiation.attach.button"),
          hint: t("negotiation.attach.hint", { supplier: supplierName }),
          accept: THREAD_ATTACHMENT_TYPES.join(","),
          maxFiles: MAX_THREAD_ATTACHMENTS,
          uploadingLabel: t("negotiation.attach.uploading"),
          removeLabel: (name) => t("negotiation.attach.remove", { name }),
          tooManyLabel: t("negotiation.attach.too_many"),
          upload: async (file) => {
            if (!live) return { ok: false, error: t("negotiation.attach.error_unavailable") };
            const signed = await signBuyerAttachment({
              enquiryId,
              businessId,
              filename: file.name,
              type: file.type,
              bytes: file.size,
              token,
            });
            if (!signed.ok) return signed;
            try {
              const response = await fetch(signed.url, {
                method: "PUT",
                headers: { "content-type": file.type },
                body: file,
              });
              return response.ok
                ? { ok: true, path: signed.path }
                : { ok: false, error: t("negotiation.attach.error_unavailable") };
            } catch {
              return { ok: false, error: t("negotiation.attach.error_unavailable") };
            }
          },
        }}
        onSend={async (body, attachments) => {
          if (!live) return false;
          setError(undefined);
          const result = await new Promise<Awaited<ReturnType<typeof sendBuyerMessage>>>((resolve) => {
            startTransition(async () => {
              resolve(await sendBuyerMessage({ enquiryId, businessId, body, attachments, token }));
            });
          });
          if (!result.ok) {
            setError(result.error);
            return false;
          }
          router.refresh();
          return true;
        }}
        actions={
          accept.kind === "offer" ? (
            <Button size="lg" onClick={() => setConfirming(true)}>
              {accept.buttonLabel}
            </Button>
          ) : accept.kind === "expired" ? (
            <Button size="lg" disabled aria-describedby="accept-expired">
              {accept.buttonLabel}
            </Button>
          ) : accept.kind === "company" ? (
            <a href={accept.href} className={buttonClassName({ size: "lg" })}>
              {accept.buttonLabel}
            </a>
          ) : accept.kind === "record" ? (
            <a href={accept.href} className={buttonClassName({ size: "lg" })}>
              {accept.label}
            </a>
          ) : null
        }
        footnote={
          accept.kind === "offer" || accept.kind === "company" ? (
            <p>{accept.footnote}</p>
          ) : accept.kind === "expired" ? (
            <p id="accept-expired" className="text-bad-ink">
              {accept.footnote}
            </p>
          ) : null
        }
      />

      {accept.kind === "offer" ? (
        <Modal
          open={confirming}
          onClose={() => setConfirming(false)}
          title={accept.dialog.title}
          description={accept.dialog.description}
          closeLabel={t("negotiation.accept.close")}
          footer={
            /*
               A form only where it can post. The gallery draws this dialog in
               several states with nothing to post to, and a page of unnamed
               forms is a page of indistinguishable landmarks.
            */
            <AcceptForm live={live} className="flex items-center justify-end gap-2">
              <input type="hidden" name="quoteId" value={accept.quoteId} />
              <input type="hidden" name="enquiryId" value={enquiryId} />
              <input type="hidden" name="from" value={`thread:${supplierSlug}`} />
              {token ? <input type="hidden" name="token" value={token} /> : null}
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                {t("negotiation.accept.cancel")}
              </Button>
              <ConfirmAccept label={accept.dialog.confirm} live={live} />
            </AcceptForm>
          }
        >
          <div className="space-y-3">
            {accept.dialog.warning ? (
              <Alert tone="warn" fix={t("negotiation.accept.unaccepted_fix")}>
                {accept.dialog.warning}
              </Alert>
            ) : null}
            <ul className="list-disc space-y-1.5 pl-5 text-body-sm text-body">
              {accept.dialog.facts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function AcceptForm({ live, className, children }: { live: boolean; className: string; children: React.ReactNode }) {
  return live ? (
    <form action={acceptQuoteAction} className={className}>
      {children}
    </form>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** The confirm repeats the verb, and holds itself while the accept is in flight. */
function ConfirmAccept({ label, live }: { label: string; live: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending} disabled={!live}>
      {label}
    </Button>
  );
}
