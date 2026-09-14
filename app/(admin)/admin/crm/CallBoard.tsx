"use client";

import { useId, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Alert, PlanBadge } from "@/components/display";
import { Button } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { cn } from "@/lib/cn";
import { CALL_OUTCOMES } from "@/lib/crm/model";
import { t, type MessageKey } from "@/lib/i18n";
import { logCallAction, releaseTaskAction, revealContactAction } from "./actions";
import type { CallRowView, Tone } from "./present";

/**
 * Board 12d — the list, the log strip and the script, as one piece of state.
 *
 * Selecting a row is choosing who the strip logs against and which script the
 * rail shows. The row's action reveals the number — a logged event, and it
 * takes the row — and selects it. There is no control anywhere in here that
 * adds a business to the list (B1), and none that edits a row's reason or its
 * place in the order (B2): the two things a person does are ring and record.
 *
 * Every string arrives written by `present.ts`; this component decides layout
 * and nothing about what a number means.
 */

const TONE: Record<Tone, string> = {
  bad: "text-bad-ink",
  warn: "text-warn-ink",
  ok: "text-ok-ink",
  neutral: "text-body",
};

export interface CallBoardProps {
  rows: readonly CallRowView[];
  caption: string;
  /** The rail cards above the script, rendered by the page. */
  rail: React.ReactNode;
  listHeader: React.ReactNode;
  empty: React.ReactNode;
}

