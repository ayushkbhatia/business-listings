"use client";

import { useEffect, useId, useState } from "react";
import { Button, FieldError, FileDrop, Input, Label, Select, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display/Alert";
import { formatCount } from "@/lib/format";
import { hasMessage, t, type MessageKey } from "@/lib/i18n";
import {
  ENQUIRY_ATTACHMENT_BYTES,
  ENQUIRY_ATTACHMENT_TYPES,
  SCALE_MAX,
  checkServiceEnquiry,
  uaeToday,
  type ServiceEnquiryField,
} from "@/lib/enquiry/service-enquiry";
import { refusalWords } from "@/lib/enquiry/service-enquiry-words";
import { SERVICE_ENQUIRY_SELECT } from "./EnquireServiceLink";

/**
 * The enquiry form a firm that sells work carries — board `1d-s`.
 *
 * *"The enquiry form asks for a situation, not a quantity."* Compare the goods
 * composer, which asks for lines, quantities and a delivery date: the shape of
 * the first message is different, and the attachment is the tell — a buyer who
 * attaches their trial balance has self-qualified, and the firm can quote on
 * the first reply rather than after three rounds.
 *
 * Presentational and controlled from the outside: it owns the field state and
 * the client-side check, and hands a finished value to `onSubmit`. The storefront
 * binds that to a server action and the gallery binds it to nothing, so every
 * state renders without a network.
 *
 * ## Every trade, one form
 *
 * The render asks for a financial year end and a turnover band, which is an
 * audit firm's form. The fields here are the four every job has — which
 * service, what you need, how big, by when — and the trade speaks through the
 * placeholders, looked up by scope-sheet family with a general fallback. A new
 * family renders correctly on the day it is created and reads better on the
 * day somebody writes its copy. See `lib/enquiry/service-enquiry.ts`.
 *
 * Every string is `t()`, called here: a label function crossing from the
 * server is this repository's most repeated defect.
 */

export interface ServiceEnquiryOption {
  slug: string;
  name: string;
  /** The scope-sheet family, for placeholders that speak the trade. */
  familyId: string;
  /** The firm's own *what we need from you* row, when it filled one in. */
  requiresFromClient: string | null;
}

export interface ServiceEnquiryValue {
  service: string;
  requirement: string;
  scale: string;
  neededBy: string;
  contactName: string;
  contactPhone: string;
  file: File | null;
}

export interface ServiceEnquiryComposerProps {
  /** The firm's display name, never its trade name. */
  businessName: string;
  services: readonly ServiceEnquiryOption[];
  /** B11: the service the buyer arrived from, already resolved against `services`. */
  initialService: string | null;
  /** A buyer with no account gives a name and a mobile instead. */
  askForContact: boolean;
  /**
   * The form's accessible name. A named `<form>` is a landmark, and two forms
   * sharing a name are two identical entries in a screen reader's landmark
   * list — the gallery, which renders one per state, passes its own.
   */
  formLabel?: string;
  /** Measured, or the unmeasured line. Never a claim. */
  responseLine: string;
  busy?: boolean;
  /** A refusal the server named, above the button. */
  error?: string;
  /** Per-field refusals from the server, beside the fields they name. */
  fieldErrors?: Partial<Record<ServiceEnquiryField, string>>;
  onSubmit?: (value: ServiceEnquiryValue) => void;
}

export function ServiceEnquiryComposer({
  businessName,
  services,
  initialService,
  askForContact,
  formLabel,
  responseLine,
  busy = false,
  error,
  fieldErrors = {},
  onSubmit,
}: ServiceEnquiryComposerProps) {
  const id = useId();

  const [service, setService] = useState(initialService ?? "");
  const [requirement, setRequirement] = useState("");
  const [scale, setScale] = useState("");
  const [neededBy, setNeededBy] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [local, setLocal] = useState<Partial<Record<ServiceEnquiryField, string>>>({});

  /*
     "Enquire" on a service row elsewhere on the page selects that service here
     without a navigation, so nothing the buyer has typed is thrown away, and
     puts the cursor where the next thing to do is.
  */
  useEffect(() => {
    function select(event: Event) {
      const slug = (event as CustomEvent<string>).detail;
      if (services.some((option) => option.slug === slug)) setService(slug);
      document.getElementById(`${id}-requirement`)?.focus({ preventScroll: true });
    }
    window.addEventListener(SERVICE_ENQUIRY_SELECT, select);
    return () => window.removeEventListener(SERVICE_ENQUIRY_SELECT, select);
  }, [services, id]);

  const chosen = services.find((option) => option.slug === service) ?? null;
  const family = (chosen?.familyId ?? services[0]?.familyId ?? "general").replace(/-/g, "_");

  const errors = { ...fieldErrors, ...local };
  const describe = (field: ServiceEnquiryField, hint?: string) =>
    [hint, errors[field] ? `${id}-${field}-error` : null].filter(Boolean).join(" ") || undefined;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = checkServiceEnquiry(
      {
        service,
        requirement,
        scale,
        neededBy,
        attachment: file ? { type: file.type, bytes: file.size } : null,
        contactPhone: askForContact ? contactPhone : null,
      },
      services.map((option) => option.slug),
      uaeToday(new Date()),
    );

    if (!checked.ok) {
      const next: Partial<Record<ServiceEnquiryField, string>> = {};
      for (const refusal of checked.refusals) {
        next[refusal.field] ??= refusalWords(refusal);
      }
      setLocal(next);
      return;
    }

    setLocal({});
    onSubmit?.({ service, requirement, scale, neededBy, contactName, contactPhone, file });
  }

  const attachLabel = chosen?.requiresFromClient
    ? t("storefront_services.composer.attach_named", { what: chosen.requiresFromClient })
    : t("storefront_services.composer.attach");

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-label={formLabel ?? t("storefront_services.composer.form_label", { name: businessName })}
      aria-describedby={`${id}-intro`}
      className="flex flex-col gap-4"
    >
      <p id={`${id}-intro`} className="text-body-sm text-body">
        {t("storefront_services.composer.intro", { name: businessName })}
      </p>

      {services.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-service`}>{t("storefront_services.composer.service")}</Label>
          <Select
            id={`${id}-service`}
            name="service"
            value={service}
            invalid={Boolean(errors.service)}
            aria-describedby={describe("service")}
            onChange={(event) => setService(event.target.value)}
            options={[
              ...services.map((option) => ({ value: option.slug, label: option.name })),
              { value: "", label: t("storefront_services.composer.service_other") },
            ]}
          />
          <FieldError id={`${id}-service-error`} reserveSpace={false}>
            {errors.service}
          </FieldError>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-requirement`}>{t("storefront_services.composer.need")}</Label>
        <Textarea
          id={`${id}-requirement`}
          name="requirement"
          rows={4}
          value={requirement}
          invalid={Boolean(errors.requirement)}
          placeholder={familyCopy("need_placeholder", family)}
          aria-describedby={describe("requirement")}
          onChange={(event) => setRequirement(event.target.value)}
        />
        <FieldError id={`${id}-requirement-error`} reserveSpace={false}>
          {errors.requirement}
        </FieldError>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-scale`}>{familyCopy("scale_label", family)}</Label>
          <Input
            id={`${id}-scale`}
            name="scale"
            value={scale}
            maxLength={SCALE_MAX + 20}
            invalid={Boolean(errors.scale)}
            placeholder={familyCopy("scale_placeholder", family)}
            aria-describedby={describe("scale")}
            onChange={(event) => setScale(event.target.value)}
          />
          <FieldError id={`${id}-scale-error`} reserveSpace={false}>
            {errors.scale}
          </FieldError>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-needed`}>{t("storefront_services.composer.needed_by")}</Label>
          <Input
            id={`${id}-needed`}
            name="neededBy"
            type="date"
            value={neededBy}
            invalid={Boolean(errors.neededBy)}
            aria-describedby={describe("neededBy")}
            onChange={(event) => setNeededBy(event.target.value)}
          />
          <FieldError id={`${id}-neededBy-error`} reserveSpace={false}>
            {errors.neededBy}
          </FieldError>
        </div>
      </div>

      {/*
         Optional, and the label says what to send — Q1. It is the strongest
         qualifying signal on the form, and requiring it loses the buyer who
         does not have it to hand. The file travels only after the enquiry
         exists; see `lib/enquiry/service-enquiry-server.ts`.
      */}
      <div role="group" aria-labelledby={`${id}-attach-label`} className="flex flex-col gap-1.5">
        <span id={`${id}-attach-label`} className="text-caption font-medium text-body">
          {attachLabel}
        </span>
        <FileDrop
          state={file ? "done" : "idle"}
          idleLabel={t("storefront_services.composer.attach_add")}
          idleHint={t("storefront_services.composer.attach_hint", {
            mb: formatCount(Math.round(ENQUIRY_ATTACHMENT_BYTES / (1024 * 1024))),
          })}
          removeLabel={t("storefront_services.composer.attach_remove")}
          {...(file ? { filename: file.name } : {})}
          accept={ENQUIRY_ATTACHMENT_TYPES.join(",")}
          disabled={busy}
          onSelect={(files) => {
            const picked = files[0] ?? null;
            setFile(picked);
            setLocal((prev) => ({ ...prev, attachment: undefined }));
          }}
          onRemove={() => setFile(null)}
        />
        <FieldError id={`${id}-attachment-error`} reserveSpace={false}>
          {errors.attachment}
        </FieldError>
      </div>

      {askForContact && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-name`}>{t("rfq.contact_name")}</Label>
            <Input
              id={`${id}-name`}
              name="contactName"
              autoComplete="name"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${id}-phone`} hint={t("rfq.contact_hint")}>
              {t("rfq.contact")}
            </Label>
            <Input
              id={`${id}-phone`}
              name="contactPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={contactPhone}
              invalid={Boolean(errors.contact)}
              aria-describedby={describe("contact")}
              onChange={(event) => setContactPhone(event.target.value)}
            />
            <FieldError id={`${id}-contact-error`} reserveSpace={false}>
              {errors.contact}
            </FieldError>
          </div>
        </div>
      )}

      {/* Assertive: a failed send is the one message that should interrupt. */}
      {error && (
        <Alert tone="bad" live="assertive" fix={t("storefront_services.composer.error_fix")}>
          {error}
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <Button type="submit" block size="lg" loading={busy}>
          {busy ? t("rfq.sending") : t("storefront_services.composer.send")}
        </Button>
        <p className="text-caption text-muted">{responseLine}</p>
        {askForContact && <p className="text-caption text-faint">{t("storefront.composer_privacy")}</p>}
      </div>
    </form>
  );
}

/**
 * A family's copy where somebody wrote it, the general copy where nobody has.
 *
 * Looked up rather than switched on, so a family created on `4e-s` tomorrow
 * renders the general line today and nothing in this file changes when its own
 * line is written.
 */
function familyCopy(slot: "need_placeholder" | "scale_label" | "scale_placeholder", family: string): string {
  const own = `storefront_services.composer.${slot}.${family}`;
  return hasMessage(own)
    ? t(own as MessageKey)
    : t(`storefront_services.composer.${slot}.general` as MessageKey);
}
