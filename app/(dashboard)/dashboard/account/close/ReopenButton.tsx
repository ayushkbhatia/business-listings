"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { reverseAsOwnerAction } from "./actions";

/**
 * The reversal screen's one control.
 *
 * A client component only for its pending state and its refusal. The action
 * redirects to the dashboard on success, so there is no success state to draw
 * here; a refusal — the window closed while the page sat open — is said in place
 * rather than swallowed. Polite, because nothing was lost: the closure simply
 * stands.
 */
export function ReopenButton({ label }: { label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await reverseAsOwnerAction();
            if (result && !result.ok) setError(result.error);
          })
        }
      >
        {label}
      </Button>
      <p role="status" aria-live="polite" className="text-caption text-bad-ink">
        {error}
      </p>
    </div>
  );
}
