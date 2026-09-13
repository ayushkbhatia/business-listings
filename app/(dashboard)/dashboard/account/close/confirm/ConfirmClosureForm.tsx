"use client";

import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { Button, buttonClassName, Checkbox } from "@/components/primitives";
import { Card } from "@/components/structure";
import { t } from "@/lib/i18n";
import { requestClosureAction, type RequestClosureActionResult } from "../actions";

/**
 * The confirmation.
 *
 * On success the action redirects to `/account/closed`, which needs no session:
 * the seller has just been signed out by the request they made. See the note on
 * `ClosureDoneCookie` for why the result cannot be rendered here.
 *
 * A failed request is the one live region on this screen that is assertive,
 * matching the design system's rule for a failed save: the seller pressed a
 * destructive button and nothing happened, which is worth interrupting for.
 */
export function ConfirmClosureForm({
  businessName,
  points,
}: {
  businessName: string;
  points: string[];
}) {
  const checkboxId = useId();
  const [understood, setUnderstood] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<RequestClosureActionResult | null>(null);

  return (
    <form
      className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!understood) return;
        const data = new FormData();
        data.set("understood", "yes");
        startTransition(async () => setResult(await requestClosureAction(data)));
      }}
    >
      <Card padded>
        <h2 className="text-body font-medium text-ink">{t("closure.confirm.what_happens")}</h2>
        <ul className="mt-3 flex flex-col gap-2.5">
          {points.map((point) => (
            <li key={point} className="flex items-start gap-2 text-body-sm leading-relaxed text-body-ink">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-bad" />
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t border-line pt-4">
          <Checkbox
            id={checkboxId}
            checked={understood}
            onChange={(event) => setUnderstood(event.currentTarget.checked)}
            label={t("closure.confirm.understood", { business: businessName })}
          />
        </div>
      </Card>

      <aside className="flex flex-col gap-2.5">
        <Button type="submit" variant="danger" block disabled={!understood || pending}>
          {pending ? t("closure.confirm.working") : t("closure.confirm.cta", { business: businessName })}
        </Button>
        {!understood && <p className="text-center text-caption text-muted">{t("closure.confirm.tick_first")}</p>}
        <Link href="/dashboard" className={buttonClassName({ variant: "secondary", block: true })}>
          {t("closure.actions.keep")}
        </Link>
        <p role="alert" className="text-caption text-bad-ink">
          {result ? result.error : null}
        </p>
      </aside>
    </form>
  );
}
