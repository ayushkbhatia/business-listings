"use client";

import { Button, Checkbox, Input, Label, Textarea } from "@/components/primitives";
import { Eyebrow } from "@/components/display";
import { t } from "@/lib/i18n";
import {
  MAX_FAQ_ROWS,
  MAX_RELATED_SEARCHES,
  META_DESCRIPTION_MAX,
  QUOTE_RANGE_TOKEN,
} from "@/lib/seo/landing/limits";

/**
 * Board 6a's content records, on board 6f's screen.
 *
 * The intro was the only authored thing on a landing page until this board.
 * There are now four, and three of them are publish conditions or close to it:
 *
 *   intro              250 words, condition three
 *   FAQ                four rows, two of them scope-specific — condition four
 *   related searches   five, editorial, not a gate
 *   meta description   one written sentence, not a gate
 *
 * One component for both classes, because §1's "one template" has to mean the
 * editor too — the area pages and the 84 emirate pages publish on the same four
 * conditions and an editor that could only write three of them for one class is
 * how the two drift.
 *
 * ## Why the scope-specific tick is a person's judgement
 *
 * There is no way to measure whether a question could only be asked about Al
 * Quoz. A similarity heuristic over the other scopes' questions would produce a
 * number nobody could argue with and a writer could defeat with a thesaurus.
 * The board's own model — *"Is Al Quoz the right area for my job?"*, which names
 * the neighbourhoods this area serves and sends the wrong buyer elsewhere — is
 * a judgement, so it is ticked rather than computed, and the audit row records
 * who ticked it.
 */

export interface FaqDraft {
  question: string;
  answer: string;
  scopeSpecific: boolean;
  liveToken: string | null;
}

export interface RelatedDraft {
  label: string;
  href: string;
}

export interface LandingContentDraft {
  metaDescription: string;
  faq: FaqDraft[];
  relatedSearches: RelatedDraft[];
}

export function emptyFaqRow(): FaqDraft {
  return { question: "", answer: "", scopeSpecific: false, liveToken: null };
}

export function LandingContentFields({
  draft,
  onChange,
  idPrefix,
}: {
  draft: LandingContentDraft;
  onChange: (next: LandingContentDraft) => void;
  /** Unique per open panel: two editors on one screen must not share ids. */
  idPrefix: string;
}) {
  const scopeSpecific = draft.faq.filter((row) => row.scopeSpecific).length;

  function setFaq(index: number, patch: Partial<FaqDraft>) {
    onChange({
      ...draft,
      faq: draft.faq.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    });
  }

  function setRelated(index: number, patch: Partial<RelatedDraft>) {
    onChange({
      ...draft,
      relatedSearches: draft.relatedSearches.map((row, i) =>
        i === index ? { ...row, ...patch } : row,
      ),
    });
  }

  return (
    <>
      <div className="mt-4">
        <Label htmlFor={`${idPrefix}-meta`}>{t("matrix.meta_description")}</Label>
        <Textarea
          id={`${idPrefix}-meta`}
          rows={2}
          value={draft.metaDescription}
          onChange={(event) => onChange({ ...draft, metaDescription: event.target.value })}
        />
        <p className="mt-1 text-caption text-muted">
          {t("matrix.meta_hint", {
            characters: draft.metaDescription.trim().length,
            max: META_DESCRIPTION_MAX,
          })}
        </p>
      </div>

      <section className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Eyebrow as="h3">{t("matrix.faq")}</Eyebrow>
          {/*
             The gate, said while the writer is working rather than at the
             moment they press publish. §08: say what correct looks like.
          */}
          <p className="text-caption text-muted">
            {t("matrix.faq_progress", { rows: draft.faq.length, specific: scopeSpecific })}
          </p>
        </div>

        <ol className="mt-3 flex flex-col gap-4">
          {draft.faq.map((row, index) => (
            <li key={index} className="rounded-card border border-line bg-paper p-3">
              <Label htmlFor={`${idPrefix}-q-${index}`}>
                {t("matrix.faq_question", { position: index + 1 })}
              </Label>
              <Input
                id={`${idPrefix}-q-${index}`}
                value={row.question}
                onChange={(event) => setFaq(index, { question: event.target.value })}
              />

              <div className="mt-2.5">
                <Label htmlFor={`${idPrefix}-a-${index}`}>{t("matrix.faq_answer")}</Label>
                <Textarea
                  id={`${idPrefix}-a-${index}`}
                  rows={3}
                  value={row.answer}
                  onChange={(event) => setFaq(index, { answer: event.target.value })}
                />
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-4">
                <Checkbox
                  id={`${idPrefix}-s-${index}`}
                  label={t("matrix.faq_scope_specific")}
                  checked={row.scopeSpecific}
                  onChange={(event) => setFaq(index, { scopeSpecific: event.target.checked })}
                />
                {/*
                   The one live token. A writer types `{quote_range}` where the
                   number goes and ticks this; below the 30-quote minimum sample
                   the whole row does not render, which is criterion 11 and the
                   reason the number is not typed in by hand.
                */}
                <Checkbox
                  id={`${idPrefix}-t-${index}`}
                  label={t("matrix.faq_quote_range")}
                  checked={row.liveToken === QUOTE_RANGE_TOKEN}
                  onChange={(event) =>
                    setFaq(index, { liveToken: event.target.checked ? QUOTE_RANGE_TOKEN : null })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    onChange({ ...draft, faq: draft.faq.filter((_, i) => i !== index) })
                  }
                >
                  {t("action.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ol>

        {draft.faq.length < MAX_FAQ_ROWS && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange({ ...draft, faq: [...draft.faq, emptyFaqRow()] })}
          >
            {t("matrix.faq_add")}
          </Button>
        )}
      </section>

      <section className="mt-6">
        <Eyebrow as="h3">{t("matrix.related")}</Eyebrow>
        <ol className="mt-3 flex flex-col gap-2.5">
          {draft.relatedSearches.map((row, index) => (
            <li key={index} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor={`${idPrefix}-rl-${index}`}>{t("matrix.related_label")}</Label>
                <Input
                  id={`${idPrefix}-rl-${index}`}
                  value={row.label}
                  onChange={(event) => setRelated(index, { label: event.target.value })}
                />
              </div>
              <div className="min-w-[12rem] flex-1">
                <Label htmlFor={`${idPrefix}-rh-${index}`}>{t("matrix.related_href")}</Label>
                <Input
                  id={`${idPrefix}-rh-${index}`}
                  value={row.href}
                  onChange={(event) => setRelated(index, { href: event.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onChange({
                    ...draft,
                    relatedSearches: draft.relatedSearches.filter((_, i) => i !== index),
                  })
                }
              >
                {t("action.remove")}
              </Button>
            </li>
          ))}
        </ol>
        {draft.relatedSearches.length < MAX_RELATED_SEARCHES && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange({
                ...draft,
                relatedSearches: [...draft.relatedSearches, { label: "", href: "" }],
              })
            }
          >
            {t("matrix.related_add")}
          </Button>
        )}
        <p className="mt-2 max-w-prose text-caption text-muted">{t("matrix.related_hint")}</p>
      </section>
    </>
  );
}
