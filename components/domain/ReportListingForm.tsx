"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  Button,
  buttonClassName,
  FieldError,
  Input,
  Label,
  Radio,
  RadioGroup,
  Select,
  Textarea,
} from "@/components/primitives";
import { Alert } from "@/components/display";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { FileResult, ReportFieldName, ReportFormData, ReportReasonOption } from "@/lib/reports/form";

/**
 * Board 13c — *Report a listing*, the form, in both places it renders.
 *
 * The modal over the storefront (`/b/:slug?report=1`) and the page it degrades
 * to (`/report/:slug`) render this component and nothing else, with the same
 * data from `reportFormData` and the same `fileReport` action behind it. A
 * shared component renders identically on every screen that carries it; the
 * only thing `layout` changes is where the footer sits, because a modal's
 * footer is a bar across its foot and a page's is a row under the last field.
 *
 * ## What the board drew, and what changed on the way
 *
 *   - **Four reasons, one evidence box, a footer promise.** Kept. The reasons
 *     arrive in the board's order and the evidence box is optional, as drawn.
 *   - **`Permanently closed` pre-selected.** Not kept. The render shows the
 *     selected state; as a *default* it would file a closure report for anybody
 *     who pressed *Send* without reading, and a closure report is one of three
 *     that flag a listing. The group starts empty and *Send report* waits.
 *   - **`Wrong phone or address`.** Kept as *A detail is wrong* with a
 *     sub-choice, which is the export's first correction: the label named two
 *     fields, and a reason that names two fields cannot be counted by either.
 *   - **`Someone else claimed my business`.** Kept, and it is a door rather
 *     than a radio (`B10`): choosing it swaps *Send report* for the claim flow,
 *     which takes a trade licence and a named claimant.
 *   - **No outcome drawn.** Added (`B5`). The confirmation — reference, service
 *     level, who will hear back — is the only feedback a reporter ever gets.
 */

export interface ReportListingFormProps {
  data: ReportFormData;
  fileReport: (formData: FormData) => Promise<FileResult>;
  /** Where the footer goes. The fields are identical either way. */
  layout: "modal" | "page";
  /** Modal: closes it. Page: omitted, and *Cancel* is a link back to the listing. */
  onCancel?: () => void;
  /** Told when the report is in, so a modal can retitle itself. */
  onFiled?: (result: Extract<FileResult, { ok: true }>) => void;
  /**
   * Where the form starts. The gallery draws every state from here; the two
   * real surfaces pass nothing and start empty, which is the state `B7` needs —
   * no reason chosen until somebody chooses one.
   */
  /**
   * The form's accessible name. *Report {business}* by default, which is what a
   * screen reader's landmark list should read; the gallery, which draws the
   * form ten times on one page, names each copy by its state instead.
   */
  label?: string;
  initial?: {
    reason?: string;
    field?: string;
    correction?: string;
    email?: string;
    result?: FileResult;
  };
}

/**
 * `{used} / {limit}`, built here rather than handed down: a formatter is a
 * function, and a function is the one thing a server component may not give a
 * client one — a runtime error on the rendered page, not a build error.
 */
function counter(used: number, limit: number): string {
  return `${used} / ${limit}`;
}

