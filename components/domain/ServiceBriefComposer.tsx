"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, FieldError, IconButton, Input, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display/Alert";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { hasMessage, t, type MessageKey } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import {
  BRIEF_ATTACHMENT_BYTES,
  BRIEF_CADENCES,
  BRIEF_ENGAGEMENTS,
  BRIEF_MAX_RECIPIENTS,
  BRIEF_START_MODES,
  BUILDING_MAX,
  MAX_BRIEF_ATTACHMENTS,
  SCALE_MAX,
  checkServiceBrief,
  parseSiteValue,
  type BriefField,
  type BriefValue,
  type MatchState,
} from "@/lib/enquiry/service-brief";
import { briefFieldErrors, briefRefusalWords } from "@/lib/enquiry/service-brief-words";
import { ENQUIRY_ATTACHMENT_TYPES, checkEnquiryAttachment, uaeToday } from "@/lib/enquiry/service-enquiry";

/**
 * The brief a buyer writes for work — board `1h-s`, `/rfq/new`.
 *
 * **One screen, five questions, one send, and no field asks a quantity.** The
 * goods composer's stepper existed to walk a buyer through an items table; with
 * no table there is nothing to step through (B1).
 *
 * Presentational and controlled: the value, the files and the match live with
 * the caller, which owns the draft store and the server calls. The gallery
 * renders every state from props with no network.
 *
 * Every string is `t()`, called here. A label *function* crossing from a server
 * component is this repository's most repeated defect, so nothing but data and
 * finished strings comes in.
 */

export type { BriefValue } from "@/lib/enquiry/service-brief";

export interface BriefAreaOption {
  id: string;
  name: string;
  emirate: string;
  isFreeZone: boolean;
}

export interface BriefRail {
  state: MatchState;
  /** Up to three display names, from the same match the send runs. */
  names: readonly string[];
  /** `area` names the area; `emirate` once widened, or when no area was picked. */
  scope: "area" | "emirate";
  /** The named firm, when the buyer arrived from one. */
  pinnedName: string | null;
  /** A preview is in flight — the counts on screen are the last ones. */
  pending?: boolean;
  /** Board `12d`'s queue has the unmatched brief. */
  routed?: boolean;
}

export interface ServiceBriefComposerProps {
  /** The subcategory's name, as the directory prints it. */
  subcategoryName: string;
  /** The scope-sheet family, for placeholders that speak the trade. */
  family: string;
  areas: readonly BriefAreaOption[];
  value: BriefValue;
  onChange: (next: BriefValue) => void;
  files: readonly { name: string; size: number }[];
  onAddFiles: (files: File[]) => void;
  onRemoveFile: (index: number) => void;
  /** Names of files a restored draft had and a page reload lost. */
  lostFiles?: readonly string[];
  /** B8: the warning has been read once and is not asked again. */
  attachWarned: boolean;
  onAttachWarned: () => void;
  rail: BriefRail;
  onWiden?: (widen: boolean) => void;
  onRouteUnmatched?: () => void;
  /** Where to send a buyer who wants the brief matched rather than pinned. */
  unpinHref?: string | null;
  /** The measured median, already formatted, or null under the floor. */
  firstReply: string | null;
  askForContact: boolean;
  /** A named `<form>` is a landmark; the gallery passes one per state. */
  formLabel?: string;
  /**
   * Arrived with the site already answered — `1f-s`'s offer — so the cursor
   * starts in question 02, the next thing only the buyer can say.
   */
  focusDescription?: boolean;
  /**
   * Rendered inside another page — the gallery. The page title drops to an
   * `h2` and the phone's fixed Send bar stays inline, so a specimen cannot
   * claim the document's heading or cover the page it sits in.
   */
  embedded?: boolean;
  busy?: boolean;
  error?: string;
  fieldErrors?: Partial<Record<BriefField, string>>;
  onSubmit?: () => void;
}

