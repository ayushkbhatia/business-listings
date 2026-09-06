"use client";

import { useState } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import type { MatrixGate } from "@/lib/content/matrix";
import type { PageStatus } from "@/lib/content/status";
import { formatCount } from "@/lib/format";
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

/**
 * Tone is a second signal, never the only one — criterion 17.
 *
 * `recruit` and `held_supply` are both "below need" and route to different
 * teams, so the label does the work and the colour only agrees with it.
 */
const STATUS_TONE: Record<PageStatus, "ok" | "warn" | "bad" | "neutral"> = {
  live: "ok",
  live_thin_copy: "warn",
  queued_copy: "warn",
  recruit: "bad",
  held_supply: "neutral",
  held_editorial: "neutral",
};

export interface AreaRowView {
  areaId: string;
  categoryId: string;
  emirate: string;
  path: string;
  areaName: string;
  categoryName: string;
  listings: number;
  /** The higher of the two floors — board 6f's `have / need`. */
  need: number;
  needBasis: "absolute" | "demand";
  /** The absolute floor, so the tooltip can say which rule set the need. */
  absoluteFloor: number;
  shortfall: number;
  verifiedShare: string;
  /** Null renders an em dash. Missing volume and zero volume are opposites. */
  monthlySearches: number | null;
  demandSource: string;
  demandCapturedAt: string;
  introWords: number;
  intro: string;
  published: boolean;
  live: boolean;
  clearsFloors: boolean;
  heldAt: string | null;
  heldReason: string | null;
  status: PageStatus;
  failing: MatrixGate[];
  /** Board 6a's other three content records, as stored. */
  content: LandingContentDraft;
}

