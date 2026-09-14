"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { Tag } from "@/components/display";
import { Button, buttonClassName, Textarea } from "@/components/primitives";
import { Close, Plus } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import { downscaleImage, storedName } from "@/lib/images/downscale";
import { DIMENSIONS, type Dimension, type Provenance } from "@/lib/reviews/eligibility";
import {
  contactDetailsIn,
  DIMENSION_HINT,
  DIMENSION_LABEL,
  graphemeCount,
  MAX_REVIEW_PHOTOS,
  OVERALL_SENTENCE,
  OVERALL_WORD,
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  REVIEW_PHOTO_INPUT_BYTES,
  REVIEW_PHOTO_INPUT_TYPES,
  REVIEW_PHOTO_MIN_EDGE,
  reviewProblems,
  SCORES,
  type ReviewFields,
  type ReviewPhotoRef,
} from "@/lib/reviews/write";
import { contactKindWords } from "@/lib/reviews/write-view";
import {
  addReviewPhotoAction,
  editReviewAction,
  postReviewAction,
  saveReviewDraftAction,
  signReviewPhotoAction,
} from "../actions";
import { RailPanel, ReviewCopy } from "./_parts";

/**
 * Board 10f — the form, and the preview beside it that moves as it is filled.
 *
 * Renders both grid columns: the question column, and the rail with the live
 * *How it will appear* card between the server-rendered panels passed in. The
 * preview is `ReviewCopy`, which is the listing's own row mapping, so what the
 * buyer watches forming is the row board 1m will print.
 *
 * Every score is a radio group drawn as squares — a radio group is exactly this
 * control, keyboard and screen reader included — and the four dimensions can be
 * cleared back to *skipped* (`B4`). Post is enabled on exactly the rules the
 * service refuses on (`reviewProblems`), and says what is missing while it is
 * not.
 *
 * `live={false}` is the gallery: nothing is sent anywhere.
 */

export interface ReviewWriteFormProps {
  mode: "new" | "edit";
  enquiryId: string;
  /** The supplier the gate resolved. Sent back so a fan-out's review lands on the one the page named. */
  businessId: string;
  reviewId: string | null;
  token: string | null;
  initial: ReviewFields;
  photoUrls: Record<string, string>;
  company: string | null;
  supplierName: string;
  supplierListed: boolean;
  provenance: Provenance;
  /** ISO. The day the preview dates the review: today, or the original post on an edit. */
  postedAt: string;
  draftSavedAt: string | null;
  cancelHref: string | null;
  /** Server-rendered rail panels above and below the preview. */
  railTop: React.ReactNode;
  railBottom: React.ReactNode;
  /** The title, lede and job card. */
  header: React.ReactNode;
  live?: boolean;
  /** Distinct element ids when the gallery draws more than one. */
  idPrefix?: string;
}

type DraftStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "failed"; message: string };

const AUTOSAVE_MS = 1500;

