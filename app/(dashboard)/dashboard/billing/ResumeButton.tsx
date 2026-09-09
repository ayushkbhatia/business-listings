"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { resumePlan } from "./actions";

/**
 * `Resume Pro`, on the cancellation-scheduled banner.
 *
 * Its own island so the card that holds it stays a server component. The label
 * arrives as a string rather than as something this file composes: a function
 * prop crossing the server–client boundary is the repo's most repeated defect,
 * and `tests/unit/client-labels` fails the build on it.
 *
 * No confirmation step. Resuming costs nothing — the period was already paid
 * for, the plan never moved, and un-cancelling is two columns going back to null
 * — so a dialog asking "are you sure you want to keep paying us" would be a
 * retention prompt wearing a safety rail, which is the opposite of the recorded
 * no-retention decision.
 */
export function ResumeButton({ label }: { label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  /*
     The sentence the action already composed and nobody rendered.

     `resumePlan` returns `t("billing.resumed", { plan, when })` and this read
     only `result.ok`, so the key had no reader anywhere in the app and passed
     CI — no gate scans for an orphaned string. `router.refresh()` does show the
     state move: the scheduled banner reverts to the cancel card. What it never
     said is the thing the seller came to find out, which is the date the plan
     now renews on.
  */
  const [done, setDone] = useState<string | null>(null);

  return (
    <div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await resumePlan();
            if (result.ok) {
              setDone(result.message ?? null);
              router.refresh();
            } else setError(result.error);
          });
        }}
      >
        {label}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-caption text-bad-ink">
          {error}
        </p>
      )}
      {done && (
        <p role="status" className="mt-2 text-caption text-ok-ink">
          {done}
        </p>
      )}
    </div>
  );
}