export function ReportListingForm({
  data,
  fileReport,
  layout,
  onCancel,
  onFiled,
  label,
  initial,
}: ReportListingFormProps) {
  const formId = useId();
  const [reason, setReason] = useState<string>(initial?.reason ?? "");
  const [field, setField] = useState<string>(initial?.field ?? "");
  const [correction, setCorrection] = useState(initial?.correction ?? "");
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [result, setResult] = useState<FileResult | null>(initial?.result ?? null);
  /* Focus moves to the confirmation when a send lands, not when a page opens on one. */
  const [justFiled, setJustFiled] = useState(false);
  const [pending, startTransition] = useTransition();

  const chosen: ReportReasonOption | null = data.reasons.find((option) => option.value === reason) ?? null;
  const isClaim = chosen !== null && chosen.fields.length === 0;
  const fields = chosen?.fields ?? [];
  /*
     One field is no question. `closed` is always the licence record, and the
     server fills the same answer in — the form only asks where there is a
     choice to make.
  */
  const effectiveField = fields.length === 1 ? fields[0]!.value : field;
  const fieldOption = fields.find((option) => option.value === effectiveField) ?? null;

  function pickReason(next: string) {
    setReason(next);
    const allowed = data.reasons.find((option) => option.value === next)?.fields ?? [];
    // A field the new reason does not offer is cleared, never carried across.
    setField((current) => (allowed.some((option) => option.value === current) ? current : ""));
    setResult(null);
  }

  function invalid(name: ReportFieldName): boolean {
    return result !== null && !result.ok && result.field === name;
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen || isClaim) return;
    const form = new FormData();
    form.set("slug", data.slug);
    form.set("kind", chosen.value);
    if (effectiveField) form.set("field", effectiveField);
    if (fieldOption?.takesCorrection && correction.trim()) form.set("correction", correction);
    if (fieldOption?.takesCategory && category) form.set("category", category);
    if (detail.trim()) form.set("detail", detail);
    if (!data.signedIn && email.trim()) form.set("email", email);
    startTransition(async () => {
      const answer = await fileReport(form);
      setResult(answer);
      if (answer.ok) {
        setJustFiled(true);
        onFiled?.(answer);
      }
    });
  }

  if (result?.ok && chosen) {
    return (
      <ReportFiled
        result={result}
        businessName={data.businessName}
        slaDays={chosen.slaDays}
        layout={layout}
        slug={data.slug}
        takeFocus={justFiled}
        {...(onCancel ? { onClose: onCancel } : {})}
      />
    );
  }

  const ready = chosen !== null && !isClaim && effectiveField !== "" && !pending;
  const failure = result && !result.ok ? result : null;

  return (
    <form
      id={formId}
      onSubmit={submit}
      noValidate
      aria-label={label ?? t("report_listing.title", { business: data.businessName })}
      className="flex flex-col gap-5"
    >
      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">{t("report_listing.kind_legend")}</legend>
        <div className="flex flex-col gap-2">
          {data.reasons.map((option) => (
            <ReasonCard
              key={option.value}
              name={`${formId}-reason`}
              option={option}
              checked={reason === option.value}
              onChange={() => pickReason(option.value)}
            />
          ))}
        </div>
      </fieldset>

      {isClaim ? (
        /*
           `B10`. Not a report, so nothing below this line is asked. What the
           claim needs is said before the reporter leaves, so the licence upload
           on the other side is not a surprise.
        */
        <div className="flex flex-col gap-2 rounded-card border border-line bg-paper-sunk px-4 py-3">
          <p className="text-body-sm text-ink">{t("report_listing.claim.title")}</p>
          <ul className="flex list-disc flex-col gap-1 ps-5 text-caption text-body">
            <li>{t("report_listing.claim.needs_licence")}</li>
            <li>{t("report_listing.claim.needs_name")}</li>
            <li>{t("report_listing.claim.decided_by")}</li>
          </ul>
        </div>
      ) : chosen ? (
        <div className="flex flex-col gap-4">
          {fields.length > 1 && (
            <RadioGroup legend={t("report_listing.field_legend")} orientation="horizontal">
              {fields.map((option) => (
                <Radio
                  key={option.value}
                  name={`${formId}-field`}
                  value={option.value}
                  checked={field === option.value}
                  onChange={() => {
                    setField(option.value);
                    setResult(null);
                  }}
                  label={option.label}
                />
              ))}
            </RadioGroup>
          )}
          {invalid("field") && failure ? (
            <FieldError id={`${formId}-field-error`}>{failure.error}</FieldError>
          ) : null}

          {fieldOption?.takesCorrection && (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${formId}-correction`}
                requirement="optional"
                requirementLabel={t("field.optional")}
                hint={t(`report_listing.correction_hint.${fieldOption.value}` as "report_listing.correction_hint.phone")}
              >
                {t("report_listing.correction_label", { field: fieldOption.label.toLowerCase() })}
              </Label>
              <Input
                id={`${formId}-correction`}
                name="correction"
                value={correction}
                maxLength={data.limits.correction}
                autoComplete="off"
                mono={fieldOption.value === "phone"}
                {...(fieldOption.value === "phone" ? { inputMode: "tel" as const } : {})}
                onChange={(event) => {
                  setCorrection(event.target.value);
                  setResult(null);
                }}
                aria-describedby={`${formId}-correction-error`}
                invalid={invalid("correction")}
              />
              <FieldError id={`${formId}-correction-error`}>
                {invalid("correction") ? failure?.error : undefined}
              </FieldError>
            </div>
          )}

          {fieldOption?.takesCategory && data.categories.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${formId}-category`}
                requirement="optional"
                requirementLabel={t("field.optional")}
                hint={t("report_listing.category_hint")}
              >
                {t("report_listing.category_label")}
              </Label>
              <Select
                id={`${formId}-category`}
                name="category"
                value={category}
                placeholder={t("report_listing.category_placeholder")}
                options={[]}
                groups={data.categories}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setResult(null);
                }}
                aria-describedby={`${formId}-category-error`}
                invalid={invalid("category")}
              />
              <FieldError id={`${formId}-category-error`}>
                {invalid("category") ? failure?.error : undefined}
              </FieldError>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <Label
              htmlFor={`${formId}-detail`}
              requirement="optional"
              requirementLabel={t("field.optional")}
              hint={t("report_listing.detail_hint")}
            >
              {t("report_listing.detail_label")}
            </Label>
            <Textarea
              id={`${formId}-detail`}
              name="detail"
              rows={3}
              limit={data.limits.detail}
              counterLabel={counter}
              value={detail}
              onChange={(event) => {
                setDetail(event.target.value);
                setResult(null);
              }}
              aria-describedby={`${formId}-detail-error`}
              invalid={invalid("detail")}
            />
            <FieldError id={`${formId}-detail-error`}>
              {invalid("detail") ? failure?.error : undefined}
            </FieldError>
          </div>

          {data.signedIn ? (
            <p className="text-caption text-muted">{t("report_listing.reply_account")}</p>
          ) : (
            <div className="flex flex-col gap-1">
              <Label
                htmlFor={`${formId}-email`}
                requirement="optional"
                requirementLabel={t("field.optional")}
                hint={t("report_listing.email_hint")}
              >
                {t("report_listing.email_label")}
              </Label>
              <Input
                id={`${formId}-email`}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setResult(null);
                }}
                aria-describedby={`${formId}-email-error`}
                invalid={invalid("email")}
              />
              <FieldError id={`${formId}-email-error`}>
                {invalid("email") ? failure?.error : undefined}
              </FieldError>
            </div>
          )}
        </div>
      ) : null}

      {failure && (!failure.field || failure.field === "kind") ? (
        /* A failed save is the one assertive region the design system allows. */
        <Alert tone="bad" live="assertive" fix={failure.fix}>
          {failure.error}
        </Alert>
      ) : null}

      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          layout === "modal" && "-mx-4 -mb-4 border-t border-line bg-paper-sunk px-4 py-3",
        )}
      >
        <p className="max-w-[38ch] text-caption text-muted">{t("report_listing.threshold_note")}</p>
        <div className="ms-auto flex items-center gap-2">
          {onCancel ? (
            <Button type="button" variant="secondary" onClick={onCancel}>
              {t("action.cancel")}
            </Button>
          ) : (
            <Link href={`/b/${data.slug}`} className={buttonClassName({ variant: "secondary" })}>
              {t("action.cancel")}
            </Link>
          )}
          {isClaim ? (
            <Link href={data.claimHref} rel="nofollow" className={buttonClassName()}>
              {t("report_listing.claim.cta")}
            </Link>
          ) : (
            <Button type="submit" form={formId} disabled={!ready} loading={pending}>
              {t("report_listing.submit")}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * One reason, as the board draws it: a bordered row with the radio inside.
 *
 * The whole row is the label, so the target is the row rather than a sixteen-
 * pixel circle — which on a phone, where most of these are filed, is the
 * difference between choosing a reason and choosing the one above it. The
 * border thickens and turns moss on the checked row, and the radio carries the
 * same state, so the choice never rests on colour alone.
 */
function ReasonCard({
  name,
  option,
  checked,
  onChange,
}: {
  name: string;
  option: ReportReasonOption;
  checked: boolean;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border bg-card px-4 py-3",
        "transition-colors duration-120 ease-out hover:border-moss-muted",
        // The ring for a keyboard, not for the click that just chose the row.
        "has-[:focus-visible]:shadow-focus",
        checked ? "border-[1.5px] border-moss" : "border-line-strong",
      )}
    >
      <input
        id={id}
        type="radio"
        name={name}
        value={option.value}
        checked={checked}
        onChange={onChange}
        aria-describedby={`${id}-hint`}
        className="mt-0.5 size-4 shrink-0 accent-[var(--moss)] focus-visible:outline-none"
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("text-body-sm text-ink", checked && "font-medium")}>{option.label}</span>
        <span id={`${id}-hint`} className="text-caption text-muted">
          {option.description}
        </span>
      </span>
    </label>
  );
}

