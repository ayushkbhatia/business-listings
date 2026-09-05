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
 * Board 6a on board 6f's screen.
 *
 * The three numbers, then the two decisions. Publish is disabled where the
 * floors do not hold — but the service refuses it as well, and that refusal is
 * the enforcement. This is the courtesy.
 */

const MIN_REASON = 4;

export interface AreaRowView {
  areaId: string;
  categoryId: string;
  path: string;
  areaName: string;
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

export function AreaTable({
  rows,
  save,
  publish,
  unpublish,
}: {
  rows: readonly AreaRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  unpublish: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<AreaRowView | null>(null);
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

  function edit(row: AreaRowView) {
    setOpen(row);
    setIntro(row.intro);
    setContent(row.content);
    setReason("");
    setResult(null);
  }

  function send(action: (formData: FormData) => Promise<ActionResult>) {
    if (!open) return;
    const form = new FormData();
    form.set("areaId", open.areaId);
    form.set("categoryId", open.categoryId);
    form.set("path", open.path);
    form.set("intro", intro);
    form.set("metaDescription", content.metaDescription);
    /*
       The repeatable rows as JSON in one field. A `FormData` cannot carry a
       list of objects without either hand-parsed indexed keys or this, and one
       parse behind a type guard on the server is the version where a malformed
       submission is one refusal rather than a half-applied write.
    */
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

  const columns: Column<AreaRowView>[] = [
    { key: "area", header: t("matrix.col.area"), render: (row) => row.areaName },
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
      header: t("matrix.col.state"),
      render: (row) => (
        <Button variant="ghost" size="sm" onClick={() => edit(row)}>
          {t("matrix.write", { page: `${row.categoryName}, ${row.areaName}` })}
        </Button>
      ),
    },
  ];

  return (
    <div className="mt-[var(--gutter)]">
      <DataTable
        caption={t("matrix.area_caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.areaId}-${row.categoryId}`}
        empty={t("matrix.empty")}
      />

      {open && (
        <Panel
          title={`${open.categoryName}, ${open.areaName}`}
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
            <Label htmlFor="area-intro">{t("matrix.intro")}</Label>
            <Textarea
              id="area-intro"
              rows={10}
              value={intro}
              onChange={(event) => setIntro(event.target.value)}
            />
            <p className="mt-1 text-caption text-muted">{t("matrix.intro_hint")}</p>
          </div>

          <LandingContentFields
            draft={content}
            onChange={setContent}
            idPrefix={`area-${open.areaId}-${open.categoryId}`}
          />

          <div className="mt-6">
            <Label htmlFor="area-reason">{t("guide_admin.field.reason")}</Label>
            <Textarea
              id="area-reason"
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
