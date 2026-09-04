"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { beginProTrial } from "./actions";

/**
 * `Start Pro trial`.
 *
 * The one control on this page that changes a plan without a quote in front of
 * it, and it can be because there is nothing to quote: criterion 12, a trial
 * takes no card. Basic and a card-paid Pro both link to the change screen
 * instead, where the proration is stated and confirmed.
 *
 * A refusal renders where the button is rather than at the top of the page.
 * The only ways this fails are "already used" and "already paying", and both
 * are answers about *this button* — a seller who reads them beside the card
 * they pressed does not have to work out which of three cards was refused.
 */
export function TrialButton({
  label,
  note,
  action,
}: {
  label: string;
  /** The mechanics, under the button. What "no card" actually means. */
  note: string;
  action: typeof beginProTrial;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        block
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await action();
            if (result.ok) router.refresh();
            else setError(result.error);
          });
        }}
      >
        {label}
      </Button>

      {error ? (
        <p role="alert" className="text-caption text-bad-ink">
          {error}
        </p>
      ) : (
        <p className="text-caption text-muted">{note}</p>
      )}
    </div>
  );
}

/** Exported for the gallery, which has no server action to hand it. */
export const TRIAL_LABEL = t("plan_step.start_trial", { plan: "Pro" });