/**
 * `B5` — the outcome the board did not draw, and the only feedback a reporter
 * ever gets.
 *
 * The reference, first and in mono, because it is the one thing on this screen
 * worth writing down. Then the service level for this kind — read from the
 * same table the queue's clock runs on, so the promise here and the moderator's
 * deadline are one number. Then who will hear back, said plainly in all three
 * cases, including the one where the answer is nobody.
 */
function ReportFiled({
  result,
  businessName,
  slaDays,
  layout,
  slug,
  takeFocus,
  onClose,
}: {
  result: Extract<FileResult, { ok: true }>;
  businessName: string;
  slaDays: number;
  layout: "modal" | "page";
  slug: string;
  takeFocus: boolean;
  onClose?: () => void;
}) {
  /*
     The form the reporter was focused in has gone, so focus goes to what
     replaced it — otherwise it falls to the document body and a keyboard user
     is dropped at the top of the page, outside the dialog they are in.
  */
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeFocus) heading.current?.focus();
  }, [takeFocus]);
  /*
     Under the modal's `h2` title this is a third-level heading; on the page it
     follows the `h1` directly. One outline per surface, no level skipped.
  */
  const Heading = layout === "modal" ? "h3" : "h2";

  const reply =
    result.replyTo === "account"
      ? t("report_listing.filed.reply_account")
      : result.replyTo === "email" && result.email
        ? t("report_listing.filed.reply_email", { email: result.email })
        : t("report_listing.filed.reply_none", { reference: result.reference });

  return (
    <div className="flex flex-col gap-4" role="status" aria-live="polite">
      <div className="flex flex-col gap-1">
        <Heading ref={heading} tabIndex={-1} className="text-h3 text-ink focus-visible:outline-none">
          {t("report_listing.filed.title", { business: businessName })}
        </Heading>
        <p className="text-body-sm text-body">{t("report_listing.filed.reference_label")}</p>
        <p className="font-mono text-h2 tracking-wide text-ink" data-testid="report-reference">
          {result.reference}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-caption font-medium text-body">{t("report_listing.filed.next_title")}</p>
        <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-body-sm text-body">
          <li>{t("report_listing.filed.next_check", { days: String(slaDays) })}</li>
          <li>{reply}</li>
          <li>{t("report_listing.filed.next_listing")}</li>
        </ol>
      </div>

      <p className="text-caption text-muted">
        {t("report_listing.filed.status_prefix")}{" "}
        <Link
          href={`/report?ref=${encodeURIComponent(result.reference)}`}
          rel="nofollow"
          /*
             Underlined at rest: it sits inside a sentence, and a link told
             apart from its sentence by colour alone is axe's
             `link-in-text-block` — which the gallery caught on this line.
          */
          className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("report_listing.filed.status_link")}
        </Link>
      </p>

      <div
        className={cn(
          "flex items-center justify-end gap-2",
          layout === "modal" && "-mx-4 -mb-4 border-t border-line bg-paper-sunk px-4 py-3",
        )}
      >
        {onClose ? (
          <Button type="button" onClick={onClose}>
            {t("report_listing.filed.back")}
          </Button>
        ) : (
          <Link href={`/b/${slug}`} className={buttonClassName()}>
            {t("report_listing.filed.back")}
          </Link>
        )}
      </div>
    </div>
  );
}
