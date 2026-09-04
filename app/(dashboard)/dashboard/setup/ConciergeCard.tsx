"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, FileDrop, Textarea, type FileDropState } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ConciergeResult, RecordResult, SignResult } from "./concierge-actions";

/**
 * Board 8a's right rail — "send us your catalogue".
 *
 * The seller's alternative to keying fifty products in themselves, which is the
 * task on this hub that takes twenty-five minutes and is the one most of them
 * stop at. Everything here is one of three states: an offer with a price, a
 * request in flight, or the result of the last one.
 *
 * **Not offered is not a state this component renders.** The caller reads
 * `offered` from `conciergeOfferFor` and omits the card entirely — a panel
 * saying a seller cannot have something is an advert, and the plan comparison
 * on `/dashboard/billing` is where that argument belongs.
 *
 * Every number arrives already formatted. A client component that formats a
 * date or a count renders one string on the server and another in the browser,
 * and React 418 is the last place anybody wants to learn that — so `fee`,
 * `limit` and every date are strings by the time they get here.
 */

export type ConciergeStatus = "requested" | "in_progress" | "loaded";

export interface ConciergeRequestView {
  id: string;
  status: ConciergeStatus;
  /** Formatted in Asia/Dubai by the caller. */
  requestedOn: string;
  dueOn: string;
  loadedOn: string;
  /** The raw count, for the plural rule only. */
  productsLoaded: number;
  /** The same count, through `formatCount`. What is rendered. */
  productsLoadedFormatted: string;
}

export interface ConciergeCardProps {
  planName: string;
  /** True where the plan includes the work. Chooses which sentence is shown. */
  free: boolean;
  /** Whole dirhams through `formatCount` — "250". Unread when `free`. */
  feeFormatted: string;
  /** How many products we promise to key in, through `formatCount`. */
  productLimitFormatted: string;
  /** The upload ceiling in megabytes, as a string — "20". */
  megabytes: string;
  /** The `accept` attribute, from `CATALOGUE_ACCEPT`. */
  accept: string;
  /** The last request that was not withdrawn, or null. */
  request: ConciergeRequestView | null;
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  sendAction: (formData: FormData) => Promise<ConciergeResult>;
  cancelAction: (formData: FormData) => Promise<ConciergeResult>;
}

