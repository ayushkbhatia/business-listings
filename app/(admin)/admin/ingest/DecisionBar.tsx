"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, buttonClassName } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatCount, formatList } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { HeldReason, KeptBecause } from "@/lib/ingest/classify";
import type { ActionResult } from "./actions";
import { ReasonModal } from "./ReasonModal";

/**
 * The bar under a run: the one place a run is decided.
 *
 * Board `12a` draws a single state — awaiting review, "Publish 6,104" — and its
 * spec lists eight. The render's copy survives where it is true and is
 * extended where the board's own §Two things found it was not:
 *
 *  - **The publish control states the split** (B3). The count on the button is
 *    the records that will publish, and the records that will not are counted
 *    beside it with where they are waiting.
 *  - **Published** replaces publish with the rollback window and its date, and
 *    keeps a publish control only for records the queue has cleared since.
 *  - **Rollback window expired**: the control is gone, "not
 *    disabled-with-tooltip".
 *  - **Zero new listings** is a result, stated as one.
 *
 * Every number arrives counted and every date arrives formatted: this renders,
 * it does not decide.
 */

export interface DecisionBarProps {
  runId: string;
  number: number;
  status: string;
  newListings: number;
  publishable: number;
  held: number;
  heldBecause: Record<HeldReason, number>;
  rejected: number;
  live: number;
  decidedLabel: string | null;
  decidedBy: string | null;
  decisionReason: string | null;
  reversible: boolean;
  reversibleUntilLabel: string | null;
  rollback: {
    atLabel: string;
    by: string | null;
    reason: string;
    withdrawn: number;
    kept: number;
  } | null;
  preview: {
    withdraw: number;
    kept: number;
    keptBecause: Record<KeptBecause, number>;
    /** Listings a merge from this run went into, put back first (12b B5). */
    unwind: string[];
    /** Listings whose owners confirmed a branch from this run: the rollback refuses. */
    confirmed: string[];
  } | null;
  reversibleDays: number;
  exportHref: string;
  queueHref: string;
  publish: (formData: FormData) => Promise<ActionResult>;
  discard: (formData: FormData) => Promise<ActionResult>;
  rollbackAction: (formData: FormData) => Promise<ActionResult>;
  /**
   * Where a decision lands. On the runs index the run under review leaves the
   * page the moment it is decided, taking its confirmation with it, so the
   * index sends the person to the run itself — whose published state is the
   * receipt.
   */
  openRunAfter?: boolean;
}

type Dialog = "publish" | "discard" | "rollback" | null;

const n = (count: number) => ({ count, n: formatCount(count) });

const SURFACE = {
  warn: "border-warn-line bg-warn-surface",
  ok: "border-ok-line bg-ok-surface",
  bad: "border-bad-line bg-bad-surface",
  neutral: "border-line bg-card",
} as const;

