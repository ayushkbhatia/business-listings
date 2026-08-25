"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import Link from "next/link";
import { Button, buttonClassName } from "@/components/primitives";
import { Panel } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { BillingResult } from "../actions";

/**
 * Board 11f — cancel.
 *
 * What is kept comes first and is the longer list, because everything a seller
 * is anxious about is in it: that their catalogue is deleted, that their badge
 * is taken away, that it happens the moment they click. None is true.
 *
 * **No retention offer.** The board says so deliberately, and it is the right
 * call: a discount offered at the moment somebody leaves buys a month and
 * costs the only honest signal we get about whether the product is worth it.
 */

export interface CancelFormProps {
  planName: string;
  endsOn: string;
  action: () => Promise<BillingResult>;
}

const KEPT = ["listing", "products", "reviews", "badge"] as const;
const LOST = ["extra_seats", "ranking", "placement"] as const;

export function CancelForm({ planName, endsOn, action }: CancelFormProps) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <Panel title={t("cancel.done", { plan: planName, when: endsOn })}>
        <Link
          href="/dashboard/billing"
          className="text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("change.back")}
        </Link>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <p className="max-w-prose text-body-sm text-prose">
        {t("cancel.intro", { plan: planName, when: endsOn })}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("cancel.kept_heading")}>
          <ul className="flex flex-col gap-2">
            {KEPT.map((key) => (
              <li key={key} className="max-w-prose text-body-sm text-prose">
                {t(`cancel.kept.${key}` as never)}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t("cancel.lost_heading", { when: endsOn })}>
          <ul className="flex flex-col gap-2">
            {LOST.map((key) => (
              <li key={key} className="max-w-prose text-body-sm text-muted">
                {t(`cancel.lost.${key}` as never)}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-caption text-muted">{t("cancel.free_caps")}</p>
        </Panel>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/*
          Cancel is the secondary action and staying is the primary one, which
          is the only nudge on this page. There is no discount, no "are you
          sure", and no second screen — the board is explicit, and if the
          product is not worth it we would rather know.
        */}
        <Link href="/dashboard/billing" className={buttonClassName({})}>
          {t("cancel.keep")}
        </Link>
        <Button
          variant="secondary"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const result = await action();
              if (!result.ok) setError(result.error);
              else setDone(true);
            });
          }}
        >
          {t("cancel.confirm")}
        </Button>
      </div>
    </div>
  );
}
