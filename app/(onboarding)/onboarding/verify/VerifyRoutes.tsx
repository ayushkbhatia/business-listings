"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, FileDrop, Input, Label, Radio, Select } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import { MAX_LICENCE_BYTES } from "@/lib/storage/buckets";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { LicenceScan } from "@/lib/onboarding/verify";
import type { ClaimActionResult, RecordResult, ScanResult, SignResult } from "../actions";
import { draftFormData, useVerifyForm } from "./VerifyFormState";

/**
 * Board 2b — the gate.
 *
 * Two routes, and they are **mutually exclusive radio options rather than a form
 * with two sections**. Selecting one collapses the other to its single label
 * line. A supplier who tries to do both has misunderstood what is being asked,
 * and the interface should not make the confusion available.
 *
 * The phone route is the more interesting of the two: we call **the number on
 * the public licence record**, never one the claimant types. Letting them supply
 * it would make the check a formality — anybody can answer their own phone.
 * Because it is the recorded number, answering it is the proof. The number is
 * shown masked so the real owner recognises their own line and an impostor does
 * not learn the line they would need to intercept.
 *
 * Nothing here grants anything. The button says "Submit for verification" and
 * never "Verify my business", because the second would be a claim the product
 * cannot let a claimant make about themselves.
 */

export interface VerifyRoutesProps {
  licenceAuthority: string;
  /** Masked. Absent when the register holds no number — the route is then gone. */
  maskedPhone: string | null;
  hasPhoneRoute: boolean;
  contested: boolean;
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  scanAction: (formData: FormData) => Promise<ScanResult>;
  claimAction: (formData: FormData) => Promise<ClaimActionResult>;
}

const ROLE_LABELS: Record<string, MessageKey> = {
  owner: "verify.role.owner",
  partner: "verify.role.partner",
  manager: "verify.role.manager",
  pro: "verify.role.pro",
  authorised_signatory: "verify.role.authorised_signatory",
};

const DOCUMENT_LABELS: Record<string, MessageKey> = {
  health_authority: "verify.document.health_authority",
  municipality_permit: "verify.document.municipality_permit",
  vat_certificate: "verify.document.vat_certificate",
  establishment_card: "verify.document.establishment_card",
  chamber_certificate: "verify.document.chamber_certificate",
  passport_or_id: "verify.document.passport_or_id",
};