export function AreaTable({
  rows,
  save,
  publish,
  unpublish,
  hold,
  release,
  saveDemand,
}: {
  rows: readonly AreaRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  unpublish: (formData: FormData) => Promise<ActionResult>;
  hold: (formData: FormData) => Promise<ActionResult>;
  release: (formData: FormData) => Promise<ActionResult>;
  saveDemand: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<AreaRowView | null>(null);
  const [intro, setIntro] = useState("");
  const [content, setContent] = useState<LandingContentDraft>({
    metaDescription: "",
    faq: [],
    relatedSearches: [],
  });
  const [reason, setReason] = useState("");
  const [searches, setSearches] = useState("");
  const [source, setSource] = useState("");
  const [captured, setCaptured] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, setPending] = useState(false);

  const ready = reason.trim().length >= MIN_REASON;

  function edit(row: AreaRowView) {
    setOpen(row);
    setIntro(row.intro);
    setContent(row.content);
    setReason("");
    setSearches(row.monthlySearches === null ? "" : String(row.monthlySearches));
    setSource(row.demandSource);
    setCaptured(row.demandCapturedAt);
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
    form.set("emirate", open.emirate);
    form.set("monthlySearches", searches);
    form.set("source", source);
    form.set("capturedAt", captured);
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
    {
      key: "page",
      header: t("matrix.col.page"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-body-sm text-ink">
            {row.areaName}, {row.categoryName}
          </span>
          <span className="font-mono text-eyebrow text-muted">{row.path}</span>
        </span>
      ),
    },
    {
      key: "have_need",
      header: t("matrix.col.have_need"),
      numeric: true,
      /*
         One column, so the arithmetic is visible rather than implied. The
         board held a page with 78 listings on the correct reasoning that 78
         against 3,940 searches produces a page that ranks and disappoints —
         and a flat floor cannot express that, so the need is the higher of the
         two rules and the title says which one set it.
      */
      render: (row) => (
        <span
          className={row.shortfall > 0 ? "text-bad-ink" : "text-ink"}
          title={
            row.needBasis === "demand"
              ? t("matrix.need_demand", {
                  need: String(row.need),
                  absolute: String(row.absoluteFloor),
                })
              : t("matrix.need_absolute", { need: String(row.need) })
          }
        >
          {formatCount(row.listings)} / {formatCount(row.need)}
        </span>
      ),
    },
    {
      key: "searches",
      header: t("matrix.col.searches"),
      numeric: true,
      // An em dash, never a nought. §States: missing volume and zero volume
      // produce opposite decisions.
      render: (row) =>
        row.monthlySearches === null ? "—" : formatCount(row.monthlySearches),
    },
    {
      key: "sessions",
      header: t("matrix.col.sessions"),
      numeric: true,
      hideBelow: "lg",
      // Nothing in this product records organic sessions. The column is drawn
      // because the board draws it and because leaving it out would hide that
      // the ordering's tie-break has no data behind it.
      render: () => "—",
    },
    {
      key: "verified",
      header: t("matrix.col.verified"),
      numeric: true,
      hideBelow: "lg",
      render: (row) => row.verifiedShare,
    },
    {
      key: "words",
      header: t("matrix.col.words"),
      numeric: true,
      render: (row) => String(row.introWords),
    },
    {
      key: "status",
      header: t("matrix.col.status"),
      width: "12rem",
      /*
         Every pill carries its label — criterion 17. Tone is a second signal,
         never the only one: `Recruit` and `Held · thin supply` are both "below
         need" and route to different teams, so a reader who cannot separate
         amber from grey still reads which.
      */
      render: (row) => (
        <StatusBadge tone={STATUS_TONE[row.status]}>
          {row.status === "recruit"
            ? t("matrix.status.recruit", { count: String(row.shortfall) })
            : t(`matrix.status.${row.status}` as never)}
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
          {t("matrix.write", { page: `${row.categoryName}, ${row.areaName}` })}
        </Button>
      ),
    },
  ];

  return (
    <div className="mt-[var(--gutter)]">
      <DataTable
        caption={t("matrix.rows_caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => `${row.areaId}-${row.categoryId}`}
        empty={t("matrix.rows_empty")}
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

          {/*
             The recorded search volume, with where it came from and when it
             was true. A keyword figure raises this scope's floor, so it does
             not get to be a bare number on an admin screen that nobody can
             check.
          */}
          <fieldset className="mt-6 grid gap-3 sm:grid-cols-3">
            <legend className="mb-1 font-mono text-eyebrow uppercase text-muted">
              {t("matrix.demand")}
            </legend>
            <div className="flex flex-col gap-1">
              <Label htmlFor="area-searches">{t("matrix.demand")}</Label>
              <Input
                id="area-searches"
                type="number"
                min="0"
                step="10"
                value={searches}
                onChange={(event) => setSearches(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="area-source">{t("matrix.demand_source")}</Label>
              <Input
                id="area-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="area-captured">{t("matrix.demand_captured")}</Label>
              <Input
                id="area-captured"
                type="date"
                value={captured}
                onChange={(event) => setCaptured(event.target.value)}
              />
            </div>
            <p className="text-caption text-muted sm:col-span-3">{t("matrix.demand_hint")}</p>
          </fieldset>

          <div className="mt-6">
                          {/*
                 The same label the other two editors on this page use.

                 `/admin/content/matrix` carries four controls that write an
                 audited reason — this table, the emirate table, the matrix
                 table and the rules panel — and two of them called the field
                 "Why" while two called it "Reason". One screen, one contract,
                 two names for it. `builder.reason_label` is what the rest of
                 the console uses and what the design system names.
              */}
              <Label htmlFor="area-reason">{t("builder.reason_label")}</Label>
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
            <Button
              variant="secondary"
              onClick={() => send(saveDemand)}
              disabled={!ready || pending || searches.trim() === "" || source.trim() === ""}
            >
              {t("matrix.demand")}
            </Button>
            {/*
               `Held · editorial`. A person's no, and only a person's yes takes
               it away — lifting the hold restores the arithmetic rather than
               publishing the page.
            */}
            {open.heldAt ? (
              <Button variant="ghost" onClick={() => send(release)} disabled={!ready || pending}>
                {t("matrix.release")}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => send(hold)} disabled={!ready || pending}>
                {t("matrix.hold")}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(null)} disabled={pending}>
              {t("action.cancel")}
            </Button>
          </div>

          {open.heldAt && (
            <p className="mt-3 max-w-prose text-caption text-muted">
              {t("matrix.held_by", { date: open.heldAt, reason: open.heldReason ?? "" })}
            </p>
          )}
          <p className="mt-1 max-w-prose text-caption text-muted">{t("matrix.hold_hint")}</p>

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
