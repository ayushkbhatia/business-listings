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
export function SaveSearch({
  search,
  heading,
  categoryId = null,
}: {
  search: string;
  heading: string;
  /** The category page it is saved on — board 10e keeps that scope. */
  categoryId?: string | null;
}) {
  const [state, setState] = useState<"idle" | "saved" | "saved_zero" | "anonymous">("idle");
  const [pending, startTransition] = useTransition();

  if (state === "saved" || state === "saved_zero") {
    return (
      <span role="status" className="inline-flex max-w-xs flex-col items-start px-3 text-body-sm text-body">
        {t("browse.saved")}
        <span className="text-caption text-muted">
          {state === "saved_zero" ? t("browse.saved_zero") : t("browse.saved_where")}
        </span>
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
            const result = await saveSearch({ search, name: heading, categoryId });
            setState(result.ok ? (result.zeroResult ? "saved_zero" : "saved") : "anonymous");
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
