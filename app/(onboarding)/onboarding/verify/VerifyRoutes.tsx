"use client";

import Link from "next/link";
import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, FileDrop, Radio } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { ClaimActionResult, RecordResult, SignResult } from "../actions";

/**
 * Board 2b — prove it is yours.
 *
 * Two routes and the phone one is the more interesting: we call **the number on
 * the public licence record**, not one the claimant types. Letting them supply
 * the number would make the check a formality — anybody can answer their own
 * phone. Because it is the recorded number, answering it is the proof.
 *
 * A contested claim is taken rather than refused. If a former employee or an
 * agency claimed the listing, this is the route by which it gets put right, and
 * closing the door in front of the second person is the wrong side to be wrong
 * on.
 */

export interface VerifyRoutesProps {
  businessId: string;
  tradeName: string;
  /** From the licence record. Null when we hold none. */
  recordedPhone: string | null;
  contested: boolean;
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  claimAction: (formData: FormData) => Promise<ClaimActionResult>;
}

export function VerifyRoutes(props: VerifyRoutesProps) {
  const [route, setRoute] = useState<"licence_upload" | "phone_callback">(
    props.recordedPhone ? "phone_callback" : "licence_upload",
  );
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    const signForm = new FormData();
    signForm.set("businessId", props.businessId);
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
    recordForm.set("businessId", props.businessId);
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
    setDocumentId(recorded.documentId);
    setFilename(file.name);
  }

  function submit() {
    const form = new FormData();
    form.set("businessId", props.businessId);
    form.set("route", route);
    if (route === "licence_upload" && documentId) form.set("documentId", documentId);
    if (route === "phone_callback" && props.recordedPhone) form.set("phone", props.recordedPhone);
    setError(null);

    startTransition(async () => {
      const result = await props.claimAction(form);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  const ready = route === "phone_callback" ? Boolean(props.recordedPhone) : Boolean(documentId);

  if (done) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body-sm text-ink">{t("verify.submitted")}</p>
        <div>
          <Link
            href="/onboarding/profile"
            className="inline-flex items-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("verify.continue")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      {props.contested && (
        <Alert tone="warn" title={t("verify.contested_heading")} fix={t("verify.contested_fix")}>
          {t("verify.contested_body")}
        </Alert>
      )}

      <fieldset className="min-w-0 border-0 p-0">
        <legend className="sr-only">{t("verify.title")}</legend>
        <div className="flex flex-col gap-3">
          <Radio
            name="route"
            value="phone_callback"
            checked={route === "phone_callback"}
            disabled={!props.recordedPhone}
            onChange={() => setRoute("phone_callback")}
            label={t("verify.route.phone")}
            description={
              props.recordedPhone
                ? t("verify.route.phone_hint", { phone: props.recordedPhone })
                : t("verify.no_phone")
            }
          />
          <Radio
            name="route"
            value="licence_upload"
            checked={route === "licence_upload"}
            onChange={() => setRoute("licence_upload")}
            label={t("verify.route.licence")}
            description={t("verify.route.licence_hint")}
          />
        </div>
      </fieldset>

      {route === "licence_upload" && (
        <FileDrop
          idleLabel={t("verify.route.licence")}
          idleHint={t("verify.route.licence_hint")}
          accept="application/pdf,image/jpeg,image/png"
          state={uploading ? "uploading" : documentId ? "done" : "idle"}
          {...(filename ? { filename } : {})}
          uploadingLabel={t("verify.route.licence")}
          onSelect={upload}
        />
      )}

      <div>
        <Button disabled={pending || !ready} onClick={submit}>
          {t("verify.submit")}
        </Button>
      </div>
    </div>
  );
}
