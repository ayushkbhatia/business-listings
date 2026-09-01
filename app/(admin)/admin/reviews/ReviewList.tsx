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
  hasSellerReply: boolean;
}

const MIN_REASON = 4;

export interface ReviewListProps {
  rows: readonly ReviewRow[];
  remove: (formData: FormData) => Promise<ActionResult>;
}

export function ReviewList({ rows, remove }: ReviewListProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [ground, setGround] = useState<string>("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = ground !== "" && reason.trim().length >= MIN_REASON && !pending;

  function act(id: string) {
    const form = new FormData();
    form.set("reviewId", id);
    form.set("ground", ground);
    // Sent apart, never joined here — see the note in actions.ts.
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await remove(form);
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
              row.hasSellerReply ? t("admin.reviews.has_reply") : t("admin.reviews.no_reply")
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
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setOpen(row.id);
                        setResult(null);
                      }}
                    >
                      {t("admin.reviews.remove")}
                    </Button>
                  ),
                })}
          />
        ))}
      </ul>

      {open && (
        <div className="flex flex-col gap-3 rounded-card border border-line bg-card p-3">
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

          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-64 flex-1 flex-col gap-1">
              <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
            <Button disabled={!ready} onClick={() => act(open)}>
              {t("admin.reviews.remove")}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
          </div>

          <p className="text-caption text-muted">{t("admin.reviews.permanent_note")}</p>
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