export function CallBoard({ rows, caption, rail, listHeader, empty }: CallBoardProps) {
  const [chosenId, setSelectedId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<string, { display: string; tel: string }>>({});
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [callBackOn, setCallBackOn] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { legend: useId(), note: useId(), date: useId() };

  /*
     The row the strip logs against: the one chosen, while it is still on the
     list, and otherwise the first due call. Derived rather than stored, so a
     refresh that brings rows in, or a logged ending that takes one out, never
     leaves the strip pointing at nothing or at a row that has gone.
  */
  const selected = useMemo(
    () => rows.find((row) => row.id === chosenId) ?? rows.find((row) => row.due) ?? rows[0] ?? null,
    [rows, chosenId],
  );
  const selectedId = selected?.id ?? null;

  function reveal(row: CallRowView) {
    setSelectedId(row.id);
    setResult(null);
    setRowError(null);
    startTransition(async () => {
      const response = await revealContactAction(row.id);
      if (response.ok) setRevealed((current) => ({ ...current, [row.id]: { display: response.display, tel: response.tel } }));
      else setRowError({ id: row.id, message: response.error });
    });
  }

  function submit() {
    if (!selected) return;
    const form = new FormData();
    form.set("outcome", outcome);
    form.set("note", note);
    if (outcome === "call_back") form.set("callBackOn", callBackOn);
    form.set("taskId", selected.id);
    form.set("businessName", selected.businessName);
    startTransition(async () => {
      const response = await logCallAction(form);
      if (response.ok) {
        setResult({ ok: true, message: response.message });
        setOutcome("");
        setNote("");
        setCallBackOn("");
      } else {
        setResult({ ok: false, message: response.error });
      }
    });
  }

  function handBack(row: CallRowView) {
    startTransition(async () => {
      const response = await releaseTaskAction(row.id);
      if (!response.ok) setResult({ ok: false, message: response.error });
    });
  }

  const columns: Column<CallRowView>[] = [
    {
      key: "business",
      header: t("admin.crm.col.business"),
      render: (row) => (
        <div className="min-w-0">
          <Link
            href={row.businessHref}
            onClick={(event) => event.stopPropagation()}
            className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {row.businessName}
          </Link>
          <p className="mt-0.5 font-mono text-eyebrow text-muted">
            <span className="uppercase">{row.meta}</span>
            {revealed[row.id] ? (
              <>
                {" · "}
                <a href={`tel:${revealed[row.id]!.tel}`} className="text-ink underline underline-offset-2">
                  {revealed[row.id]!.display}
                </a>
              </>
            ) : row.phoneMasked ? (
              <>{` · ${row.phoneMasked}`}</>
            ) : null}
          </p>
          {rowError?.id === row.id ? <p className="mt-1 text-caption text-bad-ink">{rowError.message}</p> : null}
        </div>
      ),
    },
    {
      key: "why",
      header: t("admin.crm.col.why"),
      width: "13rem",
      render: (row) => <span className={cn("text-body-sm", TONE[row.whyTone])}>{row.why}</span>,
    },
    {
      key: "listing",
      header: t("admin.crm.col.listing"),
      width: "8rem",
      hideBelow: "md",
      render: (row) =>
        row.listing.plan ? (
          <PlanBadge plan={row.listing.plan} label={row.listing.label} size="sm" />
        ) : (
          <span className="inline-flex rounded-chip bg-fill px-2 py-0.5 text-caption text-body">{row.listing.label}</span>
        ),
    },
    {
      key: "touch",
      header: t("admin.crm.col.last_touch"),
      width: "11rem",
      hideBelow: "lg",
      render: (row) => <span className={cn("text-body-sm", TONE[row.lastTouchTone])}>{row.lastTouch}</span>,
    },
    {
      key: "action",
      header: t("admin.crm.col.action"),
      width: "7.5rem",
      render: (row) => (
        <Button
          size="sm"
          variant={row.action.variant}
          disabled={pending}
          aria-label={t("admin.crm.action_named", { action: row.action.label, name: row.businessName })}
          onClick={(event) => {
            event.stopPropagation();
            reveal(row);
          }}
        >
          {row.action.label}
        </Button>
      ),
    },
  ];

  return (
    <div className="grid gap-[var(--gutter)] lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
        <div className="rounded-panel border border-line bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">{listHeader}</div>
          <DataTable
            caption={caption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowTone={(row) => (row.id === selectedId ? "selected" : "default")}
            onRowClick={(row) => {
              setSelectedId(row.id);
              setResult(null);
            }}
            empty={empty}
          />
        </div>

        <div className="rounded-panel border border-line bg-card p-4">
          {/*
             A fieldset, not a form. A form is a landmark once named and a
             duplicate when not, and there is nothing here a browser needs to
             submit without script: the strip is state, sent by the button.
          */}
          <div>
            <fieldset disabled={!selected || pending} className="m-0 min-w-0 border-0 p-0">
              <legend id={ids.legend} className="font-mono text-eyebrow uppercase text-faint">
                {t("admin.crm.log.legend")}
              </legend>
              <p className="mt-1 text-body-sm text-body">
                {selected ? t("admin.crm.log.for", { name: selected.businessName }) : t("admin.crm.log.pick_row")}
              </p>

              <div role="radiogroup" aria-label={t("admin.crm.log.legend")} className="mt-3 flex flex-wrap gap-2">
                {CALL_OUTCOMES.map((key) => (
                  <label
                    key={key}
                    className={cn(
                      "relative inline-flex h-9 cursor-pointer items-center rounded-ctl border px-3.5 text-body-sm",
                      "has-[:focus-visible]:shadow-focus",
                      outcome === key ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-card text-ink hover:bg-fill",
                    )}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value={key}
                      checked={outcome === key}
                      onChange={() => setOutcome(key)}
                      className="sr-only"
                    />
                    {t(`crm.outcome.${key}` as MessageKey)}
                  </label>
                ))}
              </div>

              {outcome === "call_back" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label htmlFor={ids.date} className="text-body-sm text-body">
                    {t("admin.crm.log.call_back_on")}
                  </label>
                  <input
                    id={ids.date}
                    name="callBackOn"
                    type="date"
                    required
                    value={callBackOn}
                    onChange={(event) => setCallBackOn(event.target.value)}
                    className="h-9 rounded-ctl border border-line-strong bg-card px-2 text-body-sm text-ink focus-visible:shadow-focus focus-visible:outline-none"
                  />
                </div>
              ) : null}

              <label htmlFor={ids.note} className="sr-only">
                {t("admin.crm.log.note")}
              </label>
              <textarea
                id={ids.note}
                name="note"
                rows={2}
                maxLength={2000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={t("admin.crm.log.note_placeholder")}
                className="mt-3 block w-full rounded-ctl border border-line-strong bg-paper px-3 py-2 text-body-sm text-ink placeholder:text-faint focus-visible:shadow-focus focus-visible:outline-none"
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button onClick={submit} disabled={!outcome || (outcome === "call_back" && !callBackOn)}>
                  {t("admin.crm.log.submit")}
                </Button>
                {selected?.mine ? (
                  <Button variant="ghost" onClick={() => handBack(selected)}>
                    {t("admin.crm.hand_back")}
                  </Button>
                ) : null}
              </div>
            </fieldset>
          </div>
          {result ? (
            <div className="mt-3">
              <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
                {result.message}
              </Alert>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-[var(--gutter)]">
        {rail}
        <div className="rounded-panel border border-line bg-card p-4">
          <h2 className="font-mono text-eyebrow font-normal uppercase text-faint">{t("admin.crm.script.title")}</h2>
          {selected ? (
            <>
              <p className="mt-2 text-body text-ink">{selected.script.text}</p>
              <p className="mt-3 text-caption text-muted">{selected.script.record}</p>
            </>
          ) : (
            <p className="mt-2 text-body-sm text-body" aria-live="polite">{t("admin.crm.script.pick_row")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
