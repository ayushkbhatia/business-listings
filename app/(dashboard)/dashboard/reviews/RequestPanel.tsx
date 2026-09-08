"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import { REQUEST_WINDOW_DAYS } from "@/lib/reviews/eligibility";
import type { RequestChannel } from "@/lib/reviews/channel";
import type { RequestResult } from "./actions";

/**
 * Board 11c §1 — asking for a review.
 *
 * ## The count follows the selection. Criterion 1.
 *
 * The board rendered `Send 8 requests` above a chip list with two ticked, which
 * means one of two things and both are wrong on a control that messages
 * customers: either the button ignored the selection, or the selection was
 * decorative. The button here has no number of its own — it renders
 * `selected.size`, and the eligible total is stated in the panel's own sentence
 * as a fact about the list rather than baked into the action.
 *
 * Nothing starts ticked. Eight buyers pre-selected is eight messages one click
 * away, in a panel whose rule is one request per buyer *ever* — a mis-click
 * there is not undoable by any control on this page.
 */

export interface AskableBuyerView {
  enquiryId: string;
  ref: string;
  buyerName: string;
  acceptedAt: string;
  channel: RequestChannel | null;
}

export interface RequestPanelProps {
  buyers: readonly AskableBuyerView[];
  /** Of `buyers`, how many we hold an address for. The rest cannot be asked. */
  reachable: number;
  /** Injected, so the panel renders in the gallery. See `ReviewCardProps`. */
  sendRequests: (formData: FormData) => Promise<RequestResult>;
}

export function RequestPanel({ buyers, reachable, sendRequests }: RequestPanelProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<{ tone: "ok" | "bad"; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const unreachable = buyers.length - reachable;

  function toggle(enquiryId: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(enquiryId);
      else next.delete(enquiryId);
      return next;
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      action={(formData) => {
        setResult(null);
        startTransition(async () => {
          const outcome = await sendRequests(formData);
          if (!outcome.ok) {
            setResult({ tone: "bad", message: outcome.error });
            return;
          }
          setSelected(new Set());
          setResult({
            tone: "ok",
            message:
              outcome.failed > 0
                ? t("reviews.request_partial", {
                    sent: outcome.sent,
                    failed: outcome.failed,
                  })
                : t("reviews.request_result", { count: outcome.sent }),
          });
          router.refresh();
        });
      }}
    >
      <p className="max-w-[var(--measure-prose)] text-body-sm text-muted">
        {t("reviews.request_body", { count: buyers.length, days: REQUEST_WINDOW_DAYS })}
      </p>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="sr-only">{t("reviews.request_select")}</legend>
        <ul className="flex flex-wrap gap-2">
          {buyers.map((buyer) => (
            <li key={buyer.enquiryId}>
              {/*
                 A buyer we hold no address for is shown and disabled, with the
                 reason, rather than dropped from the list. `B2`'s fallback has
                 to be real — and a name that quietly disappears from a panel
                 that states "8 buyers are eligible" is the reconciliation
                 failure criterion 5 is about, one list down.
              */}
              <Checkbox
                name={buyer.channel ? "enquiryId" : undefined}
                value={buyer.enquiryId}
                checked={selected.has(buyer.enquiryId)}
                disabled={buyer.channel === null}
                onChange={(event) => toggle(buyer.enquiryId, event.target.checked)}
                label={buyer.buyerName}
                description={
                  buyer.channel
                    ? `${buyer.acceptedAt} · ${t(`reviews.request_channel.${buyer.channel}` as "reviews.request_channel.email")}`
                    : t("reviews.request_unreachable")
                }
              />
            </li>
          ))}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="submit" size="sm" loading={pending} disabled={selected.size === 0}>
          {pending
            ? t("reviews.request_sending")
            : selected.size === 0
              ? t("reviews.request_send_none")
              : t("reviews.request_send", { count: selected.size })}
        </Button>
        {unreachable > 0 ? (
          <p className="text-caption text-muted">
            {t("reviews.request_unreachable_note", { count: unreachable })}
          </p>
        ) : null}
      </div>

      <div className="rounded-card border border-line bg-surface p-3">
        <p className="max-w-[var(--measure-prose)] text-caption text-muted">
          {t("reviews.request_channel_note")}
        </p>
        {/*
           The prohibition sits at the moment of sending, not in a help article.
           It is enforceable because the log behind it exists — `B6`,
           `logIncentiveFinding` — and without that store the sentence would be
           a bluff, which is what it was on every board before this one.
        */}
        <p className="mt-1.5 max-w-[var(--measure-prose)] text-caption text-muted">
          {t("reviews.request_incentive")}
        </p>
      </div>

      {result ? (
        <Alert tone={result.tone === "ok" ? "ok" : "bad"}>{result.message}</Alert>
      ) : null}
    </form>
  );
}
