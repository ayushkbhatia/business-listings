"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { StatusBadge } from "@/components/display/StatusBadge";
import { Button, Textarea } from "@/components/primitives";
import { Modal } from "@/components/structure";
import type { RequestView } from "@/lib/buyer-company/request-words";
import { t } from "@/lib/i18n";
import { answerAction, approveAction, queryAction, withdrawAction } from "./actions";
import { Outcome } from "./_field";

/**
 * Board `7b` — one request for approval, and what the viewer can do with it.
 *
 * *Approve* accepts the quote: it releases the raiser's contact details to the
 * supplier and closes the enquiry to the others, which cannot be taken back —
 * so it confirms, and the confirm button repeats the verb. *Query* sends it
 * back with a question and needs the question.
 */
export function RequestItem({
  view,
  compact = false,
  onDone,
}: {
  view: RequestView;
  compact?: boolean;
  onDone?: (message: string) => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"approve" | "query" | "answer" | "withdraw" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  function finished(text: string) {
    setDialog(null);
    setMessage({ tone: "ok", text });
    onDone?.(text);
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <p className="text-body-sm text-ink">
        {compact ? (
          <Link href={view.href} className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none">
            {view.summary}
          </Link>
        ) : (
          view.summary
        )}
      </p>
      <p className="mt-0.5 font-mono text-eyebrow uppercase tracking-eyebrow text-muted">{view.raised}</p>

      {view.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-caption text-body">
          {view.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {!compact || view.stateTone !== "warn" ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-caption text-body">
          <StatusBadge tone={view.stateTone} shape="chip">
            {view.stateLabel}
          </StatusBadge>
          <span>{view.stateLine}</span>
        </p>
      ) : null}

      {view.decisionNote && (view.canAnswer || !compact) ? (
        <blockquote className="mt-2 border-l-2 border-line-strong pl-3 text-caption text-prose">{view.decisionNote}</blockquote>
      ) : null}

      {(view.canApprove || view.canQuery || view.canAnswer || view.canWithdraw) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {view.canApprove ? (
            <Button size="sm" onClick={() => setDialog("approve")}>
              {t("company.request.approve")}
            </Button>
          ) : null}
          {view.canQuery ? (
            <Button size="sm" variant="secondary" onClick={() => setDialog("query")}>
              {t("company.request.query")}
            </Button>
          ) : null}
          {view.canAnswer ? (
            <Button size="sm" onClick={() => setDialog("answer")}>
              {t("company.request.answer")}
            </Button>
          ) : null}
          {view.canWithdraw ? (
            <Button size="sm" variant="ghost" onClick={() => setDialog("withdraw")}>
              {t("company.request.withdraw")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div className="mt-2">
          <Outcome tone={message.tone} text={message.text} />
        </div>
      ) : null}

      {dialog === "approve" ? (
        <ConfirmDialog
          title={t("company.request.approve_title", { quote: view.quoteRef })}
          body={view.approveBody}
          confirm={t("company.request.approve_confirm")}
          run={() => approveAction(view.id)}
          onClose={() => setDialog(null)}
          onDone={finished}
        />
      ) : null}
      {dialog === "withdraw" ? (
        <ConfirmDialog
          title={t("company.request.withdraw_title", { quote: view.quoteRef })}
          body={t("company.request.withdraw_body")}
          confirm={t("company.request.withdraw_confirm")}
          danger
          run={() => withdrawAction(view.id)}
          onClose={() => setDialog(null)}
          onDone={finished}
        />
      ) : null}
      {dialog === "query" ? (
        <NoteDialog
          title={t("company.request.query_title", { quote: view.quoteRef })}
          description={t("company.request.query_description")}
          label={t("company.request.query_label")}
          confirm={t("company.request.query_confirm")}
          run={(note) => queryAction(view.id, note)}
          onClose={() => setDialog(null)}
          onDone={finished}
        />
      ) : null}
      {dialog === "answer" ? (
        <NoteDialog
          title={t("company.request.answer_title", { quote: view.quoteRef })}
          description={view.decisionNote ?? ""}
          label={t("company.request.answer_label")}
          confirm={t("company.request.answer_confirm")}
          run={(answer) => answerAction(view.id, answer)}
          onClose={() => setDialog(null)}
          onDone={finished}
        />
      ) : null}
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirm,
  danger = false,
  run,
  onClose,
  onDone,
}: {
  title: string;
  body: string;
  confirm: string;
  danger?: boolean;
  run: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title={title}
      description={body}
      closeLabel={t("company.dialog.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("company.dialog.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={pending}
            onClick={() =>
              start(async () => {
                const result = await run();
                if (result.ok) onDone(result.message ?? "");
                else setError(result.error);
              })
            }
          >
            {confirm}
          </Button>
        </>
      }
    >
      {error ? (
        <Outcome tone="bad" text={error} />
      ) : null}
    </Modal>
  );
}

function NoteDialog({
  title,
  description,
  label,
  confirm,
  run,
  onClose,
  onDone,
}: {
  title: string;
  description: string;
  label: string;
  confirm: string;
  run: (note: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const id = useId();
  const formId = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      {...(description ? { description } : {})}
      closeLabel={t("company.dialog.close")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t("company.dialog.cancel")}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {confirm}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(event) => {
          // Not a form action: an action resets the textarea when it settles,
          // and a refused question should still be there to fix.
          event.preventDefault();
          const note = String(new FormData(event.currentTarget).get("note") ?? "");
          start(async () => {
            const result = await run(note);
            if (result.ok) onDone(result.message ?? "");
            else setError(result.error);
          });
        }}
        className="flex flex-col gap-1"
      >
        <label htmlFor={id} className="text-caption font-medium text-body">
          {label}
        </label>
        <Textarea
          id={id}
          name="note"
          rows={4}
          limit={1000}
          counterLabel={(used, limit) => t("company.request.counter", { used: String(used), limit: String(limit) })}
          required
          invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-caption text-bad-ink">
            {error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
