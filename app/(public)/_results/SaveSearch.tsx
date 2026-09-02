"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { saveSearch } from "./save-actions";

/**
 * "Save this search" — the current URL, kept.
 *
 * The filters already live entirely in the query string, which is what makes
 * this a two-line feature rather than a serialisation problem: whatever
 * reproduces the view for a shared link reproduces it for a saved one.
 *
 * A buyer with no account is told so rather than being bounced to a sign-in
 * they did not ask for. Losing the filters they just set to a redirect is a
 * worse trade than showing them where the button will work.
 */
export function SaveSearch({ search, heading }: { search: string; heading: string }) {
  const [state, setState] = useState<"idle" | "saved" | "anonymous">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "saved") {
    return (
      <span className="inline-flex items-center px-3 text-body-sm text-muted">
        {t("browse.saved")}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start">
      <Button
        size="md"
        variant="secondary"
        loading={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await saveSearch({ search, name: heading });
            setState(result.ok ? "saved" : "anonymous");
          })
        }
      >
        {t("browse.save_search")}
      </Button>
      {state === "anonymous" && (
        <span className="mt-1 text-caption text-muted">{t("browse.save_needs_account")}</span>
      )}
    </span>
  );
}