export function ReviewWriteForm(props: ReviewWriteFormProps) {
  const live = props.live ?? true;
  const FormTag = live ? "form" : "div";
  const RailTag = live ? "aside" : "div";
  const prefix = props.idPrefix ?? "review";
  const [fields, setFields] = useState<ReviewFields>(props.initial);
  const [urls, setUrls] = useState<Record<string, string>>(props.photoUrls);
  const [error, setError] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [draft, setDraft] = useState<DraftStatus>(
    props.draftSavedAt ? { kind: "saved", at: props.draftSavedAt } : { kind: "idle" },
  );
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  /** What the server holds, so an unchanged form (and React's development double effect) saves nothing. */
  const lastSaved = useRef(JSON.stringify(props.initial));
  const posting = useRef(false);

  const target = useMemo(
    () => ({ enquiryId: props.enquiryId, businessId: props.businessId, token: props.token }),
    [props.enquiryId, props.businessId, props.token],
  );

  const problems = reviewProblems(fields);
  const bodyCount = graphemeCount(fields.body.trim());
  const contactKinds = contactDetailsIn(fields.body);
  const canPost = problems.length === 0 && uploading === null && !pending;

  const update = (patch: Partial<ReviewFields>) => {
    setError(null);
    setFields((current) => ({ ...current, ...patch }));
  };

  /* ── Autosave (`B9`): one draft per enquiry, never on an edit, never after Post. ── */
  const save = async (snapshot: ReviewFields) => {
    if (!live || props.mode !== "new" || posting.current) return;
    setDraft({ kind: "saving" });
    const result = await saveReviewDraftAction(target, snapshot);
    if (posting.current) return;
    if (result.ok) lastSaved.current = JSON.stringify(snapshot);
    setDraft(result.ok ? { kind: "saved", at: result.savedAt } : { kind: "failed", message: result.error });
  };

  useEffect(() => {
    if (!live || props.mode !== "new") return;
    if (JSON.stringify(fields) === lastSaved.current) return;
    const timer = setTimeout(() => void save(fields), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // `save` closes over the target only; the fields are the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  /* ── Photos (`B6`): pick, shrink in the browser, sign, upload, strip on the server. ── */
  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0 || !live) return;
    setPhotoError(null);
    const room = MAX_REVIEW_PHOTOS - fields.photos.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > room) setPhotoError(t("reviewwrite.photo.error.count", { max: MAX_REVIEW_PHOTOS }));

    const added: { photo: ReviewPhotoRef; url: string }[] = [];
    for (const [index, file] of list.entries()) {
      setUploading({ done: index, total: list.length });
      if (!(REVIEW_PHOTO_INPUT_TYPES as readonly string[]).includes(file.type)) {
        setPhotoError(t("reviewwrite.photo.error.type"));
        continue;
      }
      if (file.size > REVIEW_PHOTO_INPUT_BYTES) {
        setPhotoError(
          t("reviewwrite.photo.error.size", { size: (file.size / 1024 / 1024).toFixed(1), max: REVIEW_PHOTO_INPUT_BYTES / 1024 / 1024 }),
        );
        continue;
      }
      const shrunk = await downscaleImage(file, { minEdge: REVIEW_PHOTO_MIN_EDGE });
      if (!shrunk.ok) {
        setPhotoError(
          shrunk.error === "too_small"
            ? t("reviewwrite.photo.error.too_small", { edge: shrunk.longEdge ?? 0, min: REVIEW_PHOTO_MIN_EDGE })
            : t("reviewwrite.photo.error.unreadable"),
        );
        continue;
      }
      const { blob, type, bytes } = shrunk.image;
      const signed = await signReviewPhotoAction(target, { filename: storedName(file.name, type), type, bytes });
      if (!signed.ok) {
        setPhotoError(signed.error);
        continue;
      }
      const response = await fetch(signed.url, { method: "PUT", headers: { "content-type": type }, body: blob });
      if (!response.ok) {
        setPhotoError(t("reviewwrite.photo.error.upload"));
        continue;
      }
      const recorded = await addReviewPhotoAction(target, signed.path);
      if (!recorded.ok) {
        setPhotoError(recorded.error);
        continue;
      }
      added.push({ photo: recorded.photo, url: recorded.url });
    }
    setUploading(null);
    if (fileInput.current) fileInput.current.value = "";
    if (added.length > 0) {
      setUrls((current) => ({ ...current, ...Object.fromEntries(added.map((item) => [item.photo.path, item.url])) }));
      setFields((current) => ({
        ...current,
        photos: [...current.photos, ...added.map((item) => item.photo)].slice(0, MAX_REVIEW_PHOTOS),
      }));
    }
  };

  const removePhoto = (path: string) => update({ photos: fields.photos.filter((photo) => photo.path !== path) });

  /* ── Post / save changes. ── */
  const submit = () => {
    if (!canPost || !live) return;
    setError(null);
    posting.current = true;
    startTransition(async () => {
      const result =
        props.mode === "edit" && props.reviewId
          ? await editReviewAction({ ...target, reviewId: props.reviewId }, fields)
          : await postReviewAction(target, fields);
      // A successful write redirects and never returns here.
      if (result && !result.ok) {
        posting.current = false;
        setError(result.error);
      }
    });
  };

  const missing = missingWords(problems.map((problem) => problem.code));
  const bodyId = `${prefix}-body`;
  const bodyHintId = `${prefix}-body-hint`;
  const bodyErrorId = `${prefix}-body-error`;
  const missingId = `${prefix}-missing`;

  return (
    <>
      <div className="min-w-0">
        {props.header}

        {/*
           A named form is a landmark, and the gallery draws this page several
           times; a specimen renders the same markup inside a div, which is the
           `10h` accept dialog's answer to the same landmarks spec.
        */}
        <FormTag
          className="mt-5"
          {...(live
            ? {
                "aria-label": t(props.mode === "edit" ? "reviewwrite.form.edit_label" : "reviewwrite.form.label", {
                  supplier: props.supplierName,
                }),
                onSubmit: (event: React.FormEvent) => {
                  event.preventDefault();
                  submit();
                },
              }
            : {})}
        >
          <div className="divide-y divide-line rounded-card border border-line bg-card">
            {/* Overall — required, and never the mean of the four below (`B3`). */}
            {/*
               A labelled radiogroup rather than a fieldset: a legend will not sit
               in a row with the REQUIRED eyebrow without fighting the fieldset's
               own layout, and the group's name is the same either way.
            */}
            <div role="radiogroup" aria-labelledby={`${prefix}-overall-label`} aria-required="true" className="min-w-0 p-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id={`${prefix}-overall-label`} className="text-body font-medium text-ink">
                  {t("review.overall")}
                </h2>
                <span aria-hidden="true" className="font-mono text-eyebrow uppercase text-muted">
                  {t("reviewwrite.required")}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <ScoreSquares
                  name={`${prefix}-overall`}
                  value={fields.overall}
                  onChange={(overall) => update({ overall })}
                  size="lg"
                  wordFor={(score) => t(OVERALL_WORD[score])}
                />
                <p className="text-body text-ink" aria-live="polite">
                  {fields.overall === null
                    ? t("reviewwrite.overall.unset")
                    : t("reviewwrite.overall.chosen", {
                        score: fields.overall,
                        sentence: t(OVERALL_SENTENCE[fields.overall as 1 | 2 | 3 | 4 | 5]),
                      })}
                </p>
              </div>
              <ol aria-hidden="true" className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-eyebrow uppercase text-muted">
                {SCORES.map((score) => (
                  <li key={score}>
                    {score} {t(OVERALL_WORD[score])}
                  </li>
                ))}
              </ol>
            </div>

            {/* The four dimensions — 1m's keys, labels and order (`B2`), each skippable (`B4`). */}
            <div className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-body font-medium text-ink">{t("reviewwrite.dimensions.title")}</h2>
                <p className="text-body-sm text-muted">{t("reviewwrite.dimensions.skip")}</p>
              </div>
              <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-2">
                {DIMENSIONS.map((key) => (
                  <DimensionField
                    key={key}
                    dimension={key}
                    name={`${prefix}-${key}`}
                    value={fields[key]}
                    onChange={(value) => update({ [key]: value } as Partial<ReviewFields>)}
                  />
                ))}
              </div>
            </div>

            {/* The body — graphemes, 40 to 800 (`B5`), no contact details. */}
            <div className="p-5">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={bodyId} className="text-body font-medium text-ink">
                  {t("reviewwrite.body.label")}
                </label>
                <span
                  className={cn(
                    "font-mono text-eyebrow tabular-nums",
                    bodyCount > REVIEW_BODY_MAX ? "text-bad-ink" : "text-muted",
                  )}
                >
                  {t("reviewwrite.body.counter", { count: bodyCount, max: REVIEW_BODY_MAX })}
                </span>
              </div>
              <p id={bodyHintId} className="mt-1 text-body-sm text-muted">
                {t("reviewwrite.body.hint")}
              </p>
              <div className="mt-3">
                <Textarea
                  id={bodyId}
                  rows={4}
                  value={fields.body}
                  onChange={(event) => update({ body: event.target.value })}
                  invalid={contactKinds.length > 0 || bodyCount > REVIEW_BODY_MAX}
                  aria-describedby={cn(bodyHintId, (contactKinds.length > 0 || bodyCount > REVIEW_BODY_MAX) && bodyErrorId)}
                  placeholder={t("reviewwrite.body.placeholder")}
                />
              </div>
              {contactKinds.length > 0 || bodyCount > REVIEW_BODY_MAX ? (
                <p id={bodyErrorId} className="mt-2 text-body-sm text-bad-ink">
                  {contactKinds.length > 0
                    ? t("reviewwrite.error.contact_details", { kinds: contactKindWords(contactKinds) })
                    : t("reviewwrite.error.body_long", { max: REVIEW_BODY_MAX })}
                </p>
              ) : null}
              <ul className="mt-3 flex flex-wrap gap-2" aria-label={t("reviewwrite.body.rules_label")}>
                <li>
                  <Tag>{t("reviewwrite.body.rule.contact")}</Tag>
                </li>
                <li>
                  <Tag>{t("reviewwrite.body.rule.attachments")}</Tag>
                </li>
                <li>
                  <Tag>{t("reviewwrite.body.rule.report")}</Tag>
                </li>
              </ul>
            </div>

            {/* Photos (`B6`). */}
            <div className="p-5">
              <h2 className="text-body font-medium text-ink">{t("reviewwrite.photo.title")}</h2>
              <p className="mt-1 text-body-sm text-muted">{t("reviewwrite.photo.hint")}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ul className="contents">
                  {fields.photos.map((photo, index) => (
                    <li key={photo.path} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={urls[photo.path] ?? ""}
                        alt={t("reviewwrite.photo.alt", { n: index + 1 })}
                        className="h-20 w-24 rounded-ctl border border-line bg-paper-sunk object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removePhoto(photo.path)}
                        disabled={!live}
                        aria-label={t("reviewwrite.photo.remove", { n: index + 1 })}
                        className="absolute -right-2 -top-2 flex size-6 items-center justify-center rounded-pill border border-line-strong bg-card text-ink shadow-overlay hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
                      >
                        <Close size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
                {fields.photos.length < MAX_REVIEW_PHOTOS ? (
                  <>
                    <input
                      ref={fileInput}
                      id={`${prefix}-photos`}
                      type="file"
                      accept={REVIEW_PHOTO_INPUT_TYPES.join(",")}
                      multiple
                      className="sr-only"
                      tabIndex={-1}
                      aria-label={t("reviewwrite.photo.add")}
                      onChange={(event) => void addPhotos(event.target.files)}
                    />
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                      disabled={!live || uploading !== null}
                      aria-describedby={`${prefix}-photo-count`}
                      className="flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-ctl border border-dashed border-line-strong bg-card text-caption text-muted hover:border-moss hover:text-ink focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-not-allowed"
                    >
                      <Plus size={16} />
                      {t("reviewwrite.photo.add")}
                    </button>
                  </>
                ) : null}
                <p id={`${prefix}-photo-count`} className="text-body-sm text-muted" aria-live="polite">
                  {uploading
                    ? t("reviewwrite.photo.uploading", { n: uploading.done + 1, total: uploading.total })
                    : t("reviewwrite.photo.count", {
                        count: fields.photos.length,
                        max: MAX_REVIEW_PHOTOS,
                        size: REVIEW_PHOTO_INPUT_BYTES / 1024 / 1024,
                      })}
                </p>
              </div>
              {photoError ? <p className="mt-2 text-body-sm text-bad-ink">{photoError}</p> : null}
            </div>

            {/* Signing (`B7`): a rendering decision, never a weaker gate. */}
            <div role="radiogroup" aria-labelledby={`${prefix}-signing-label`} className="min-w-0 p-5">
              <h2 id={`${prefix}-signing-label`} className="text-body font-medium text-ink">
                {t("reviewwrite.signing.title")}
              </h2>
              <div className="mt-3 flex flex-col gap-2.5">
                {props.company ? (
                  <SigningOption
                    name={`${prefix}-signing`}
                    checked={fields.showCompanyName}
                    onSelect={() => update({ showCompanyName: true })}
                    title={props.company}
                    description={t("reviewwrite.signing.company")}
                  />
                ) : null}
                <SigningOption
                  name={`${prefix}-signing`}
                  checked={!props.company || !fields.showCompanyName}
                  onSelect={() => update({ showCompanyName: false })}
                  title={t("storefront.review_anonymous")}
                  description={t("reviewwrite.signing.anonymous")}
                />
              </div>
              {props.company ? null : (
                <p className="mt-2 text-caption text-muted">{t("reviewwrite.signing.no_company")}</p>
              )}
            </div>
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-ctl border border-bad-line bg-bad-surface px-3 py-2 text-body-sm text-bad-ink">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              loading={pending}
              disabled={!canPost}
              aria-describedby={missing ? missingId : undefined}
            >
              {t(props.mode === "edit" ? "reviewwrite.action.save" : "reviewwrite.action.post")}
            </Button>
            {props.mode === "new" ? (
              <Button
                type="button"
                variant="secondary"
                size="lg"
                disabled={!live || pending}
                onClick={() => void save(fields)}
              >
                {t("reviewwrite.action.draft")}
              </Button>
            ) : props.cancelHref ? (
              <Link href={props.cancelHref} className={buttonClassName({ variant: "secondary", size: "lg" })}>
                {t("reviewwrite.action.cancel")}
              </Link>
            ) : null}
            <p className="text-body-sm text-muted">{t("reviewwrite.action.checked")}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 text-caption" aria-live="polite">
            {missing ? (
              <p id={missingId} className="text-muted">
                {missing}
              </p>
            ) : null}
            {props.mode === "new" ? <DraftLine status={draft} /> : null}
          </div>
        </FormTag>
      </div>

      <RailTag
        {...(live ? { "aria-label": t("reviewwrite.rail_label") } : {})}
        className="flex min-w-0 flex-col gap-4"
      >
        {props.railTop}
        <RailPanel title={t("reviewwrite.preview.title")}>
          <ReviewCopy
            fields={fields}
            photoUrls={urls}
            company={props.company}
            supplierName={props.supplierName}
            provenance={props.provenance}
            postedAt={new Date(props.postedAt)}
          />
          <p className="mt-3 text-caption text-muted">
            {t(props.supplierListed ? "reviewwrite.preview.note" : "reviewwrite.preview.note_unlisted", {
              supplier: props.supplierName,
            })}
          </p>
        </RailPanel>
        {props.railBottom}
      </RailTag>
    </>
  );
}

function DraftLine({ status }: { status: DraftStatus }) {
  switch (status.kind) {
    case "idle":
      return null;
    case "saving":
      return <p className="text-muted">{t("reviewwrite.draft.saving")}</p>;
    case "saved":
      return <p className="text-muted">{t("reviewwrite.draft.saved", { time: formatTime(new Date(status.at)) })}</p>;
    case "failed":
      return <p className="text-bad-ink">{t("reviewwrite.draft.failed", { reason: status.message })}</p>;
  }
}

function missingWords(codes: readonly string[]): string | null {
  const wants = [
    codes.includes("overall_missing") ? t("reviewwrite.missing.overall") : null,
    codes.includes("body_short") ? t("reviewwrite.missing.body", { min: REVIEW_BODY_MIN }) : null,
  ].filter((value): value is string => value !== null);
  if (wants.length === 0) return null;
  return t("reviewwrite.missing.sentence", { things: wants.join(t("reviewwrite.missing.and")) });
}

/** One to five as squares. A radio group underneath, so arrow keys and screen readers work. */
function ScoreSquares({
  name,
  value,
  onChange,
  size,
  wordFor,
  label,
}: {
  name: string;
  value: number | null;
  onChange: (score: number) => void;
  size: "lg" | "md";
  wordFor?: (score: 1 | 2 | 3 | 4 | 5) => string;
  label?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {SCORES.map((score) => (
        <label key={score} className="relative cursor-pointer">
          <input
            type="radio"
            name={name}
            value={score}
            checked={value === score}
            onChange={() => onChange(score)}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              "block rounded-[3px] transition-colors duration-120 ease-out",
              "peer-focus-visible:shadow-focus peer-hover:ring-1 peer-hover:ring-moss",
              size === "lg" ? "h-10 w-11" : "size-8",
              value !== null && score <= value ? "bg-moss" : "bg-line",
            )}
          />
          <span className="sr-only">
            {label ? `${label}, ` : ""}
            {wordFor ? t("reviewwrite.score_worded", { score, word: wordFor(score) }) : t("reviewwrite.score", { score })}
          </span>
        </label>
      ))}
    </div>
  );
}

function DimensionField({
  dimension,
  name,
  value,
  onChange,
}: {
  dimension: Dimension;
  name: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const hintId = useId();
  const label = t(DIMENSION_LABEL[dimension]);
  return (
    <fieldset className="min-w-0" aria-describedby={hintId}>
      <legend className="text-body-sm text-ink">{label}</legend>
      <p id={hintId} className="text-body-sm text-muted">
        {t(DIMENSION_HINT[dimension])}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <ScoreSquares name={name} value={value} onChange={onChange} size="md" />
        <span className={cn("text-caption", value === null ? "text-muted" : "font-mono tabular-nums text-ink")}>
          {value === null ? t("review.dimension_skipped") : value}
        </span>
        {value !== null ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("reviewwrite.dimensions.clear_label", { dimension: label })}
            className="rounded-tag text-caption text-muted underline underline-offset-2 hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("reviewwrite.dimensions.clear")}
          </button>
        ) : null}
      </div>
    </fieldset>
  );
}

function SigningOption({
  name,
  checked,
  onSelect,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border bg-card px-4 py-3.5 transition-colors duration-120",
        checked ? "border-ink" : "border-line hover:border-line-strong",
        "has-[:focus-visible]:shadow-focus",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 size-4 shrink-0 cursor-pointer appearance-none rounded-pill border border-line-strong bg-card checked:border-[5px] checked:border-ink focus-visible:outline-none"
      />
      <span className="min-w-0">
        <span className="block text-body-sm font-medium text-ink">{title}</span>
        <span className="block text-body-sm text-muted">{description}</span>
      </span>
    </label>
  );
}
