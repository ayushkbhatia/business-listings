"use client";

import { useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { PreviewState } from "@/lib/search/settings";
import type { ActionResult } from "./actions";

/**
 * Save, preview, publish — as three steps rather than one button.
 *
 * There was no publish on this screen. `saveWeights` wrote straight to the live
 * row and the copy said so: *"Saved. Search results reorder on the next
 * request."* The control that reorders every result on the platform and puts a
 * sentence on several hundred seller dashboards was the same control as the one
 * that types a number into a box.
 *
 * Step 2 is the reason step 3 can state a count. The preview is stored against
 * the exact draft it describes, so `stale` is a comparison rather than a timer:
 * the draft moving is the only thing that can invalidate it, and a count from a
 * superseded draft is worse than no count at all.
 *
 * `Discard draft` sits beside publish because a draft that cannot be abandoned
 * is a draft nobody will risk making.
 */

export interface PublishStripProps {
  hasDraft: boolean;
  /** "Reply time 18 → 24, relevance 34 → 28", already localised. */
  draftSummary: string | null;
  draftAuthor: string | null;
  draftWhen: string | null;
  previewState: PreviewState;
  previewWhen: string | null;
  /** "4 categories move, 180 listings", already localised. Null until fresh. */
  previewSummary: string | null;
  /** "431 sellers", already localised. Null until fresh. */
  sellerCount: string | null;
  mayWrite: boolean;
  runPreview: () => Promise<ActionResult>;
  publish: (formData: FormData) => Promise<ActionResult>;
  discard: (formData: FormData) => Promise<ActionResult>;
}

type Tone = "done" | "current" | "waiting" | "blocked";

function Step({
  index,
  tone,
  title,
  body,
  badge,
}: {
  index: number;
  tone: Tone;
  title: string;
  body: string;
  badge?: { label: string; tone: "ok" | "warn" | "neutral" };
}) {
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-pill font-mono text-eyebrow tabular-nums",
          tone === "done" && "bg-moss text-on-ink",
          tone === "current" && "border-[1.5px] border-moss bg-card text-ink",
          tone === "waiting" && "border border-line bg-card text-body",
          tone === "blocked" && "border border-line bg-fill text-body",
        )}
      >
        {tone === "done" ? <Check size={11} /> : index}
      </span>

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-caption font-medium text-ink">
          {title}
          {badge && <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge>}
        </p>
        <p className="mt-0.5 text-caption text-body">{body}</p>
      </div>
    </div>
  );
}

export function PublishStrip({
  hasDraft,
  draftSummary,
  draftAuthor,
  draftWhen,
  previewState,
  previewWhen,
  previewSummary,
  sellerCount,
  mayWrite,
  runPreview,
  publish,
  discard,
}: PublishStripProps) {
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const canPublish = hasDraft && previewState === "fresh" && sellerCount !== null;
  const ready = reason.trim().length >= 4;

  function run(action: () => Promise<ActionResult>, clearReason: boolean) {
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok && clearReason) setReason("");
    });
  }

  function withReason(action: (formData: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("reason", reason);
    run(() => action(form), true);
  }

  const previewBadge =
    previewState === "fresh" && previewWhen
      ? { label: t("ranking.step.preview_fresh", { when: previewWhen }), tone: "ok" as const }
      : previewState === "stale"
        ? { label: t("ranking.step.preview_stale"), tone: "warn" as const }
        : previewState === "running"
          ? { label: t("ranking.step.preview_running"), tone: "neutral" as const }
          : { label: t("ranking.step.preview_none"), tone: "neutral" as const };

  return (
    <section
      aria-label={t("ranking.step.publish")}
      className="rounded-panel border border-line bg-card p-4"
    >
      {result && (
        <div className="mb-3">
          <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
            {result.ok ? result.message : result.error}
          </Alert>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Step
          index={1}
          tone={hasDraft ? "done" : "waiting"}
          title={hasDraft ? t("ranking.step.draft") : t("ranking.step.draft_none")}
          body={
            hasDraft && draftSummary && draftAuthor && draftWhen
              ? `${t("ranking.step.draft_body", { moved: draftSummary, author: draftAuthor, when: draftWhen })} ${t("ranking.step.draft_unchanged")}`
              : t("ranking.step.draft_none_body")
          }
        />

        <Step
          index={2}
          tone={
            !hasDraft
              ? "blocked"
              : previewState === "fresh"
                ? "done"
                : previewState === "running"
                  ? "current"
                  : "waiting"
          }
          title={t("ranking.step.preview")}
          badge={hasDraft ? previewBadge : undefined}
          body={
            !hasDraft
              ? t("ranking.step.preview_none_body")
              : previewState === "fresh" && previewSummary
                ? previewSummary
                : previewState === "running"
                  ? t("ranking.step.preview_running_body")
                  : previewState === "stale"
                    ? t("ranking.step.preview_stale_body")
                    : t("ranking.step.preview_none_body")
          }
        />

        <Step
          index={3}
          tone={canPublish ? "current" : "blocked"}
          title={t("ranking.step.publish")}
          body={
            canPublish && sellerCount
              ? t("ranking.step.publish_body", { count: sellerCount })
              : t("ranking.step.publish_blocked")
          }
        />
      </div>

      {mayWrite && hasDraft && (
        <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <div className="flex flex-col gap-1">
            <Label
              htmlFor="publish-reason"
              requirement="required"
              requirementLabel={t("field.required")}
            >
              {t("builder.reason_label")}
            </Label>
            <Textarea
              id="publish-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              disabled={pending || previewState === "running"}
              onClick={() => run(runPreview, false)}
            >
              {previewState === "none" ? t("ranking.run_preview") : t("ranking.rerun_preview")}
            </Button>

            <Button
              variant="ghost"
              disabled={!ready || pending}
              onClick={() => withReason(discard)}
            >
              {t("ranking.discard")}
            </Button>

            <Button
              disabled={!canPublish || !ready || pending}
              onClick={() => withReason(publish)}
            >
              {sellerCount
                ? t("ranking.publish", { count: sellerCount })
                : t("ranking.step.publish")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
