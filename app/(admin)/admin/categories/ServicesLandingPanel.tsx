"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Alert } from "@/components/display";
import { Button, FieldError, Input, Label, Select, Textarea, Toggle } from "@/components/primitives";
import { CREDENTIAL_KINDS } from "@/lib/credentials/kinds";
import { formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import {
  ASK_QUESTION_MAX,
  ASK_WHY_MAX,
  MAX_ASKS,
  PLURAL_MAX,
  servicesLandingProblems,
  tidy,
  writtenAsks,
  type CategoryAskInput,
  type ServicesLandingProblem,
} from "@/lib/taxonomy/services-landing-rules";
import { saveServicesLandingAction, setServicesLandingOpenAction } from "./actions";
import { TaxonomyDialog } from "./TaxonomyDialog";

/**
 * Board `6a-s` — what a services trade's landing pages read off the trade.
 *
 * Four decisions a query cannot make: the plural noun the H1 opens with
 * (correction 3), the credential the stat line counts, the three questions
 * *What to ask* renders (B9 — per trade, never per area), and whether the
 * services template is open for the trade at all (build phase 5's flag).
 *
 * The wording applies on Save, with one reason for the whole change (§02: an
 * edit applies on save). The template is a toggle, which applies immediately
 * and asks for its reason at the moment of the flip — the same split the
 * visibility panel beside it makes.
 *
 * Only mounted for a trade that resolves to `services`; a goods trade's pages
 * read none of this, and the service refuses it for one.
 */

export interface ServicesLandingPanelView {
  categoryId: string;
  name: string;
  pluralHuman: string | null;
  credentialKind: string | null;
  /** The resolved credential, when it is inherited — the line under the select. */
  inherited: { kind: string; source: string | null } | null;
  asks: CategoryAskInput[];
  openedAt: string | null;
  publishedPages: number;
}

const INHERIT = "";

/*
   Said as they happen, because the reader can see they have gone over — the
   counter under the field has already turned. Every other problem waits for a
   Save: a sentence half typed is not yet a mistake, and an error that appears
   the moment a field is touched blames the person for not having finished.
*/
const SAID_AT_ONCE: readonly ServicesLandingProblem[] = [
  "plural_too_long",
  "ask_question_too_long",
  "ask_why_too_long",
];

export function ServicesLandingPanel({
  view,
  canWrite,
  landmark = true,
}: {
  view: ServicesLandingPanelView;
  canWrite: boolean;
  /** Off in the gallery, where several specimens would each claim a region. */
  landmark?: boolean;
}) {
  const router = useRouter();
  const Frame = landmark ? "section" : "div";
  const ids = { title: useId(), plural: useId(), credential: useId(), asks: useId() };

  const [plural, setPlural] = useState(view.pluralHuman ?? "");
  const [credential, setCredential] = useState(view.credentialKind ?? INHERIT);
  const [asks, setAsks] = useState<CategoryAskInput[]>(view.asks);
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [switching, setSwitching] = useState<boolean | null>(null);
  const [pendingOpen, setPendingOpen] = useState<boolean | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const open = pendingOpen ?? view.openedAt !== null;
  if (pendingOpen !== null && (view.openedAt !== null) === pendingOpen) setPendingOpen(null);

  // What Save would send: tidied, with the rows nobody has written in dropped.
  const written = writtenAsks(asks);
  const problems = servicesLandingProblems({
    pluralHuman: plural,
    credentialKind: credential === INHERIT ? null : credential,
    asks: written,
  });
  const says = (problem: ServicesLandingProblem) =>
    problems.includes(problem) && (attempted || SAID_AT_ONCE.includes(problem));
  /*
     Compared as the service will store it. The record holds tidied text, so a
     double space typed here would otherwise leave the panel dirty after a save
     that changed nothing more — and a second Save would be refused as
     unchanged.
  */
  const dirty =
    tidy(plural) !== (view.pluralHuman ?? "") ||
    credential !== (view.credentialKind ?? INHERIT) ||
    JSON.stringify(written) !== JSON.stringify(view.asks);

  const fallback = t("landing_services.noun_fallback", { category: view.name });
  const example = t("landing_services.h1_area", {
    noun: tidy(plural) || fallback,
    area: t("taxonomy.services_landing.example_area"),
    emirate: t("emirate.dubai"),
  });

  const setAsk = (index: number, patch: Partial<CategoryAskInput>) =>
    setAsks((current) => current.map((ask, at) => (at === index ? { ...ask, ...patch } : ask)));

  return (
    <Frame
      aria-labelledby={landmark ? ids.title : undefined}
      className="rounded-panel border border-line bg-card p-5"
    >
      <h3 id={ids.title} className="font-mono text-eyebrow uppercase text-muted">
        {t("taxonomy.services_landing.title")}
      </h3>
      <p className="mt-2 max-w-prose text-body-sm text-body">{t("taxonomy.services_landing.intro")}</p>

      {/* ── The template switch ─────────────────────────────────────────── */}
      <div className="mt-4 border-b border-line pb-4">
        <Toggle
          checked={open}
          disabled={!canWrite || switching !== null || pendingOpen !== null}
          pending={pendingOpen !== null}
          label={t("taxonomy.services_landing.template_label")}
          description={
            view.openedAt
              ? t("taxonomy.services_landing.template_open", { date: formatDate(new Date(view.openedAt)) })
              : t("taxonomy.services_landing.template_closed")
          }
          onChange={(value) => {
            setMessage(null);
            setSwitching(value);
          }}
        />
        <p className="mt-2 text-caption text-body">{t("taxonomy.services_landing.template_note")}</p>
      </div>

      {/* ── The wording ─────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <Label htmlFor={ids.plural}>{t("taxonomy.services_landing.plural_label")}</Label>
          <Input
            id={ids.plural}
            value={plural}
            maxLength={PLURAL_MAX + 20}
            disabled={!canWrite}
            invalid={says("plural_too_short") || says("plural_too_long")}
            onChange={(event) => setPlural(event.target.value)}
            aria-describedby={`${ids.plural}-hint`}
          />
          <p id={`${ids.plural}-hint`} className="mt-1 text-caption text-body">
            {t("taxonomy.services_landing.plural_hint", { example, fallback })}
          </p>
          {says("plural_too_short") && (
            <FieldError>{t("taxonomy.services_landing.refusal.plural_too_short")}</FieldError>
          )}
          {says("plural_too_long") && (
            <FieldError>{t("taxonomy.services_landing.refusal.plural_too_long")}</FieldError>
          )}
        </div>

        <div>
          <Label htmlFor={ids.credential}>{t("taxonomy.services_landing.credential_label")}</Label>
          <Select
            id={ids.credential}
            value={credential}
            disabled={!canWrite}
            onChange={(event) => setCredential(event.target.value)}
            options={[
              { value: INHERIT, label: t("taxonomy.services_landing.credential_inherit") },
              ...CREDENTIAL_KINDS.map((kind) => ({
                value: kind,
                label: t(`credentials_public.kind.${kind}` as MessageKey),
              })),
            ]}
            aria-describedby={`${ids.credential}-hint`}
          />
          <p id={`${ids.credential}-hint`} className="mt-1 text-caption text-body">
            {credential === INHERIT
              ? view.inherited
                ? t("taxonomy.services_landing.credential_inherited", {
                    source: view.inherited.source ?? view.name,
                    credential: t(`credentials_public.kind.${view.inherited.kind}` as MessageKey),
                  })
                : t("taxonomy.services_landing.credential_none")
              : null}{" "}
            {t("taxonomy.services_landing.credential_hint")}
          </p>
        </div>

        <fieldset aria-describedby={`${ids.asks}-hint`}>
          <legend className="text-body-sm font-medium text-ink">{t("taxonomy.services_landing.asks_label")}</legend>
          <p id={`${ids.asks}-hint`} className="mt-1 text-caption text-body">
            {t("taxonomy.services_landing.asks_hint")}
          </p>
          <ol className="mt-3 flex list-none flex-col gap-4 p-0">
            {asks.map((ask, index) => (
              <li key={index} className="rounded-card border border-line p-3">
                <Label htmlFor={`${ids.asks}-q-${index}`}>
                  {t("taxonomy.services_landing.ask_question", { n: index + 1 })}
                </Label>
                <Input
                  id={`${ids.asks}-q-${index}`}
                  value={ask.question}
                  maxLength={ASK_QUESTION_MAX}
                  disabled={!canWrite}
                  onChange={(event) => setAsk(index, { question: event.target.value })}
                />
                <div className="mt-2">
                  <Label htmlFor={`${ids.asks}-w-${index}`}>{t("taxonomy.services_landing.ask_why")}</Label>
                </div>
                <Textarea
                  id={`${ids.asks}-w-${index}`}
                  value={ask.why}
                  rows={2}
                  limit={ASK_WHY_MAX}
                  counterLabel={(used, limit) => t("field.counter", { used, limit })}
                  disabled={!canWrite}
                  onChange={(event) => setAsk(index, { why: event.target.value })}
                />
                {canWrite && (
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setAsks((current) => current.filter((_, at) => at !== index))}
                    >
                      {t("taxonomy.services_landing.ask_remove", { n: index + 1 })}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          {canWrite && asks.length < MAX_ASKS && (
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAsks((current) => [...current, { question: "", why: "" }])}
              >
                {t("taxonomy.services_landing.ask_add")}
              </Button>
            </div>
          )}
          {says("ask_empty") && (
            <FieldError>{t("taxonomy.services_landing.refusal.ask_empty")}</FieldError>
          )}
          {says("ask_question_too_long") && (
            <FieldError>
              {t("taxonomy.services_landing.refusal.ask_question_too_long")}
            </FieldError>
          )}
          {says("ask_why_too_long") && (
            <FieldError>{t("taxonomy.services_landing.refusal.ask_why_too_long")}</FieldError>
          )}
        </fieldset>

        {canWrite ? (
          <div className="flex justify-end">
            {/*
               Enabled whenever something changed. A Save with a problem in it
               says what the problem is, under its field, rather than sitting
               greyed out with the reason left for the reader to find.
            */}
            <Button
              disabled={!dirty}
              onClick={() => {
                setMessage(null);
                if (problems.length > 0) setAttempted(true);
                else setSaving(true);
              }}
            >
              {t("taxonomy.services_landing.save")}
            </Button>
          </div>
        ) : (
          <p className="text-caption text-body">{t("taxonomy.services_landing.read_only")}</p>
        )}
      </div>

      {message ? (
        <div className="mt-3">
          <Alert tone="ok" live="polite">
            {message}
          </Alert>
        </div>
      ) : null}

      {saving ? (
        <TaxonomyDialog
          open
          onClose={() => setSaving(false)}
          title={t("taxonomy.services_landing.save_title", { name: view.name })}
          description={t("taxonomy.services_landing.save_body")}
          confirmLabel={t("taxonomy.services_landing.save_confirm")}
          size="sm"
          onSubmit={async (reason) => {
            const form = new FormData();
            form.set("categoryId", view.categoryId);
            form.set("pluralHuman", plural);
            form.set("credentialKind", credential);
            form.set("asks", JSON.stringify(written));
            form.set("reason", reason);
            return saveServicesLandingAction(form);
          }}
          onDone={(text) => {
            setSaving(false);
            setAttempted(false);
            // The fields as saved: tidied, and a blank row added and never used gone.
            setPlural(tidy(plural));
            setAsks(written);
            setMessage(text);
            router.refresh();
          }}
        />
      ) : null}

      {switching !== null ? (
        <TaxonomyDialog
          open
          onClose={() => setSwitching(null)}
          title={t(
            switching ? "taxonomy.services_landing.open.title" : "taxonomy.services_landing.close.title",
            { name: view.name },
          )}
          description={
            switching
              ? t("taxonomy.services_landing.open.body")
              : view.publishedPages === 0
                ? t("taxonomy.services_landing.close.body_none")
                : t("taxonomy.services_landing.close.body", { count: view.publishedPages })
          }
          confirmLabel={t(
            switching ? "taxonomy.services_landing.open.confirm" : "taxonomy.services_landing.close.confirm",
          )}
          destructive={!switching}
          size="sm"
          onSubmit={async (reason) => {
            const form = new FormData();
            form.set("categoryId", view.categoryId);
            form.set("name", view.name);
            form.set("open", switching ? "on" : "off");
            form.set("reason", reason);
            setPendingOpen(switching);
            const outcome = await setServicesLandingOpenAction(form);
            if (!outcome.ok) setPendingOpen(null);
            return outcome;
          }}
          onDone={(text) => {
            setSwitching(null);
            setMessage(text);
            router.refresh();
          }}
        />
      ) : null}
    </Frame>
  );
}
