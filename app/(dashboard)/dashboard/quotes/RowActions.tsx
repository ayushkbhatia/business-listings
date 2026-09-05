"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Button, Input, Textarea, buttonClassName } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { emitEvent } from "@/components/telemetry";
import { extendQuoteAction, nudgeFromPipelineAction } from "./actions";

/**
 * Board 3k §6 — what a row offers, and the two dialogs behind it.
 *
 * Every string arrives already translated. Nothing here calls `t()` and nothing
 * imports from `_shell.tsx`, which is `server-only` — a type import alone fails
 * the build, and this repo's most repeated defect is a function crossing that
 * boundary.
 *
 * ## The follow-up is not shown once it is spent
 *
 * §6: "Once spent, the action is not shown here at all — a disabled button the
 * seller keeps clicking teaches nothing." The row falls back to `Revise`, which
 * is the thing that is still worth doing.
 *
 * ## Neither dialog composes
 *
 * Extend moves a date. The follow-up sends words the seller types. Neither is a
 * price input: `Revise` and `Re-quote` are links into board 3j's composer,
 * because this screen never becomes a second place where money is entered.
 */

/**
 * One preset, resolved on the server.
 *
 * `{ days, label, iso }` rather than a `label(days)` function, and that is not a
 * style preference: a function cannot cross from a server component to a client
 * one, and this file learned it the way the repo keeps learning it — a runtime
 * error naming the whole labels object. Every label here is a finished string.
 */
export interface ExtendPreset {
  days: number;
  label: string;
  /** The date this preset lands on, from the window's current end. */
  iso: string;
}

export interface RowActionsLabels {
  extend: string;
  nudge: string;
  revise: string;
  view: string;
  requote: string;
  /** Each action's accessible name, already carrying the reference. */
  ariaExtend: string;
  ariaNudge: string;
  ariaRevise: string;
  ariaView: string;
  ariaRequote: string;

  extendTitle: string;
  extendBody: string;
  extendCurrent: string;
  extendPick: string;
  extendPickLabel: string;
  extendCeiling: string;
  extendConfirm: string;
  extendCancel: string;
  extendClose: string;
  extendCount: string | null;

  nudgeTitle: string;
  nudgeBody: string;
  nudgeLabel: string;
  nudgePlaceholder: string;
  nudgeConfirm: string;
  nudgeCap: string;
}

export interface RowActionsProps {
  quoteId: string;
  enquiryId: string;
  /**
   * Named `quoteRef`, not `ref`.
   *
   * `ref` is React's own prop: passing one hands the component a ref object
   * rather than a string, and reading it during render is an error the linter
   * catches — which it did, five times, before this was renamed.
   */
  quoteRef: string;
  state: "awaiting" | "won" | "lost" | "expired";
  followUpSpent: boolean;
  /** False once the enquiry closed: there is nothing left to re-quote against. */
  enquiryOpen: boolean;
  /** ISO dates. The picker owns the input; the service owns the ceiling. */
  expiresAt: string | null;
  ceiling: string;
  presets: readonly ExtendPreset[];
  daysRemaining: number | null;
  daysSinceExpiry: number | null;
  /** Set by the `/dashboard/quotes/:ref/extend` deep link. */
  openExtend?: boolean;
  labels: RowActionsLabels;
}