export function VerifyRoutes(props: VerifyRoutesProps) {
  const router = useRouter();
  const groupId = useId();

  // The fields live above this component, because the chrome's "Save & exit"
  // saves them and sits outside the form. See ./VerifyFormState.tsx.
  const { fields, setFields, saved, businessId } = useVerifyForm();
  const { route, documentId, filename, licenceNumber, licenceExpiry, claimantName, claimantRole } =
    fields;

  const [filesize, setFilesize] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<LicenceScan | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function upload(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setScan(null);
    setUploading(true);

    const signForm = new FormData();
    signForm.set("businessId", businessId);
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));

    const signed = await props.signAction(signForm);
    if (!signed.ok) {
      setError(signed.error);
      setUploading(false);
      return;
    }

    const response = await fetch(signed.url, {
      method: "PUT",
      headers: { "content-type": file.type },
      body: file,
    });
    if (!response.ok) {
      setError(t("media.storage_off"));
      setUploading(false);
      return;
    }

    const recordForm = new FormData();
    recordForm.set("businessId", businessId);
    recordForm.set("path", signed.path);
    recordForm.set("filename", file.name);
    recordForm.set("bytes", String(file.size));
    recordForm.set("type", file.type);
    const recorded = await props.recordAction(recordForm);

    setUploading(false);
    if (!recorded.ok) {
      setError(recorded.error);
      return;
    }
    setFields({ documentId: recorded.documentId, filename: file.name });
    setFilesize(formatBytes(file.size));

    /*
       Read it, and fill the two fields it can. Both stay editable: OCR on a
       licence photographed on a wall is unreliable, and a locked wrong value is
       worse than an empty one. What was read is submitted alongside what was
       typed, so a reviewer can see a correction.
    */
    setScanning(true);
    const scanForm = new FormData();
    scanForm.set("documentId", recorded.documentId);
    const result = await props.scanAction(scanForm);
    setScanning(false);
    if (!result.ok) return;

    setScan(result.scan);
    if (!result.scan.lowConfidence) {
      setFields({
        ...(result.scan.licenceNumber ? { licenceNumber: result.scan.licenceNumber } : {}),
        ...(result.scan.licenceExpiry ? { licenceExpiry: result.scan.licenceExpiry } : {}),
      });
    }
  }

  function submit() {
    setError(null);
    const form = draftFormData(businessId, fields);
    if (route === "licence_upload") {
      if (scan?.licenceNumber) form.set("ocrLicenceNumber", scan.licenceNumber);
      if (scan?.licenceExpiry) form.set("ocrLicenceExpiry", scan.licenceExpiry);
      if (scan) form.set("ocrConfidence", String(scan.confidence));
    }
    // The phone route submits the recorded number, and the server reads it from
    // the record rather than from here. This field only says which route.
    if (route === "phone_callback") form.set("phone", "on-record");

    startTransition(async () => {
      const result = await props.claimAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // The page re-reads on the server and becomes the status card. A refresh
      // rather than a push: the URL is already right, and pushing would put an
      // identical entry in the history for the back button to land on.
      router.refresh();
    });
  }

  const ready =
    route === "phone_callback" ? props.hasPhoneRoute : Boolean(documentId) && licenceNumber.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={t("verify.field.number_hint", { authority: props.licenceAuthority })}>
          {error}
        </Alert>
      )}
      {saved && <Alert tone="ok" live="polite">{saved}</Alert>}

      {props.contested && (
        <Alert tone="warn" title={t("verify.contested_heading")} fix={t("verify.contested_fix")}>
          {t("verify.contested_body")}
        </Alert>
      )}

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">{t("verify.legend")}</legend>

        <div className="flex flex-col gap-3">
          {/* Route A — the licence. Selected by default. */}
          <RouteCard selected={route === "licence_upload"}>
            <div className="flex items-center gap-3">
              <Radio
                name={groupId}
                value="licence_upload"
                checked={route === "licence_upload"}
                onChange={() => setFields({ route: "licence_upload" })}
                label={<span className="text-body font-medium text-ink">{t("verify.route.licence")}</span>}
              />
              {/*
                Only where there is a second route to be faster than. With no
                number on the public record this tag would be comparing itself
                to nothing.
              */}
              {props.hasPhoneRoute && (
                <span className="ms-auto font-mono text-eyebrow uppercase text-ok-ink">
                  {t("verify.route.fastest")}
                </span>
              )}
            </div>

            {route === "licence_upload" && (
              <div className="mt-4 flex flex-col gap-4">
                <FileDrop
                  idleLabel={t("verify.file.idle")}
                  idleHint={t("verify.route.licence_hint", { limit: formatBytes(MAX_LICENCE_BYTES) })}
                  /*
                    `capture` is not set, deliberately. On a phone this `accept`
                    puts the camera at the top of the sheet and still offers
                    Files below it; `capture` would open the camera directly and
                    strand the supplier who has the PDF in their email. Board
                    2b asks for the camera first, not for the camera only.
                  */
                  accept="image/*,application/pdf"
                  state={uploading ? "uploading" : documentId ? "done" : "idle"}
                  {...(filename ? { filename } : {})}
                  {...(filesize ? { filesize } : {})}
                  uploadingLabel={t("verify.file.uploading")}
                  removeLabel={t("verify.file.replace")}
                  onSelect={upload}
                  onRemove={() => {
                    setFields({ documentId: null, filename: null });
                    setFilesize(null);
                    setScan(null);
                  }}
                />

                {scanning && (
                  <p aria-live="polite" className="text-caption text-muted">
                    {t("verify.file.reading")}
                  </p>
                )}

                {scan?.wrongDocument && (
                  <Alert
                    tone="warn"
                    live="polite"
                    fix={t("verify.wrong_document_fix")}
                  >
                    {t("verify.wrong_document", {
                      document: t(DOCUMENT_LABELS[scan.wrongDocument] ?? "verify.document.vat_certificate"),
                    })}
                  </Alert>
                )}

                {documentId && !scanning && (
                  <p className="text-caption text-muted">
                    {scan && !scan.lowConfidence ? t("verify.ocr_filled") : t("verify.ocr_failed")}
                  </p>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={t("verify.field.number")} hint={t("verify.field.number_hint", { authority: props.licenceAuthority })}>
                    {(id) => (
                      <Input
                        id={id}
                        name="licenceNumber"
                        mono
                        inputMode="text"
                        autoComplete="off"
                        value={licenceNumber}
                        onChange={(event) => setFields({ licenceNumber: event.target.value })}
                      />
                    )}
                  </Field>

                  <Field label={t("verify.field.expiry")}>
                    {(id) => (
                      <Input
                        id={id}
                        name="licenceExpiry"
                        type="date"
                        value={licenceExpiry}
                        onChange={(event) => setFields({ licenceExpiry: event.target.value })}
                      />
                    )}
                  </Field>

                  <Field label={t("verify.field.name")}>
                    {(id) => (
                      <Input
                        id={id}
                        name="claimantName"
                        autoComplete="name"
                        value={claimantName}
                        onChange={(event) => setFields({ claimantName: event.target.value })}
                      />
                    )}
                  </Field>

                  {/*
                    The role matters more than it looks: a claim from a manager
                    with no power of attorney attached is a different review path
                    from a claim from the named owner.
                  */}
                  <Field label={t("verify.field.role")}>
                    {(id) => (
                      <Select
                        id={id}
                        name="claimantRole"
                        placeholder={t("verify.role.choose")}
                        value={claimantRole}
                        onChange={(event) => setFields({ claimantRole: event.target.value })}
                        options={Object.entries(ROLE_LABELS).map(([value, key]) => ({
                          value,
                          label: t(key),
                        }))}
                      />
                    )}
                  </Field>
                </div>
              </div>
            )}
          </RouteCard>

          {/*
            Absent, not disabled. Offering a route that cannot work is worse than
            not offering it — a disabled control is a thing somebody spends time
            trying to enable.
          */}
          {props.hasPhoneRoute && (
            <RouteCard selected={route === "phone_callback"}>
              <Radio
                name={groupId}
                value="phone_callback"
                checked={route === "phone_callback"}
                onChange={() => setFields({ route: "phone_callback" })}
                label={<span className="text-body font-medium text-ink">{t("verify.route.phone")}</span>}
                {...(route === "phone_callback"
                  ? { description: t("verify.route.phone_hint", { phone: props.maskedPhone ?? "" }) }
                  : {})}
              />
            </RouteCard>
          )}
        </div>
      </fieldset>

      {/*
        Sticky on a phone, where the form is long enough that the action would
        otherwise be a scroll away from the field somebody just finished.
      */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          "sticky bottom-0 -mx-[var(--section-pad)] border-t border-line bg-paper px-[var(--section-pad)] py-3",
          "md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:py-0",
        )}
      >
        <Button size="lg" loading={pending} disabled={!ready} onClick={submit}>
          {pending ? t("verify.submitting") : t("verify.submit")}
        </Button>
        <Link
          href="/onboarding/claim"
          className="rounded-tag px-2 py-1 text-body-sm text-body hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("verify.back")}
        </Link>
      </div>
    </div>
  );
}

/**
 * The selected route is a 1.5px moss border and a tinted fill — §"Interaction
 * rules that are easy to get wrong": selection is a border and a fill, never a
 * shadow.
 */
function RouteCard({ selected, children }: { selected: boolean; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-card-lg bg-card p-5 transition-colors duration-120 ease-out",
        selected ? "border-[1.5px] border-moss bg-moss-wash" : "border border-line",
      )}
    >
      {children}
    </div>
  );
}

/** A label bound to its control, without every field repeating the plumbing. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} {...(hint ? { hint } : {})}>
        {label}
      </Label>
      {children(id)}
    </div>
  );
}