export function ConciergeCard({
  planName,
  free,
  feeFormatted,
  productLimitFormatted,
  megabytes,
  accept,
  request,
  signAction,
  recordAction,
  sendAction,
  cancelAction,
}: ConciergeCardProps) {
  const router = useRouter();
  const [drop, setDrop] = useState<FileDropState>("idle");
  const [filename, setFilename] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"sent" | "cancelled" | null>(null);
  /*
     The form is behind the button, not beside it.

     Board 8a's render draws this card as two sentences and one control. The
     first build put a file drop and a note field in the rail at rest, which is
     three form fields on a panel a seller is not there to fill in — the offer
     has to be readable before it is answerable, and the button is the sentence
     that says it can be.
  */
  const [open, setOpen] = useState(false);
  const [busy, startTransition] = useTransition();

  const fileHint = t("concierge.file_hint", { mb: megabytes });

  /**
   * Sign, PUT, then record. The `Document` row is written last so a failed
   * upload leaves nothing behind, and the id it returns is what the submit
   * below sends — the browser never names a document the server has not just
   * created for this seat.
   */
  async function upload(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setDrop("uploading");
    setFilename(file.name);

    const signForm = new FormData();
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));

    const signed = await signAction(signForm);
    if (!signed.ok) {
      setError(signed.error);
      setDrop("error");
      return;
    }

    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) {
      setError(t("concierge.error.upload_failed"));
      setDrop("error");
      return;
    }

    const recordForm = new FormData();
    recordForm.set("path", signed.path);
    recordForm.set("filename", file.name);
    recordForm.set("bytes", String(file.size));
    recordForm.set("type", file.type);
    const recorded = await recordAction(recordForm);
    if (!recorded.ok) {
      setError(recorded.error);
      setDrop("error");
      return;
    }

    setDocumentId(recorded.documentId);
    setDrop("done");
  }

  function clearFile() {
    setDocumentId("");
    setFilename("");
    setDrop("idle");
    setError(null);
  }

  const terms = free
    ? t("concierge.free_on", { plan: planName })
    : t("concierge.priced", { fee: feeFormatted, plan: planName });

  return (
    <Panel eyebrow={t("concierge.eyebrow")} title={t("concierge.title")}>
      <div className="flex flex-col gap-3">
        <p className="max-w-prose text-body-sm text-muted">
          {t("concierge.body", { limit: productLimitFormatted })}
        </p>
        <p className="text-caption text-muted">
          {terms} {t("concierge.sla")}
        </p>

        {/*
          The confirmation yields to the durable state. `concierge.sent` covers
          the moment between the submit and the refresh landing; once the
          pending line below is on screen it says the same thing with the dates
          in it, and both at once reads as two events.
        */}
        {done === "sent" && request?.status !== "requested" && (
          <Alert tone="ok" live="polite">
            {t("concierge.sent")}
          </Alert>
        )}
        {done === "cancelled" && (
          <Alert tone="ok" live="polite">
            {t("concierge.cancelled")}
          </Alert>
        )}

        {/*
          Not while the drop zone is in its error state — that renders the same
          sentence itself, and a message printed twice reads as two problems.
        */}
        {error && drop !== "error" && (
          <p role="alert" className="max-w-prose text-body-sm text-bad-ink">
            {error}
          </p>
        )}

        {request?.status === "requested" && (
          <div className="flex flex-col items-start gap-2">
            <p className="text-body-sm text-ink">
              {t("concierge.pending", { when: request.requestedOn, due: request.dueOn })}
            </p>
            {/*
              The withdraw control sits beside "pending" and nowhere else.
              Once somebody is keying the file in, taking it back is a
              conversation rather than a button — and the service refuses it
              for the same reason.
            */}
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const form = new FormData();
                form.set("id", request.id);
                setError(null);
                startTransition(async () => {
                  const result = await cancelAction(form);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setDone("cancelled");
                  clearFile();
                  router.refresh();
                });
              }}
            >
              {t("concierge.cancel")}
            </Button>
          </div>
        )}

        {request?.status === "in_progress" && (
          <p className="text-body-sm text-ink">
            {t("concierge.in_progress", { due: request.dueOn })}
          </p>
        )}

        {request?.status === "loaded" && (
          <p className="text-body-sm text-ink">
            {t("concierge.loaded", {
              count: request.productsLoaded,
              formatted: request.productsLoadedFormatted,
              date: request.loadedOn,
            })}
          </p>
        )}

        {/*
          The form returns once the last request is finished. A seller who has
          had one catalogue keyed in has a second price list often enough that
          hiding the control would read as a limit nobody stated.
        */}
        {(request === null || request.status === "loaded") && !open && (
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {t("concierge.send")}
          </Button>
        )}

        {(request === null || request.status === "loaded") && open && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!documentId) {
                setError(t("concierge.error.no_file"));
                return;
              }
              const form = new FormData();
              form.set("documentId", documentId);
              form.set("note", note);
              setError(null);
              startTransition(async () => {
                const result = await sendAction(form);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setDone("sent");
                clearFile();
                setNote("");
                router.refresh();
              });
            }}
          >
            <div className="flex flex-col gap-1">
              <p className="text-body-sm text-ink">{t("concierge.file_label")}</p>
              <FileDrop
                state={drop}
                accept={accept}
                filename={filename}
                idleLabel={t("concierge.send")}
                idleHint={fileHint}
                uploadingLabel={t("upload.uploading")}
                removeLabel={t("upload.remove")}
                retryLabel={t("upload.retry")}
                {...(error ? { errorMessage: error } : {})}
                onSelect={upload}
                onRemove={clearFile}
                onRetry={clearFile}
              />
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("concierge.note_label")}</span>
              <Textarea
                name="note"
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <span className="text-caption text-muted">{t("concierge.note_hint")}</span>
            </label>

            <div>
              <Button type="submit" size="sm" disabled={busy || drop !== "done"}>
                {t("concierge.submit")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Panel>
  );
}