export function RowActions({
  quoteId,
  enquiryId,
  quoteRef,
  state,
  followUpSpent,
  enquiryOpen,
  expiresAt,
  ceiling,
  presets,
  daysRemaining,
  daysSinceExpiry,
  openExtend = false,
  labels,
}: RowActionsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [extendOpen, setExtendOpen] = useState(openExtend);
  const [nudgeOpen, setNudgeOpen] = useState(false);
  const [chosen, setChosen] = useState(presets[0]?.iso ?? "");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  /*
     The deep link `/dashboard/quotes/:ref/extend` is board 3a's queue action,
     and it lands with the dialog already open. Emitted here rather than on the
     server so the source is the surface the seller actually came from.
  */
  useEffect(() => {
    if (openExtend) {
      emitEvent("extend_opened_from", {
        source: "queue",
        ...(daysRemaining !== null ? { daysRemaining } : {}),
      });
    }
  }, [openExtend, daysRemaining]);

  function openExtendDialog(source: string) {
    setError(null);
    setChosen(presets[0]?.iso ?? "");
    setExtendOpen(true);
    emitEvent("extend_opened_from", {
      source,
      ...(daysRemaining !== null ? { daysRemaining } : {}),
    });
  }

  function run(work: () => Promise<{ ok: boolean; error?: string }>, close: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        close();
        router.refresh();
      } else {
        setError(result.error ?? null);
      }
    });
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-1.5">
      {state === "awaiting" ? (
        <>
          {followUpSpent ? (
            <Link
              href={`/dashboard/leads/${enquiryId}`}
              onClick={() => emitEvent("revision_started", { source: "pipeline" })}
              aria-label={labels.ariaRevise}
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {labels.revise}
            </Link>
          ) : (
            <Button
              type="button"
              size="sm"
              aria-label={labels.ariaNudge}
              onClick={() => {
                setError(null);
                setNudgeOpen(true);
              }}
            >
              {labels.nudge}
            </Button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-label={labels.ariaExtend}
            onClick={() => openExtendDialog("table")}
          >
            {labels.extend}
          </Button>
        </>
      ) : state === "expired" && enquiryOpen ? (
        <Link
          href={`/dashboard/leads/${enquiryId}`}
          onClick={() =>
            emitEvent("requote_started", {
              ...(daysSinceExpiry !== null ? { daysSinceExpiry } : {}),
            })
          }
          aria-label={labels.ariaRequote}
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {labels.requote}
        </Link>
      ) : (
        <Link
          href={`/dashboard/leads/${enquiryId}/thread`}
          aria-label={labels.ariaView}
          className={buttonClassName({ variant: "ghost", size: "sm" })}
        >
          {labels.view}
        </Link>
      )}

      {/*
         Mounted only while open.

         Both dialogs are per row, so a page of twenty-five quotes was carrying
         fifty `<dialog>` elements — hidden from assistive technology by the
         native element, but still fifty subtrees in the DOM and fifty buttons
         reading "Extend it" to anything that walks it raw.
      */}
      {extendOpen ? (
      <Modal
        open={extendOpen}
        onClose={() => setExtendOpen(false)}
        title={labels.extendTitle}
        description={labels.extendBody}
        closeLabel={labels.extendClose}
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setExtendOpen(false)}>
              {labels.extendCancel}
            </Button>
            <Button
              type="button"
              loading={pending}
              disabled={chosen === ""}
              onClick={() =>
                run(() => extendQuoteAction({ quoteId, until: chosen }), () =>
                  setExtendOpen(false),
                )
              }
            >
              {labels.extendConfirm}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {expiresAt ? <p className="text-body-sm text-ink">{labels.extendCurrent}</p> : null}
          {labels.extendCount ? (
            <p className="text-caption text-warn-ink">{labels.extendCount}</p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.days}
                type="button"
                variant={chosen === preset.iso ? "primary" : "secondary"}
                size="sm"
                onClick={() => setChosen(preset.iso)}
              >
                {preset.label}
              </Button>
            ))}
          </div>

          <label className="block space-y-1.5">
            <span className="block text-body-sm text-ink">{labels.extendPick}</span>
            <Input
              type="date"
              aria-label={labels.extendPickLabel}
              value={chosen.slice(0, 10)}
              max={ceiling.slice(0, 10)}
              {...(expiresAt ? { min: expiresAt.slice(0, 10) } : {})}
              onChange={(event) =>
                setChosen(event.target.value ? new Date(event.target.value).toISOString() : "")
              }
            />
          </label>

          <p className="max-w-[var(--measure-prose)] text-caption text-muted">
            {labels.extendCeiling}
          </p>

          {error ? (
            <p role="alert" className="text-caption text-bad-ink">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
      ) : null}

      {nudgeOpen ? (
      <Modal
        open={nudgeOpen}
        onClose={() => setNudgeOpen(false)}
        title={labels.nudgeTitle}
        description={labels.nudgeBody}
        closeLabel={labels.extendClose}
        size="sm"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setNudgeOpen(false)}>
              {labels.extendCancel}
            </Button>
            <Button
              type="button"
              loading={pending}
              disabled={body.trim() === ""}
              onClick={() =>
                run(() => nudgeFromPipelineAction({ enquiryId, body }), () => setNudgeOpen(false))
              }
            >
              {labels.nudgeConfirm}
            </Button>
          </>
        }
      >
        <div className="space-y-2">
          <label className="block space-y-1.5">
            <span className="block text-body-sm text-ink">{labels.nudgeLabel}</span>
            <Textarea
              rows={3}
              placeholder={labels.nudgePlaceholder}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <p className="max-w-[var(--measure-prose)] text-caption text-muted">{labels.nudgeCap}</p>
          {error ? (
            <p role="alert" className="text-caption text-bad-ink">
              {error}
            </p>
          ) : null}
        </div>
      </Modal>
      ) : null}
    </span>
  );
}
