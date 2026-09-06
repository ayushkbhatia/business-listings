"use client";

import { useState } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import type { MatrixGate } from "@/lib/content/matrix";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";
import {
  LandingContentFields,
  type LandingContentDraft,
} from "./LandingContentFields";

/**
 * Board 6c's emirate pages on board 6f's screen.
 *
 * `AreaTable`'s twin, and deliberately identical to work: the two page types
 * differ in what they are about, not in how a writer publishes one. The three
 * numbers, then the two decisions. Publish is disabled where the floors do not
 * hold — but the service refuses it as well, and that refusal is the
 * enforcement. This is the courtesy.
 *
 * Every (emirate, sector) pair is listed, including the eighty-odd nobody has
 * written yet, because those are the work.
 */

const MIN_REASON = 4;

export interface EmirateRowView {
  emirate: string;
  emirateName: string;
  categoryId: string;
  path: string;
  categoryName: string;
  listings: string;
  verifiedShare: string;
  introWords: number;
  intro: string;
  published: boolean;
  live: boolean;
  clearsFloors: boolean;
  failing: MatrixGate[];
  /** Board 6a's other three content records, as stored. */
  content: LandingContentDraft;
}

export function EmirateTable({
  rows,
  save,
  publish,
  unpublish,
}: {
  rows: readonly EmirateRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  unpublish: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<EmirateRowView | null>(null);
  const [intro, setIntro] = useState("");
  const [content, setContent] = useState<LandingContentDraft>({
    metaDescription: "",
    faq: [],
    relatedSearches: [],
  });
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);

  const ready = reason.trim().length >= MIN_REASON;

  function edit(row: EmirateRowView) {
    setOpen(row);
    setIntro(row.intro);
    setContent(row.content);
    setReason("");
    setResult(null);
  }

  function send(action: (formData: FormData) => Promise<ActionResult>) {
    if (!open) return;
    const form = new FormData();
    form.set("emirate", open.emirate);
    form.set("categoryId", open.categoryId);
    form.set("path", open.path);
    form.set("intro", intro);
    form.set("metaDescription", content.metaDescription);
    form.set("faq", JSON.stringify(content.faq));
    form.set("relatedSearches", JSON.stringify(content.relatedSearches));
    form.set("reason", reason);

    void (async () => {
      setPending(true);
      try {
        const outcome = await action(form);
        setResult(outcome);
        if (outcome.ok) setReason("");
      } finally {
        setPending(false);
      }
    })();
  }

  const columns: Column<EmirateRowView>[] = [
    { key: "emirate", header: t("matrix.col.emirate"), render: (row) => row.emirateName },
    { key: "trade", header: t("home.col.trade"), render: (row) => row.categoryName },
    { key: "path", header: t("matrix.col.path"), mono: true, render: (row) => row.path },
    { key: "listings", header: t("matrix.col.listings"), numeric: true, render: (row) => row.listings },
    { key: "verified", header: t("matrix.col.verified"), numeric: true, render: (row) => row.verifiedShare },
    { key: "words", header: t("matrix.col.words"), numeric: true, render: (row) => String(row.introWords) },
    {
      key: "live",
      header: t("matrix.col.live"),
      render: (row) => (
        <StatusBadge tone={row.live ? "ok" : "neutral"}>
          {row.live ? t("matrix.live_yes") : t("matrix.live_held")}
        </StatusBadge>
      ),
    },
    {
      key: "act",
      // Not "State": the row already carries one, three columns to the left.
      // This one holds a button.
      header: t("matrix.col.edit"),
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => edit(row)}>
          {t("matrix.write", { page: `${row.categoryName}, ${row.emirateName}` })}
        </Button>
      ),
    },
  ];

  return (
    <div className="mt-[var(--gutter)]">
      <DataTable
        caption={t("matrix.emirate_caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.emirate}-${row.categoryId}`}
        empty={t("matrix.empty")}
      />

      {open && (
        <Panel
          title={`${open.categoryName}, ${open.emirateName}`}
          actions={
            <span className="text-caption text-muted">
              {t("matrix.word_count", { count: intro.trim().split(/\s+/).filter(Boolean).length })}
            </span>
          }
        >
          {result && (
            <Alert tone={result.ok ? "ok" : "bad"}>
              {result.ok ? result.message : result.error}
            </Alert>
          )}

          <div className="mt-3">
            <Label htmlFor="emirate-intro">{t("matrix.intro")}</Label>
            <Textarea
              id="emirate-intro"
              rows={10}
              value={intro}
              onChange={(event) => setIntro(event.target.value)}
            />
            <p className="mt-1 text-caption text-muted">{t("matrix.intro_hint")}</p>
          </div>

          <LandingContentFields
            draft={content}
            onChange={setContent}
            idPrefix={`emirate-${open.emirate}-${open.categoryId}`}
          />

          <div className="mt-4">
                          {/*
                 The same label the other two editors on this page use.

                 `/admin/content/matrix` carries four controls that write an
                 audited reason — this table, the emirate table, the matrix
                 table and the rules panel — and two of them called the field
                 "Why" while two called it "Reason". One screen, one contract,
                 two names for it. `builder.reason_label` is what the rest of
                 the console uses and what the design system names.
              */}
              <Label htmlFor="emirate-reason">{t("builder.reason_label")}</Label>
            <Textarea
              id="emirate-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button onClick={() => send(save)} disabled={!ready || pending}>
              {t("action.save")}
            </Button>
            {open.published ? (
              <Button variant="secondary" onClick={() => send(unpublish)} disabled={!ready || pending}>
                {t("guide_admin.unpublish")}
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => send(publish)}
                // The floors, said in the disabled state as well as in the
                // refusal — a button that looks live and then refuses is worse
                // than one that says why up front.
                disabled={!ready || pending || !open.clearsFloors}
              >
                {t("guide_admin.publish")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={pending}>
              {t("action.cancel")}
            </Button>
          </div>

          {!open.clearsFloors && (
            <p className="mt-3 max-w-prose text-caption text-muted">
              {t("matrix.blocked_by", {
                /*
                   Translated, not joined raw. This printed the gate keys
                   themselves — "copy, listings" here and "intro_words,
                   faq_scope_specific" on the sibling table below, two
                   vocabularies for one rule and neither of them English.
                */
                gates: open.failing.map((gate) => t(`matrix.gate.${gate}` as never)).join(", "),
              })}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}
