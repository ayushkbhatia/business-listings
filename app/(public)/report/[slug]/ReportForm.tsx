"use client";

import { useState, useTransition } from "react";
import { Button, FieldError, Label, Radio, RadioGroup, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { t } from "@/lib/i18n";
import type { FileResult } from "./actions";

/**
 * Board 4h — the form behind *Report this listing*.
 *
 * Fixed labels are read from the catalogue here, which a client component may
 * do — `t()` carries no server-only marker. What may **not** cross the
 * boundary is a function, and a form is where that bites: the character counter
 * wants a formatter, and handing one down is a runtime error on the rendered
 * page rather than a build error. It is built here instead. The per-kind
 * options arrive as data, already worded by the page, because only the server
 * knows which kinds exist.
 *
 * ## The field list narrows with the kind
 *
 * A closed unit is not about a photograph. Choosing a kind rewrites the field
 * select rather than offering every field under every kind, and the chosen
 * field is cleared when it no longer belongs — a select left holding a value
 * its own options no longer contain posts something the server refuses, and
 * the person reading the refusal cannot see what is wrong.
 */

/** Mirrors `MIN_DETAIL` in `lib/reports/file.ts`, which is where the gate is. */
const MIN_DETAIL = 20;

/**
 * The counter, built here rather than handed down.
 *
 * `{used} / {limit}` is two numbers and a separator, and the alternative —
 * a formatter passed as a prop — is the one thing a server component may not
 * give a client one.
 */
function counter(used: number, limit: number): string {
  return `${used} / ${limit}`;
}

export interface ReportKindOption {
  value: string;
  label: string;
  description: string;
  fields: { value: string; label: string }[];
}

export function ReportForm({
  slug,
  kinds,
  detailLimit,
  fileReport,
}: {
  slug: string;
  kinds: readonly ReportKindOption[];
  detailLimit: number;
  fileReport: (formData: FormData) => Promise<FileResult>;
}) {
  const [kind, setKind] = useState<string>("");
  const [field, setField] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [result, setResult] = useState<FileResult | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = kinds.find((option) => option.value === kind) ?? null;
  const fields = chosen?.fields ?? [];

  function pickKind(next: string) {
    setKind(next);
    const allowed = kinds.find((option) => option.value === next)?.fields ?? [];
    // A field that does not belong to the new kind is cleared, not carried.
    setField((current) => (allowed.some((option) => option.value === current) ? current : ""));
    setResult(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData();
    form.set("slug", slug);
    form.set("kind", kind);
    form.set("field", field);
    form.set("detail", detail);
    startTransition(async () => {
      setResult(await fileReport(form));
    });
  }

  if (result?.ok) {
    return (
      <Alert tone="ok" live="polite" title={t("report_listing.filed_title")}>
        {result.willHearBack
          ? t("report_listing.filed_body")
          : t("report_listing.filed_body_anonymous")}
      </Alert>
    );
  }

  const ready = kind !== "" && field !== "" && detail.trim().length >= 20 && !pending;

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <RadioGroup legend={t("report_listing.kind_legend")}>
        {kinds.map((option) => (
          <Radio
            key={option.value}
            name="kind"
            value={option.value}
            checked={kind === option.value}
            onChange={() => pickKind(option.value)}
            label={option.label}
            description={option.description}
          />
        ))}
      </RadioGroup>

      <div className="flex flex-col gap-1">
        <Label htmlFor="report-field" requirement="required" requirementLabel={t("field.required")}>
          {t("report_listing.field_label")}
        </Label>
        <Select
          id="report-field"
          name="field"
          value={field}
          disabled={chosen === null}
          placeholder={
            chosen === null
              ? t("report_listing.choose_kind")
              : t("report_listing.field_placeholder")
          }
          options={fields}
          onChange={(event) => {
            setField(event.target.value);
            setResult(null);
          }}
          {...(result && !result.ok && result.field === "field" ? { invalid: true } : {})}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label
          htmlFor="report-detail"
          requirement="required"
          requirementLabel={t("field.required")}
          hint={t("report_listing.detail_hint", { min: String(MIN_DETAIL) })}
        >
          {t("report_listing.detail_label")}
        </Label>
        <Textarea
          id="report-detail"
          name="detail"
          rows={5}
          limit={detailLimit}
          counterLabel={counter}
          value={detail}
          onChange={(event) => {
            setDetail(event.target.value);
            setResult(null);
          }}
          aria-describedby="report-detail-error"
          {...(result && !result.ok && result.field === "detail" ? { invalid: true } : {})}
        />
        <FieldError id="report-detail-error">
          {result && !result.ok && result.field === "detail" ? result.error : undefined}
        </FieldError>
      </div>

      {result && !result.ok && !result.field ? (
        <Alert tone="bad" live="assertive" fix={result.fix}>
          {result.error}
        </Alert>
      ) : null}

      <div>
        <Button type="submit" disabled={!ready} loading={pending}>
          {t("report_listing.submit")}
        </Button>
      </div>
    </form>
  );
}
