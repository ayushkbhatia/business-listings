"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Button, buttonClassName } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { reopenByLinkAction, type ReopenByLinkResult } from "./actions";

/** One action. Rendered as its result once it has run, because the link is spent. */
export function ReopenByLink({ token, label }: { token: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ReopenByLinkResult | null>(null);

  if (result?.ok) {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-3">
        <p className="text-body-sm text-ok-ink">{t("closure.link.done", { business: result.businessName })}</p>
        {result.seatsSkipped > 0 && (
          <p className="text-caption text-muted">
            {t("closure.link.seats_skipped", { count: result.seatsSkipped })}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Link href="/signin?next=/dashboard" className={buttonClassName()}>
            {t("closure.link.sign_in_dashboard")}
          </Link>
          <Link href={`/b/${result.slug}`} className={buttonClassName({ variant: "secondary" })}>
            {t("closure.link.view_listing")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await reopenByLinkAction(token)))}
      >
        {label}
      </Button>
      <p role="alert" className="text-caption text-bad-ink">
        {result && !result.ok ? result.error : null}
      </p>
    </div>
  );
}