export function DecisionBar(props: DecisionBarProps) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  const fields = { runId: props.runId };
  const by = (name: string | null) => name ?? t("admin.run.someone");

  function done(outcome: ActionResult) {
    setDialog(null);
    setResult(outcome);
    if (props.openRunAfter) router.push(`/admin/ingest/${props.runId}`);
    else router.refresh();
  }

  const staged = props.status === "staged";
  const approved = props.status === "approved";
  const nothingNew = staged && props.newListings === 0;
  const allWaiting = props.publishable === 0 && props.held > 0;
  const canPublish = (staged || approved) && props.publishable > 0;

  const tone: keyof typeof SURFACE = staged
    ? "warn"
    : props.status === "rolled_back"
      ? "bad"
      : approved
        ? "ok"
        : "neutral";

  const heldReasons = (Object.entries(props.heldBecause) as [HeldReason, number][]).filter(
    ([, count]) => count > 0,
  );

  return (
    /*
       A div rather than a named section. The gallery draws this bar in every
       state on one page, and eight regions sharing a name fail axe's
       landmark-unique rule — the run page's heading already names the area.
    */
    <div className={cn("rounded-card border p-4", SURFACE[tone])}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 max-w-prose flex-col gap-1.5 text-body-sm text-body">
          {staged && !nothingNew && !allWaiting && (
            <p>
              <span className="font-medium text-warn-ink">{t("admin.run.decision.staged_lead")}</span>{" "}
              {t("admin.run.decision.staged", n(props.publishable))}
            </p>
          )}
          {nothingNew && <p>{t("admin.run.decision.nothing_new")}</p>}
          {allWaiting && staged && <p>{t("admin.run.decision.all_waiting", n(props.held))}</p>}

          {approved && props.decidedLabel && (
            <p>
              {t("admin.run.decision.published", {
                date: props.decidedLabel,
                name: by(props.decidedBy),
              })}{" "}
              {t("admin.run.decision.live", n(props.live))}
            </p>
          )}
          {approved && props.publishable > 0 && (
            <p>{t("admin.run.decision.more_ready", n(props.publishable))}</p>
          )}

          {(staged || approved) && props.held > 0 && !(allWaiting && staged) && (
            <p>{t("admin.run.decision.held", n(props.held))}</p>
          )}
          {(staged || approved) && heldReasons.length > 0 && (
            <p className="text-caption text-body">
              {heldReasons
                .map(([reason, count]) => t(`admin.run.held.${reason}`, n(count)))
                .join(" · ")}
              {props.heldBecause.needs_category > 0 && (
                <>
                  {" · "}
                  <Link
                    href={props.queueHref}
                    className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    {t("admin.run.open_queue")}
                  </Link>
                </>
              )}
            </p>
          )}

          {approved &&
            (props.reversible && props.reversibleUntilLabel ? (
              <p>{t("admin.run.decision.reversible", { date: props.reversibleUntilLabel })}</p>
            ) : props.reversibleUntilLabel ? (
              <p>{t("admin.run.decision.window_closed", { date: props.reversibleUntilLabel })}</p>
            ) : (
              <p>{t("admin.run.decision.nothing_to_roll_back")}</p>
            ))}

          {props.status === "discarded" && props.decidedLabel && (
            <p>
              {t("admin.run.decision.discarded", {
                date: props.decidedLabel,
                name: by(props.decidedBy),
              })}
            </p>
          )}

          {props.rollback && (
            <p>
              {t("admin.run.decision.rolled_back", {
                date: props.rollback.atLabel,
                name: by(props.rollback.by),
              })}{" "}
              {t("admin.run.decision.withdrawn", n(props.rollback.withdrawn))}
              {props.rollback.kept > 0 && <> {t("admin.run.decision.kept", n(props.rollback.kept))}</>}
            </p>
          )}

          {(props.rollback?.reason ?? (!staged ? props.decisionReason : null)) && (
            <p className="text-caption text-body">
              {t("admin.run.decision.reason", {
                reason: props.rollback?.reason ?? props.decisionReason ?? "",
              })}
            </p>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {props.rejected > 0 && (
            // A route, not an action: the browser has to save a file.
            <a href={props.exportHref} className={buttonClassName({ variant: "secondary" })}>
              {t("admin.run.export_rejects")}
            </a>
          )}
          {staged && (
            <Button variant="ghost" onClick={() => setDialog("discard")}>
              {t("admin.run.discard")}
            </Button>
          )}
          {approved && props.reversible && props.preview && (
            <Button variant="secondary" onClick={() => setDialog("rollback")}>
              {t("admin.run.rollback")}
            </Button>
          )}
          {canPublish && (
            <Button onClick={() => setDialog("publish")}>
              {t("admin.run.publish", { n: formatCount(props.publishable) })}
            </Button>
          )}
          {nothingNew && (
            <Button onClick={() => setDialog("publish")}>{t("admin.run.approve_empty")}</Button>
          )}
        </div>
      </div>

      {result && (
        <div className="mt-3">
          <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
            {result.ok ? result.message : result.error}
          </Alert>
        </div>
      )}

      <ReasonModal
        open={dialog === "publish"}
        onClose={() => setDialog(null)}
        title={
          nothingNew
            ? t("admin.run.review_title", { number: props.number })
            : t("admin.run.publish_title", { ...n(props.publishable), number: props.number })
        }
        description={
          nothingNew
            ? t("admin.run.review_description")
            : t("admin.run.publish_description", { days: props.reversibleDays })
        }
        confirmLabel={
          nothingNew ? t("admin.run.review_confirm") : t("admin.run.publish_confirm", n(props.publishable))
        }
        fields={fields}
        action={props.publish}
        onDone={done}
      >
        {props.held > 0 && (
          <p className="text-body-sm text-body">{t("admin.run.decision.held", n(props.held))}</p>
        )}
      </ReasonModal>

      <ReasonModal
        open={dialog === "discard"}
        onClose={() => setDialog(null)}
        title={t("admin.run.discard_title", { number: props.number })}
        description={t("admin.run.discard_description")}
        confirmLabel={t("admin.run.discard")}
        destructive
        fields={fields}
        action={props.discard}
        onDone={done}
      />

      {props.preview && (
        <ReasonModal
          open={dialog === "rollback"}
          onClose={() => setDialog(null)}
          title={t("admin.run.rollback_title", { number: props.number })}
          confirmLabel={t("admin.run.rollback_confirm", n(props.preview.withdraw))}
          destructive
          blocked={props.preview.confirmed.length > 0}
          fields={fields}
          action={props.rollbackAction}
          onDone={done}
        >
          <div className="flex flex-col gap-2 text-body-sm text-body">
            {props.preview.confirmed.length > 0 && (
              <Alert tone="bad" fix={t("admin.run.rollback_confirmed_fix")}>
                {t("admin.run.rollback_confirmed", { names: formatList(props.preview.confirmed) })}
              </Alert>
            )}
            <p>{t("admin.run.rollback_withdraw", n(props.preview.withdraw))}</p>
            {props.preview.kept > 0 && (
              <>
                <p>{t("admin.run.rollback_kept", n(props.preview.kept))}</p>
                <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-caption tabular-nums text-body">
                  {(Object.entries(props.preview.keptBecause) as [KeptBecause, number][])
                    .filter(([, count]) => count > 0)
                    .map(([why, count]) => (
                      <li key={why}>{t(`admin.run.kept.${why}`, { n: formatCount(count) })}</li>
                    ))}
                </ul>
              </>
            )}
            {props.preview.unwind.length > 0 && (
              <p>
                {t("admin.run.rollback_unwind", {
                  ...n(props.preview.unwind.length),
                  names: formatList([...new Set(props.preview.unwind)]),
                })}
              </p>
            )}
          </div>
        </ReasonModal>
      )}
    </div>
  );
}
