"use client";

import { useId, useState, useTransition } from "react";
import { Button, Input, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display/Alert";
import { t } from "@/lib/i18n";
import { SCALE_MAX } from "@/lib/enquiry/service-brief";
import { reviseEnquiry } from "./revise-actions";

/**
 * The revision form — a requirement, and a brief's scale beside it.
 *
 * Only the words. The site, the trade and the recipients stay as they were
 * sent: changing any of those is a different brief with different firms, and
 * the page says so rather than offering a control that would have to lie.
 */
export function ReviseForm({
  refOrId,
  token,
  initialRequirement,
  initialScale,
  isBrief,
  backHref,
}: {
  refOrId: string;
  token: string | null;
  initialRequirement: string;
  initialScale: string | null;
  isBrief: boolean;
  backHref: string;
}) {
  const id = useId();
  const [requirement, setRequirement] = useState(initialRequirement);
  const [scale, setScale] = useState(initialScale ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      aria-label={t("revise.meta_title")}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await reviseEnquiry({
            refOrId,
            token,
            requirement,
            ...(isBrief ? { scale } : {}),
          });
          // A redirect on success; only a refusal returns.
          if (result && !result.ok) setError(result.error);
        });
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-caption font-medium text-body">{t("revise.requirement")}</span>
        <Textarea id={`${id}-requirement`} rows={6} value={requirement} onChange={(event) => setRequirement(event.target.value)} />
      </label>
      {isBrief && (
        <label className="flex flex-col gap-1.5">
          <span className="text-caption font-medium text-body">{t("revise.scale")}</span>
          <Input id={`${id}-scale`} value={scale} maxLength={SCALE_MAX + 20} onChange={(event) => setScale(event.target.value)} />
        </label>
      )}
      {error && (
        <Alert tone="bad" live="assertive" fix={t("revise.error_fix")}>
          {error}
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending}>
          {t("revise.save")}
        </Button>
        <a
          href={backHref}
          className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("revise.cancel")}
        </a>
      </div>
    </form>
  );
}
