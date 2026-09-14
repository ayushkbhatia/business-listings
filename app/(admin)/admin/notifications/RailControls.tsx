"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Checkbox, Input, Label, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import type { NotificationEvent } from "@/lib/db/generated/enums";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { draftProblems } from "@/lib/notify/draft";
import { placeholdersIn, sampleParams } from "@/lib/notify/params";
import { render } from "@/lib/notify/render";
import { smsLength } from "@/lib/notify/sms-length";
import type { TemplateDetail } from "@/lib/notify/templates";
import { metaDecisionAction, publishDraftAction, saveVersionAction, sendTestAction, type ActionResult } from "./actions";
import type { DetailView } from "./present";

/**
 * Board 12g — the controls on the rail.
 *
 * The editor runs `draftProblems` — the function the save runs — on every
 * keystroke, so a placeholder the event does not supply, a name that could carry
 * contact details, or an SMS one character over its segment is a line under the
 * box rather than a refusal after the fact. The preview draws the body as it is
 * written, with each variable marked, because that is what staff are editing;
 * `Send test to me` is how they see it filled in on the real channel (`B10`).
 */

const MIN_REASON = 4;
const TOKEN = /(\{[a-zA-Z0-9_]+\})/;
const IS_TOKEN = /^\{[a-zA-Z0-9_]+\}$/;

