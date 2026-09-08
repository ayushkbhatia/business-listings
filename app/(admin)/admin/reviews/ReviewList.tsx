"use client";

import { useState, useTransition } from "react";
import { Button, Input, Radio, RadioGroup } from "@/components/primitives";
import { Alert } from "@/components/display";
import { ModerationRow } from "@/components/domain/ModerationRow";
import { REMOVAL_GROUNDS } from "@/lib/reviews/eligibility";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Criterion 9 — the removal queue.
 *
 * `ModerationRow` was built for exactly this and had only ever rendered in
 * `/dev/gallery`: it quotes the content in full, which is the point. A removal
 * decision made from a rating and a business name is a decision made without
 * reading what somebody wrote.
 *
 * Removed rows stay in the list, marked, carrying the reason. The question a
 * moderator arrives with is usually "what happened to that review", and a list
 * that answers it only when nothing happened sends them to the audit log.
 */

export interface ReviewRow {
  id: string;
  businessName: string;
  businessSlug: string;
  buyerName: string | null;
  overall: number;
  body: string;
  createdAt: string;
  removedAt: string | null;
  removalReason: string | null;
  /** The reply itself. A moderator judging one has to be able to read it. */
  sellerReply: string | null;
  replyRemovedAt: string | null;
  /** True once a `review_integrity` report already names this review. */
  incentiveLogged: boolean;
}

const MIN_REASON = 4;

/**
 * The three things staff do to a review, and each needs its own reason.
 *
 * `remove` takes the buyer's words down. `remove_reply` takes the supplier's
 * answer down and leaves the review — board 11c `B4`, the case the board never
 * considered. `incentive` records a finding against the account, which is `B6`
 * and is the store that makes the request panel's prohibition enforceable
 * rather than a bluff.
 *
 * They are one panel with one reason box because they are one decision shape:
 * a person judged something, and CLAUDE.md's third non-negotiable says the
 * judgement is worth nothing without the sentence explaining it. Only removal
 * carries a ground, because only removal has a fixed list to pick from.
 */
type Mode = "remove" | "remove_reply" | "incentive";

export interface ReviewListProps {
  rows: readonly ReviewRow[];
  remove: (formData: FormData) => Promise<ActionResult>;
  removeReply: (formData: FormData) => Promise<ActionResult>;
  logIncentive: (formData: FormData) => Promise<ActionResult>;
}

export function ReviewList({ rows, remove, removeReply, logIncentive }: ReviewListProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("remove");
  const [ground, setGround] = useState<string>("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready =
    (mode !== "remove" || ground !== "") && reason.trim().length >= MIN_REASON && !pending;

  function start(id: string, next: Mode) {
    setOpen(id);
    setMode(next);
    setGround("");
    setReason("");
    setResult(null);
  }

  function act(id: string) {
    const form = new FormData();
    form.set("reviewId", id);
    if (mode === "remove") form.set("ground", ground);
    // Sent apart, never joined here — see the note in actions.ts.
    form.set("reason", reason);
    const run =
      mode === "remove" ? remove : mode === "remove_reply" ? removeReply : logIncentive;
    startTransition(async () => {
      const outcome = await run(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setGround("");
        setReason("");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-line bg-card p-6 text-center">
        <p className="text-body-sm text-body">{t("admin.reviews.empty.title")}</p>
        <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
          {t("admin.reviews.empty.body")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <ModerationRow
            key={row.id}
            as="li"
            kindLabel={t("admin.reviews.kind")}
            reference={`${row.overall}/5`}
            subjectName={row.businessName}
            subjectHref={`/b/${row.businessSlug}`}
            quoted={row.body}
            groundLabel={
              row.sellerReply === null
                ? t("admin.reviews.no_reply")
                : row.replyRemovedAt !== null
                  ? t("admin.reviews.reply_removed_on", { date: row.replyRemovedAt })
                  : t("admin.reviews.has_reply")
            }
            raisedAt={row.createdAt}
            raisedByLabel={row.buyerName ?? t("admin.reviews.buyer_unnamed")}
            {...(row.removedAt
              ? {
                  outcomeLabel: t("admin.reviews.removed_on", { date: row.removedAt }),
                  outcomeTone: "bad" as const,
                }
              : {})}
            {...(row.removedAt
              ? {}
              : {
                  actions: (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => start(row.id, "remove")}
                      >
                        {t("admin.reviews.remove")}
                      </Button>
                      {row.sellerReply !== null && row.replyRemovedAt === null ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => start(row.id, "remove_reply")}
                        >
                          {t("admin.reviews.remove_reply")}
                        </Button>
                      ) : null}
                      {row.incentiveLogged ? null : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => start(row.id, "incentive")}
                        >
                          {t("admin.reviews.log_incentive")}
                        </Button>
                      )}
                    </div>
                  ),
                })}
          />
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
          {/*
             The supplier's reply, in front of the person deciding whether to
             take it down. A control that removes text nobody on this screen can
             read is the same defect the review-removal control had before it
             got a list — a decision with no way to reach the thing decided.
          */}
          {mode === "remove_reply" ? (
            <blockquote className="border-s-2 border-line-strong ps-3 text-body-sm text-prose">
              {rows.find((row) => row.id === open)?.sellerReply}
            </blockquote>
          ) : null}

          {mode === "incentive" ? (
            <p className="max-w-prose text-body-sm text-body">{t("admin.reviews.incentive_note")}</p>
          ) : null}

          {mode === "remove" ? (
          <RadioGroup
            legend={t("admin.reviews.ground_legend")}
            hint={t("admin.reviews.ground_hint")}
          >
            {REMOVAL_GROUNDS.map((value) => (
              <Radio
                key={value}
                name="ground"
                value={value}
                checked={ground === value}
                onChange={(event) => setGround(event.target.value)}
                label={t(`admin.reviews.ground.${value}` as never)}
              />
            ))}
          </RadioGroup>
          ) : null}

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1">
              <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <Button disabled={!ready} onClick={() => act(open)}>
              {mode === "remove"
                ? t("admin.reviews.remove")
                : mode === "remove_reply"
                  ? t("admin.reviews.remove_reply")
                  : t("admin.reviews.log_incentive")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
          </div>

          <p className="text-caption text-muted">
            {mode === "incentive"
              ? t("admin.reviews.incentive_permanent")
              : t("admin.reviews.permanent_note")}
          </p>
        </div>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
