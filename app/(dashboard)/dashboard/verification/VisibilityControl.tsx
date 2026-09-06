"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { VisibilityResult } from "./actions";

/**
 * `WHO SEES IT`, for a credential the seller uploaded.
 *
 * The column carries three values and only two of them are a choice. `Public`
 * and `Hidden` are the seller's, because it is their certificate and their shop
 * window. `Hidden while in review` is not a state anybody picks — it is what
 * `Public` means until a moderator has looked — so it renders as a statement
 * with the control beside it rather than as a third option in a select.
 *
 * The licence and TRN rows have no control at all. Their visibility is `Badge
 * only`, fixed, because the badge is platform output and not a seller
 * preference — board 3e's fourth correction. That is why this component only
 * ever appears in the second table.
 */
export interface VisibilityControlProps {
  documentId: string;
  name: string;
  isPublic: boolean;
  /** Public **and** reviewed. The two together are what a buyer can see. */
  onStorefront: boolean;
  action: (formData: FormData) => Promise<VisibilityResult>;
}

export function VisibilityControl({
  documentId,
  name,
  isPublic,
  onStorefront,
  action,
}: VisibilityControlProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const inReview = isPublic && !onStorefront;
  const state = onStorefront
    ? t("verify_listing.who_public")
    : inReview
      ? t("verify_listing.who_in_review")
      : t("verify_listing.who_hidden");

  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-caption text-muted">{state}</span>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        // Names the document, not just the act. A table of five identical
        // "Hide" buttons is five identical announcements.
        aria-label={t("verify_listing.visibility", { name })}
        onClick={() => {
          setError(null);
          const form = new FormData();
          form.set("id", documentId);
          form.set("public", isPublic ? "false" : "true");
          startTransition(async () => {
            const result = await action(form);
            if (!result.ok) setError(result.error);
          });
        }}
      >
        {/*
           Three labels for two states of one flag, because "Hide from my
           listing" beside "Hidden while in review" reads as a contradiction —
           it is not hidden *from* anything yet, and what the button does is
           take the request out of the queue.
        */}
        {inReview
          ? t("verify_listing.withdraw")
          : isPublic
            ? t("verify_listing.make_hidden")
            : t("verify_listing.make_public")}
      </Button>
      {error && <span className="text-caption text-bad-ink">{error}</span>}
      {!isPublic && <span className="text-caption text-muted">{t("verify_listing.public_hint")}</span>}
    </span>
  );
}