function Tokens({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, index) =>
        IS_TOKEN.test(part) ? (
          <code key={index} className="mx-0.5 rounded-sm border border-line bg-fill px-1 font-mono text-caption text-ink">
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/** Characters as the carrier counts them, once the body is one that can render. */
function smsMeter(
  channel: string,
  body: string,
  actionPath: string | null,
  event: NotificationEvent,
  origin: string,
  problems: readonly { error: string }[],
) {
  if (channel !== "sms" || !body.trim()) return null;
  if (problems.some((p) => p.error === "unknown_placeholder" || p.error === "forbidden_placeholder")) return null;
  return smsLength(render({ body, actionPath }, sampleParams(event, origin)).body);
}

function Result({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return (
    <div className="mt-3">
      <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
        {result.ok ? result.message : result.error}
      </Alert>
    </div>
  );
}

export function TemplateEditor({
  view,
  seed,
  origin,
  canWrite,
}: {
  view: DetailView;
  seed: TemplateDetail["seed"];
  origin: string;
  canWrite: boolean;
}) {
  const ids = { subject: useId(), body: useId(), label: useId(), path: useId(), meta: useId(), reason: useId(), problems: useId() };
  const [subject, setSubject] = useState(seed.subject ?? "");
  const [body, setBody] = useState(seed.body);
  const [actionLabel, setActionLabel] = useState(seed.actionLabel ?? "");
  const [actionPath, setActionPath] = useState(seed.actionPath ?? "");
  const [metaName, setMetaName] = useState(seed.metaTemplateName ?? "");
  const [neutral, setNeutral] = useState(view.neutralDefault);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const event = view.event as NotificationEvent;
  const draft = {
    event,
    channel: view.channel,
    subject: view.channel === "email" ? subject : null,
    body,
    actionLabel: actionLabel || null,
    actionPath: actionPath || null,
    metaTemplateName: view.channel === "whatsapp" ? metaName : null,
  };
  const problems = draftProblems(draft, origin);
  const used = new Set(placeholdersIn(body, draft.subject, draft.actionLabel, draft.actionPath));

  const sms = smsMeter(view.channel, body, draft.actionPath, event, origin, problems);

  const ready = canWrite && problems.length === 0 && reason.trim().length >= MIN_REASON && !pending;

  function save() {
    const form = new FormData();
    form.set("event", view.event);
    form.set("channel", view.channel);
    form.set("line", view.line);
    if (neutral && view.canNeutral) form.set("neutral", "on");
    form.set("subject", subject);
    form.set("body", body);
    form.set("actionLabel", actionLabel);
    form.set("actionPath", actionPath);
    form.set("metaTemplateName", metaName);
    form.set("basedOn", view.basedOn === null ? "" : String(view.basedOn));
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await saveVersionAction(form);
      setResult(outcome);
      if (outcome.ok) setReason("");
    });
  }

  function test() {
    if (!view.testable) return;
    const form = new FormData();
    form.set("templateId", view.testable.id);
    startTransition(async () => setResult(await sendTestAction(form)));
  }

  return (
    <div className="px-4 py-4">
      <div className="rounded-control bg-paper-sunk p-3">
        <div className="rounded-panel bg-card p-3 shadow-sm">
          {view.channel === "email" && subject ? (
            <p className="mb-2 border-b border-line pb-2 text-body-sm font-medium text-ink">
              <Tokens text={subject} />
            </p>
          ) : null}
          <p className="whitespace-pre-line text-body-sm leading-relaxed text-ink">
            {body.trim() ? <Tokens text={body} /> : <span className="text-muted">{t("notifications.editor.empty_preview")}</span>}
          </p>
          {actionLabel && view.channel !== "sms" ? (
            <p className="mt-3 rounded-control bg-fill px-3 py-2 text-center text-body-sm text-ink">
              <Tokens text={actionLabel} />
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-4 font-mono text-eyebrow uppercase text-faint">{view.variablesLabel}</p>
      {view.variables.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {view.variables.map((variable) => (
            <li
              key={variable.name}
              className={cn(
                "rounded-sm border px-2 py-0.5 font-mono text-caption",
                used.has(variable.name) ? "border-line-strong bg-card text-ink" : "border-dashed border-line text-muted",
              )}
            >
              {variable.name}
              {used.has(variable.name) ? null : <span className="sr-only"> {t("notifications.editor.unused")}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-caption text-muted">{t("notifications.editor.no_variables")}</p>
      )}
      <p className="mt-2 text-caption text-muted">{view.privacyNote}</p>

      <fieldset disabled={!canWrite || pending} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
        <legend className="sr-only">{view.heading}</legend>
        {!canWrite ? <p className="text-caption text-muted">{t("notifications.editor.read_only")}</p> : null}

        {view.channel === "email" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.subject} requirement="required" requirementLabel={t("field.required")}>
              {t("notifications.editor.subject")}
            </Label>
            <Input id={ids.subject} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        ) : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.body} requirement="required" requirementLabel={t("field.required")}>
            {t("notifications.editor.body")}
          </Label>
          <Textarea
            id={ids.body}
            rows={view.channel === "email" ? 6 : 4}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            invalid={problems.length > 0}
            aria-describedby={problems.length > 0 || sms ? ids.problems : undefined}
          />
          <div id={ids.problems} className="flex flex-col gap-0.5">
            {sms ? (
              <p className={cn("text-caption tabular-nums", sms.fits ? "text-muted" : "text-bad-ink")}>
                {t(sms.encoding === "gsm7" ? "notifications.editor.sms_gsm" : "notifications.editor.sms_unicode", {
                  units: formatCount(sms.units),
                  limit: formatCount(sms.limit),
                  chars: sms.offending.join(" "),
                })}
              </p>
            ) : null}
            {problems.map((problem) => (
              <p key={problem.error} className="text-caption text-bad-ink">
                {t(`notifications.refusal.${problem.error}` as MessageKey, problem.detail)}
              </p>
            ))}
          </div>
        </div>

        {view.channel !== "sms" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.label}>{t("notifications.editor.action_label")}</Label>
              <Input id={ids.label} value={actionLabel} onChange={(e) => setActionLabel(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={ids.path} hint={t("notifications.editor.action_path_hint")}>
                {t("notifications.editor.action_path")}
              </Label>
              <Input id={ids.path} mono value={actionPath} onChange={(e) => setActionPath(e.target.value)} />
            </div>
          </div>
        ) : null}

        {view.channel === "whatsapp" ? (
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.meta} requirement="required" requirementLabel={t("field.required")} hint={t("notifications.editor.meta_name_hint")}>
              {t("notifications.editor.meta_name")}
            </Label>
            <Input id={ids.meta} mono value={metaName} onChange={(e) => setMetaName(e.target.value)} />
          </div>
        ) : null}

        {view.canNeutral ? (
          <Checkbox
            label={t("notifications.neutral.label")}
            description={view.neutralLocked ?? t("notifications.neutral.description")}
            checked={neutral}
            disabled={!!view.neutralLocked && !neutral}
            onChange={(e) => setNeutral(e.target.checked)}
          />
        ) : null}

        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")} hint={t("notifications.editor.reason_hint")}>
            {t("notifications.editor.reason")}
          </Label>
          <Textarea id={ids.reason} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        <p className="text-caption text-muted">{view.saveHint}</p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={save} disabled={!ready} loading={pending}>
            {view.saveLabel}
          </Button>
          {view.testable ? (
            <Button variant="secondary" onClick={test} disabled={!canWrite || pending}>
              {view.testable.label}
            </Button>
          ) : null}
        </div>
        {view.testBlocked ? <p className="text-caption text-muted">{view.testBlocked}</p> : null}
      </fieldset>

      <Result result={result} />
    </div>
  );
}

export function MetaDecisionForm({ templateId }: { templateId: string }) {
  const ids = { note: useId(), reason: useId() };
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const reasoned = reason.trim().length >= MIN_REASON;

  function decide(decision: "approved" | "rejected") {
    const form = new FormData();
    form.set("templateId", templateId);
    form.set("decision", decision);
    form.set("metaNote", note);
    form.set("reason", reason);
    startTransition(async () => setResult(await metaDecisionAction(form)));
  }

  return (
    /*
       On a card, not on the warn wash. The labels, their required tags and the
       hint carry the form grammar's muted ink, which fails the §09.2 floor on a
       warn surface — the panel says what is pending, and the form beneath it is
       an ordinary form.
    */
    <div className="mt-3 flex flex-col gap-2 rounded-control border border-warn-line bg-card p-3">
      <p className="text-caption text-body">{t("notifications.meta_panel.record_hint")}</p>
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.note} hint={t("notifications.meta_panel.note_hint")}>
          {t("notifications.meta_panel.note")}
        </Label>
        <Textarea id={ids.note} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")}>
          {t("notifications.editor.reason")}
        </Label>
        <Textarea id={ids.reason} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => decide("approved")} disabled={!reasoned || pending}>
          {t("notifications.meta_panel.approve")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => decide("rejected")} disabled={!reasoned || note.trim().length < MIN_REASON || pending}>
          {t("notifications.meta_panel.reject")}
        </Button>
      </div>
      <Result result={result} />
    </div>
  );
}

export function PublishDraftButton({ templateId, version }: { templateId: string; version: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button type="button" className="mt-1 block text-moss underline underline-offset-2 hover:text-moss-hover" onClick={() => setOpen(true)}>
        {t("notifications.history.publish", { version })}
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <Label htmlFor={id} requirement="required" requirementLabel={t("field.required")}>
        {t("notifications.editor.reason")}
      </Label>
      <Input id={id} size="sm" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Button
        size="sm"
        disabled={reason.trim().length < MIN_REASON || pending}
        onClick={() => {
          const form = new FormData();
          form.set("templateId", templateId);
          form.set("reason", reason);
          startTransition(async () => setResult(await publishDraftAction(form)));
        }}
      >
        {t("notifications.history.publish", { version })}
      </Button>
      <Result result={result} />
    </div>
  );
}