export function ServiceBriefComposer({
  subcategoryName,
  family,
  areas,
  value,
  onChange,
  files,
  onAddFiles,
  onRemoveFile,
  lostFiles = [],
  attachWarned,
  onAttachWarned,
  rail,
  onWiden,
  onRouteUnmatched,
  unpinHref = null,
  firstReply,
  askForContact,
  formLabel,
  focusDescription = false,
  embedded = false,
  busy = false,
  error,
  fieldErrors = {},
  onSubmit,
}: ServiceBriefComposerProps) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [local, setLocal] = useState<Partial<Record<BriefField, string>>>({});
  const [warning, setWarning] = useState(false);

  useEffect(() => {
    if (focusDescription) document.getElementById(`${id}-description`)?.focus({ preventScroll: true });
    // Once, on arrival. Refocusing on every change would steal the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
  const site = parseSiteValue(value.site, (areaId) => (areaById.get(areaId)?.emirate as never) ?? null);
  const emirateName = site ? (EMIRATES.find((e) => e.value === site.emirate)?.label ?? null) : null;
  const areaName = site?.areaId ? (areaById.get(site.areaId)?.name ?? null) : null;
  const place = rail.scope === "area" && areaName ? areaName : (emirateName ?? "");

  const errors = { ...fieldErrors, ...local };
  const set = <K extends keyof BriefValue>(key: K, next: BriefValue[K]) => {
    onChange({ ...value, [key]: next });
    if (errors[key as BriefField]) setLocal((prev) => ({ ...prev, [key]: undefined }));
  };
  const describe = (field: BriefField, ...hints: (string | null)[]) =>
    [...hints, errors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  /*
     Site options: an optgroup per emirate, *anywhere in* first and then its
     areas by name. The goods picker's free-zone toggle is a filter for a
     supplier's address; a buyer naming a site needs the place, so a free zone
     is labelled rather than hidden behind a switch.
  */
  const siteGroups = useMemo(
    () =>
      EMIRATES.map((emirate) => ({
        label: emirate.label,
        options: [
          { value: `emirate:${emirate.value}`, label: t("brief.site_anywhere", { emirate: emirate.label }) },
          ...areas
            .filter((area) => area.emirate === emirate.value)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((area) => ({
              value: `area:${area.id}`,
              label: area.isFreeZone ? t("brief.site_free_zone", { area: area.name }) : area.name,
            })),
        ],
      })),
    [areas],
  );

  const pinned = rail.state.kind === "pinned";
  const sendable =
    (rail.state.kind === "matched" && rail.state.count > 0) || (rail.state.kind === "pinned" && rail.state.count === 1);
  const blockedReason = !site
    ? t("brief.blocked_no_site")
    : sendable
      ? null
      : pinned
        ? t("brief.rail_pinned_elsewhere")
        : t("brief.blocked_no_match");

  function sendLabel(): string {
    if (busy) return t("rfq.sending");
    if (rail.state.kind === "pinned" && rail.state.count === 1) {
      return t("brief.send_pinned", { name: rail.pinnedName ?? "" });
    }
    if (rail.state.kind === "matched") {
      // B10: the match, never the cap.
      return t("brief.send", { count: rail.state.count, formatted: formatCount(rail.state.count) });
    }
    return t("brief.send_idle");
  }

  function pickFiles(list: FileList | null) {
    const chosen = [...(list ?? [])];
    if (chosen.length === 0) return;
    if (files.length + chosen.length > MAX_BRIEF_ATTACHMENTS) {
      setLocal((prev) => ({
        ...prev,
        attachments: briefRefusalWords({ field: "attachments", reason: "too_many", max: MAX_BRIEF_ATTACHMENTS }),
      }));
      return;
    }
    for (const file of chosen) {
      const refusal = checkEnquiryAttachment(file.type, file.size);
      if (refusal) {
        setLocal((prev) => ({ ...prev, attachments: briefRefusalWords({ field: "attachments", reason: refusal.reason }) }));
        return;
      }
    }
    setLocal((prev) => ({ ...prev, attachments: undefined }));
    onAddFiles(chosen);
  }

  function attach() {
    // B8: warned once, before the first file is chosen — not after it is sent.
    if (!attachWarned) {
      setWarning(true);
      return;
    }
    fileInput.current?.click();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (blockedReason) return;
    const checked = checkServiceBrief(
      {
        site: value.site,
        building: value.building,
        description: value.description,
        engagement: value.engagement,
        cadence: value.cadence,
        startMode: value.startMode,
        startsOn: value.startsOn,
        scale: value.scale,
        attachments: files.map((file) => ({ type: typeOf(file), bytes: file.size })),
        contactPhone: askForContact ? value.contactPhone : null,
      },
      {
        today: uaeToday(new Date()),
        areaEmirate: (areaId) => (areaById.get(areaId)?.emirate as never) ?? null,
      },
    );
    if (!checked.ok) {
      setLocal(briefFieldErrors(checked.refusals));
      document.getElementById(`${id}-${checked.refusals[0]!.field}`)?.focus();
      return;
    }
    setLocal({});
    onSubmit?.();
  }

  const eyebrow = emirateName
    ? t("brief.eyebrow_place", { trade: subcategoryName, emirate: emirateName })
    : t("brief.eyebrow", { trade: subcategoryName });

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-label={formLabel ?? t("brief.form_label", { trade: subcategoryName })}
      className={cn("mx-auto w-full max-w-7xl", embedded ? "" : "px-5 pb-28 md:pb-10")}
    >
      <div className={embedded ? "" : "pt-8"}>
        <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{eyebrow}</p>
        <Heading embedded={embedded}>{t("brief.h1")}</Heading>
        <p className="mt-2 max-w-[var(--measure-prose)] text-body-sm text-body">
          {pinned ? t("brief.sub_pinned", { name: rail.pinnedName ?? "" }) : t("brief.sub")}
        </p>
      </div>

      <div className="grid gap-[var(--gutter)] py-6 lg:grid-cols-[minmax(0,1fr)_21.25rem] xl:grid-cols-[minmax(0,1fr)_24.25rem]">
        <div className="min-w-0 space-y-4">
          {/* ── 01 · Where is the site? ─────────────────────────────────── */}
          <Question n="01" legend={t("brief.q_site")} legendId={`${id}-q-site`}>
            <p id={`${id}-site-why`} className="text-caption text-body">
              {pinned ? t("brief.q_site_why_pinned", { name: rail.pinnedName ?? "" }) : t("brief.q_site_why")}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
              <div className="flex min-w-0 flex-col gap-1">
                <Select
                  id={`${id}-site`}
                  aria-labelledby={`${id}-q-site`}
                  aria-describedby={describe("site", `${id}-site-why`)}
                  value={value.site}
                  invalid={Boolean(errors.site)}
                  placeholder={t("brief.site_placeholder")}
                  options={[]}
                  groups={siteGroups}
                  onChange={(event) => set("site", event.target.value)}
                />
                <FieldError id={`${id}-site-error`} reserveSpace={false}>
                  {errors.site}
                </FieldError>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <Input
                  id={`${id}-building`}
                  aria-label={t("brief.building")}
                  value={value.building}
                  maxLength={BUILDING_MAX + 20}
                  invalid={Boolean(errors.building)}
                  placeholder={t("brief.building_placeholder")}
                  aria-describedby={describe("building")}
                  onChange={(event) => set("building", event.target.value)}
                />
                <FieldError id={`${id}-building-error`} reserveSpace={false}>
                  {errors.building}
                </FieldError>
              </div>
            </div>
          </Question>

          {/* ── 02 · What needs doing? ──────────────────────────────────── */}
          <Question n="02" legend={t("brief.q_work")} legendId={`${id}-q-work`}>
            <Textarea
              id={`${id}-description`}
              aria-labelledby={`${id}-q-work`}
              aria-describedby={describe("description", `${id}-verbatim`)}
              rows={4}
              value={value.description}
              invalid={Boolean(errors.description)}
              placeholder={familyCopy("need_placeholder", family)}
              onChange={(event) => set("description", event.target.value)}
            />
            <FieldError id={`${id}-description-error`} reserveSpace={false}>
              {errors.description}
            </FieldError>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                {files.length > 0 && (
                  <ul aria-label={t("brief.attach_list")} className="flex flex-wrap gap-2">
                    {files.map((file, index) => (
                      <li
                        key={`${file.name}-${index}`}
                        className="inline-flex max-w-full items-center gap-1 rounded-ctl border border-line bg-paper-sunk py-0.5 pl-3 pr-1 text-caption text-ink"
                      >
                        <span className="truncate">{file.name}</span>
                        <IconButton
                          size="sm"
                          variant="ghost"
                          icon="×"
                          label={t("brief.attach_remove", { name: file.name })}
                          disabled={busy}
                          onClick={() => onRemoveFile(index)}
                        />
                      </li>
                    ))}
                  </ul>
                )}
                {files.length < MAX_BRIEF_ATTACHMENTS ? (
                  <button
                    id={`${id}-attachments`}
                    type="button"
                    onClick={attach}
                    disabled={busy}
                    aria-describedby={describe("attachments", `${id}-attach-hint`)}
                    aria-expanded={!attachWarned ? warning : undefined}
                    className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus disabled:text-disabled-text"
                  >
                    {files.length > 0 ? t("brief.attach_another") : t("brief.attach")}
                  </button>
                ) : (
                  <span className="text-caption text-muted">
                    {t("brief.attach_full", { max: formatCount(MAX_BRIEF_ATTACHMENTS) })}
                  </span>
                )}
              </div>
              <p id={`${id}-verbatim`} className="text-caption text-muted">
                {t("brief.work_verbatim")}
              </p>
            </div>

            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ENQUIRY_ATTACHMENT_TYPES.join(",")}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                pickFiles(event.target.files);
                event.target.value = "";
              }}
            />

            {warning && !attachWarned && (
              <div
                role="group"
                aria-labelledby={`${id}-warn-title`}
                className="mt-3 rounded-ctl border border-warn-line bg-warn-wash px-3.5 py-3"
              >
                <p id={`${id}-warn-title`} className="text-body-sm font-medium text-warn-ink">
                  {t("brief.attach_warn_title")}
                </p>
                <p className="mt-1 text-caption text-warn-ink">
                  {pinned
                    ? t("brief.attach_warn_body_pinned", { name: rail.pinnedName ?? "" })
                    : rail.state.kind === "matched"
                      ? t("brief.attach_warn_body_count", {
                          count: rail.state.count,
                          formatted: formatCount(rail.state.count),
                        })
                      : t("brief.attach_warn_body", { cap: formatCount(BRIEF_MAX_RECIPIENTS) })}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onAttachWarned();
                      setWarning(false);
                      fileInput.current?.click();
                    }}
                  >
                    {t("brief.attach_warn_continue")}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setWarning(false)}>
                    {t("brief.attach_warn_cancel")}
                  </Button>
                </div>
              </div>
            )}

            <p id={`${id}-attach-hint`} className="mt-2 text-caption text-faint">
              {t("brief.attach_hint", {
                mb: formatCount(Math.round(BRIEF_ATTACHMENT_BYTES / (1024 * 1024))),
                max: formatCount(MAX_BRIEF_ATTACHMENTS),
              })}
            </p>
            {lostFiles.length > 0 && files.length === 0 && (
              <p className="mt-1 text-caption text-warn-ink">
                {t("brief.attach_again", { names: lostFiles.join(", ") })}
              </p>
            )}
            <FieldError id={`${id}-attachments-error`} reserveSpace={false}>
              {errors.attachments}
            </FieldError>
          </Question>

          <div className="grid gap-4 md:grid-cols-2">
            {/* ── 03 · Engagement type, then cadence ────────────────────── */}
            <Question n="03" legend={t("brief.q_engagement")} legendId={`${id}-q-engagement`}>
              <Chips
                id={`${id}-engagement`}
                name={`${id}-engagement`}
                labelledBy={`${id}-q-engagement`}
                describedBy={describe("engagement")}
                value={value.engagement}
                options={BRIEF_ENGAGEMENTS.map((option) => ({
                  value: option,
                  label: t(`engagement.${option}` as MessageKey),
                }))}
                onChange={(next) =>
                  // B4: a cadence belongs to an ongoing contract, and leaving
                  // one for another engagement would post a refused answer.
                  onChange({ ...value, engagement: next, cadence: next === "ongoing_contract" ? value.cadence : "" })
                }
              />
              <FieldError id={`${id}-engagement-error`} reserveSpace={false}>
                {errors.engagement}
              </FieldError>

              {value.engagement === "ongoing_contract" && (
                <div className="mt-3">
                  <p id={`${id}-q-cadence`} className="sr-only">
                    {t("brief.q_cadence")}
                  </p>
                  <Chips
                    id={`${id}-cadence`}
                    name={`${id}-cadence`}
                    labelledBy={`${id}-q-cadence`}
                    describedBy={describe("cadence")}
                    tone="solid"
                    value={value.cadence}
                    options={BRIEF_CADENCES.map((option) => ({
                      value: option,
                      label: t(`brief.cadence.${option}` as MessageKey),
                    }))}
                    onChange={(next) => set("cadence", next)}
                  />
                  <FieldError id={`${id}-cadence-error`} reserveSpace={false}>
                    {errors.cadence}
                  </FieldError>
                </div>
              )}
            </Question>

            {/* ── 04 · When from? ───────────────────────────────────────── */}
            <Question n="04" legend={t("brief.q_start")} legendId={`${id}-q-start`}>
              <Chips
                id={`${id}-start`}
                name={`${id}-start`}
                labelledBy={`${id}-q-start`}
                describedBy={describe("start")}
                value={value.startMode}
                options={BRIEF_START_MODES.map((option) => ({
                  value: option,
                  label: t(`brief.start.${option}` as MessageKey),
                }))}
                onChange={(next) => onChange({ ...value, startMode: next, startsOn: next === "asap" ? "" : value.startsOn })}
              />
              {value.startMode === "from_date" && (
                <div className="mt-3">
                  <Input
                    id={`${id}-starts-on`}
                    type="date"
                    aria-label={t("brief.start_date")}
                    value={value.startsOn}
                    min={uaeToday(new Date())}
                    invalid={Boolean(errors.start)}
                    aria-describedby={describe("start")}
                    onChange={(event) => set("startsOn", event.target.value)}
                  />
                </div>
              )}
              <FieldError id={`${id}-start-error`} reserveSpace={false}>
                {errors.start}
              </FieldError>
            </Question>
          </div>

          {/* ── 05 · Roughly what scale? ─────────────────────────────────── */}
          <Question
            n="05"
            legend={t("brief.q_scale")}
            legendId={`${id}-q-scale`}
            aside={t("brief.scale_optional")}
          >
            <Input
              id={`${id}-scale`}
              aria-labelledby={`${id}-q-scale`}
              aria-describedby={describe("scale", `${id}-scale-why`)}
              value={value.scale}
              maxLength={SCALE_MAX + 20}
              invalid={Boolean(errors.scale)}
              placeholder={familyCopy("scale_placeholder", family)}
              onChange={(event) => set("scale", event.target.value)}
            />
            <FieldError id={`${id}-scale-error`} reserveSpace={false}>
              {errors.scale}
            </FieldError>
            <p id={`${id}-scale-why`} className="mt-2 text-caption text-body">
              {t("brief.scale_why")}
            </p>
          </Question>

          {askForContact && (
            <section aria-labelledby={`${id}-contact-title`} className="rounded-card border border-line bg-card p-5">
              <h2 id={`${id}-contact-title`} className="text-body font-medium text-ink">
                {t("brief.contact_title")}
              </h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption font-medium text-body">{t("rfq.contact_name")}</span>
                  <Input
                    id={`${id}-name`}
                    autoComplete="name"
                    value={value.contactName}
                    aria-describedby={`${id}-name-hint`}
                    onChange={(event) => set("contactName", event.target.value)}
                  />
                  <span id={`${id}-name-hint`} className="text-caption text-muted">
                    {t("rfq.contact_name_hint")}
                  </span>
                </label>
                <label className="flex min-w-0 flex-col gap-1">
                  <span className="text-caption font-medium text-body">{t("rfq.contact")}</span>
                  <Input
                    id={`${id}-contact`}
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    value={value.contactPhone}
                    invalid={Boolean(errors.contact)}
                    aria-describedby={describe("contact", `${id}-phone-hint`)}
                    onChange={(event) => set("contactPhone", event.target.value)}
                  />
                  <span id={`${id}-phone-hint`} className="text-caption text-muted">
                    {t("rfq.contact_hint")}
                  </span>
                  <FieldError id={`${id}-contact-error`} reserveSpace={false}>
                    {errors.contact}
                  </FieldError>
                </label>
              </div>
            </section>
          )}
        </div>

        {/* ── The rail ──────────────────────────────────────────────────── */}
        <div className="min-w-0 space-y-4">
          <div className="rounded-card border border-line bg-card p-5" aria-busy={rail.pending || undefined}>
            <h2 className="text-body font-medium text-ink">{t("brief.rail_title")}</h2>
            <RailBody
              rail={rail}
              subcategoryName={subcategoryName}
              place={place}
              emirateName={emirateName}
              areaName={areaName}
              unpinHref={unpinHref}
              onWiden={onWiden}
              onRouteUnmatched={onRouteUnmatched}
              busy={busy}
            />
          </div>

          <div className="rounded-card border border-ok-line bg-ok-wash p-5">
            <h2 className="font-mono text-eyebrow uppercase tracking-eyebrow text-ok-ink">
              {t("brief.next_eyebrow")}
            </h2>
            <p className="mt-2 text-body-sm text-body">
              {/*
                 The render says *most buyers get their first proposal back in
                 under an hour*. Measured over the last ninety days of briefs at
                 the reply-time floor, or not said at all.
              */}
              {firstReply ? `${t("brief.next_measured", { duration: firstReply })} ` : ""}
              {t("brief.next_body")}
            </p>
          </div>

          <p className="rounded-card border border-line bg-paper-sunk p-5 text-body-sm text-body">
            {t("brief.privacy")}
          </p>

          {error && (
            <Alert tone="bad" live="assertive" fix={t("brief.error_fix")}>
              {error}
            </Alert>
          )}

          <div className={embedded ? "" : "hidden md:block"}>
            <SendBlock label={sendLabel()} busy={busy} blocked={blockedReason} />
          </div>
        </div>
      </div>

      {/* Below 768 Send travels with the buyer, carrying the live count. */}
      {!embedded && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card px-4 py-2.5 shadow-overlay md:hidden">
          <SendBlock label={sendLabel()} busy={busy} blocked={blockedReason} />
        </div>
      )}
    </form>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function Heading({ embedded, children }: { embedded: boolean; children: string }) {
  const className = "mt-2 font-serif text-h1-serif text-ink";
  return embedded ? <h2 className={className}>{children}</h2> : <h1 className={className}>{children}</h1>;
}

function Question({
  n,
  legend,
  legendId,
  aside,
  children,
}: {
  n: string;
  legend: string;
  legendId: string;
  aside?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="min-w-0 rounded-card border border-line bg-card p-5">
      {/*
         The legend is the question, visible, and the id the controls inside are
         labelled by. The number is decoration and stays out of the name; the
         aside is part of it, because *optional* is something a screen reader
         user needs to hear too.
      */}
      <legend id={legendId} className="float-left flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 p-0">
        <span aria-hidden="true" className="font-mono text-caption tabular-nums text-faint">
          {n}
        </span>
        <span className="text-body font-medium text-ink">{legend}</span>
        {aside && <span className="text-caption text-muted">{aside}</span>}
      </legend>
      <div className="clear-both pt-2">{children}</div>
    </fieldset>
  );
}

/**
 * A question's answers as chips — native radios underneath.
 *
 * Not `SegmentedControl`: its roving tab stop lives on the selected segment, so
 * a group with nothing chosen yet had no tab stop at all, and every one of these
 * starts unanswered. Native radios in a named group give the keyboard the
 * platform's own behaviour — Tab into the group, arrows between answers — with
 * nothing chosen until the buyer chooses.
 */
function Chips({
  id,
  name,
  labelledBy,
  describedBy,
  value,
  options,
  onChange,
  tone = "outline",
}: {
  id: string;
  name: string;
  labelledBy: string;
  describedBy: string | undefined;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  tone?: "outline" | "solid";
}) {
  return (
    <div id={id} role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy} tabIndex={-1} className="flex flex-wrap gap-2 focus-visible:outline-none">
      {options.map((option) => {
        const checked = value === option.value;
        return (
          <label key={option.value} className="relative inline-flex cursor-pointer">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              onChange={() => onChange(option.value)}
              className="peer absolute inset-0 cursor-pointer opacity-0"
            />
            <span
              className={cn(
                "inline-flex min-h-9 items-center border px-3.5 text-body-sm",
                "transition-colors duration-120 ease-out peer-focus-visible:shadow-focus",
                tone === "solid" ? "rounded-pill" : "rounded-chip",
                tone === "solid"
                  ? checked
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-paper-sunk text-body hover:border-line-strong"
                  : checked
                    ? "border-ink bg-paper-sunk font-medium text-ink"
                    : "border-line bg-card text-body hover:border-line-strong",
              )}
            >
              {option.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

function RailBody({
  rail,
  subcategoryName,
  place,
  emirateName,
  areaName,
  unpinHref,
  onWiden,
  onRouteUnmatched,
  busy,
}: {
  rail: BriefRail;
  subcategoryName: string;
  place: string;
  emirateName: string | null;
  areaName: string | null;
  unpinHref: string | null;
  onWiden: ((widen: boolean) => void) | undefined;
  onRouteUnmatched: (() => void) | undefined;
  busy: boolean;
}) {
  const state = rail.state;
  const body = "mt-2 text-body-sm text-body";

  if (state.kind === "no_site") return <p className={body}>{t("brief.rail_no_site")}</p>;

  if (state.kind === "pinned") {
    return (
      <div aria-live="polite">
        <p className={body}>
          {state.count === 1
            ? t("brief.rail_pinned", { name: rail.pinnedName ?? "" })
            : t("brief.rail_pinned_undelivered", { name: rail.pinnedName ?? "" })}
        </p>
        {unpinHref && (
          <a
            href={unpinHref}
            className="mt-3 inline-block rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("brief.rail_pinned_elsewhere")}
          </a>
        )}
      </div>
    );
  }

  if (state.kind === "widen") {
    return (
      <div aria-live="polite">
        <p className={body}>
          {t("brief.rail_widen", {
            count: state.emirateCount,
            formatted: formatCount(state.emirateCount),
            area: areaName ?? "",
            emirate: emirateName ?? "",
          })}
        </p>
        {onWiden && (
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => onWiden(true)}>
              {t("brief.widen", { emirate: emirateName ?? "" })}
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (state.kind === "none") {
    return (
      <div aria-live="polite">
        <p className={body}>{t("brief.rail_none", { trade: subcategoryName, place })}</p>
        {onRouteUnmatched && (
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" disabled={busy || rail.routed} onClick={onRouteUnmatched}>
              {t("brief.route_for_me")}
            </Button>
          </div>
        )}
        {rail.routed && (
          <p role="status" className="mt-2 text-caption text-body">
            {t("brief.routed", { place })}
          </p>
        )}
      </div>
    );
  }

  const more = state.count - rail.names.length;
  return (
    <div aria-live="polite">
      <p className={body}>
        {rail.scope === "area" && areaName
          ? t("brief.rail_matched_area", { cap: formatCount(BRIEF_MAX_RECIPIENTS), trade: subcategoryName, place })
          : t("brief.rail_matched_emirate", { cap: formatCount(BRIEF_MAX_RECIPIENTS), trade: subcategoryName, place })}
      </p>
      {rail.scope === "emirate" && areaName && onWiden && (
        <p className="mt-2 text-caption text-body">
          {t("brief.widened", { emirate: emirateName ?? "", area: areaName })}{" "}
          <button
            type="button"
            onClick={() => onWiden(false)}
            className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
          >
            {t("brief.unwiden", { area: areaName })}
          </button>
        </p>
      )}
      <ul aria-label={t("brief.rail_names")} className="mt-4 space-y-2 border-t border-line pt-4">
        {rail.names.map((name) => (
          <li key={name} className="flex items-baseline gap-2.5 text-body-sm text-ink">
            <span aria-hidden="true" className="text-caption text-ok-ink">
              ✓
            </span>
            {name}
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="mt-2 text-caption text-body">
          {rail.scope === "area" && areaName
            ? t("brief.rail_more_area", { count: more, formatted: formatCount(more) })
            : t("brief.rail_more_emirate", { count: more, formatted: formatCount(more), place })}
        </p>
      )}
      {state.thin && (
        <p className="mt-2 text-caption text-body">
          {t("brief.rail_thin", { count: state.count, formatted: formatCount(state.count) })}
        </p>
      )}
    </div>
  );
}

function SendBlock({ label, busy, blocked }: { label: string; busy: boolean; blocked: string | null }) {
  return (
    <div>
      <Button type="submit" block size="lg" loading={busy} disabled={Boolean(blocked)}>
        {label}
      </Button>
      {/* Never a silent dead button: the reason sits under it. */}
      <p className={cn("mt-1.5 text-center text-caption", blocked ? "text-warn-ink" : "text-muted")}>
        {blocked ?? t("brief.send_after")}
      </p>
    </div>
  );
}

/** The browser's reported type, or one inferred from the name where it gave none. */
function typeOf(file: { name: string; size: number; type?: string }): string {
  if (file.type) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return extension === "pdf" ? "application/pdf" : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "";
}

/**
 * A family's copy where somebody wrote it, the general copy where nobody has —
 * the storefront composer's placeholders, read by the same key, so a firm's
 * form and the brief speak one trade's language.
 */
function familyCopy(slot: "need_placeholder" | "scale_placeholder", family: string): string {
  const own = `storefront_services.composer.${slot}.${family.replace(/-/g, "_")}`;
  return hasMessage(own) ? t(own as MessageKey) : t(`storefront_services.composer.${slot}.general` as MessageKey);
}
