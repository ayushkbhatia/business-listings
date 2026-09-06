"use client";

import { Alert } from "@/components/display";
import { useState, useTransition } from "react";
import { Button, FileDrop, Input, Select } from "@/components/primitives";
import { t } from "@/lib/i18n";
import type { DeleteResult, RecordResult, SignResult } from "./actions";

/**
 * Board 3e — the documents half.
 *
 * The list shows filenames, never links. These objects live in a bucket with no
 * public read at all, and a link the seller could copy is a link they could
 * paste — a trade licence handed over to be verified is not one consented to be
 * published. Staff read them through a short-lived signed URL from the admin
 * side, which handoff 4 builds.
 */

export interface DocumentRow {
  id: string;
  kind: string;
  filename: string;
  /** Already formatted. The clock belongs on the server side of the boundary. */
  uploadedAt: string;
  /**
   * False for a checked trade licence or VAT certificate.
   *
   * The button is not drawn, and `deleteDocument` refuses it as well. A control
   * that is merely absent is a control somebody can still reach with a form
   * post; the fence is in the action and this is the courtesy.
   */
  deletable: boolean;
}

export interface DocumentUploadProps {
  documents: readonly DocumentRow[];
  signAction: (formData: FormData) => Promise<SignResult>;
  recordAction: (formData: FormData) => Promise<RecordResult>;
  deleteAction: (formData: FormData) => Promise<DeleteResult>;
}

const KINDS = ["trade_licence", "vat_certificate", "certificate"] as const;

/**
 * Which kinds go into `Uploaded by you`, and therefore carry the three fields
 * that table has columns for.
 *
 * A trade licence and a VAT certificate read their number and expiry off the
 * licence record — licence-locked, not the seller's to type — so asking for
 * them here would be asking a seller to restate something we already hold and
 * check.
 */
const CREDENTIAL_KINDS: readonly string[] = ["certificate", "catalogue", "datasheet"];

export function DocumentUpload({
  documents,
  signAction,
  recordAction,
  deleteAction,
}: DocumentUploadProps) {
  const [kind, setKind] = useState<string>("trade_licence");
  const [displayName, setDisplayName] = useState("");
  const [reference, setReference] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();

  const credential = CREDENTIAL_KINDS.includes(kind);

  async function upload(files: FileList) {
    const file = files[0];
    if (!file) return;
    setError(null);

    // Asked for before the file goes up rather than after. The name is what the
    // storefront would show and what the public-row constraint requires, so a
    // seller who has not given one has nothing publishable to upload yet.
    if (credential && !displayName.trim()) {
      setError(t("verify_listing.name_required"));
      return;
    }
    setUploading(true);

    const signForm = new FormData();
    signForm.set("filename", file.name);
    signForm.set("type", file.type);
    signForm.set("bytes", String(file.size));
    signForm.set("kind", kind);

    const signed = await signAction(signForm);
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
    recordForm.set("path", signed.path);
    recordForm.set("kind", kind);
    recordForm.set("filename", file.name);
    recordForm.set("bytes", String(file.size));
    recordForm.set("type", file.type);
    recordForm.set("displayName", displayName);
    recordForm.set("reference", reference);
    recordForm.set("validUntil", validUntil);
    const recorded = await recordAction(recordForm);
    if (!recorded.ok) {
      setError(recorded.error);
      setUploading(false);
      return;
    }

    setUploading(false);
    window.location.reload();
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <label className="flex max-w-xs flex-col gap-1">
        <span className="text-body-sm text-ink">{t("verify_listing.kind")}</span>
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          options={KINDS.map((k) => ({ value: k, label: t(`verify_listing.kind.${k}` as never) }))}
        />
      </label>

      {credential && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("verify_listing.field_name")}</span>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder={t("verify_listing.field_name_hint")}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("verify_listing.field_reference")}</span>
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={40}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-body-sm text-ink">{t("verify_listing.field_valid_until")}</span>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </label>
        </div>
      )}

      <FileDrop
        idleLabel={t("verify_listing.upload")}
        idleHint={t("verify_listing.upload_hint")}
        accept="application/pdf,image/jpeg,image/png"
        state={uploading ? "uploading" : "idle"}
        uploadingLabel={t("verify_listing.upload")}
        onSelect={upload}
      />

      {documents.length === 0 ? (
        <p className="text-body-sm text-muted">{t("verify_listing.no_documents")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-card border border-line bg-card">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <span className="block text-body-sm text-ink">{document.filename}</span>
                <span className="mt-0.5 block text-caption text-muted">
                  {t(`verify_listing.kind.${document.kind}` as never)}
                  {" · "}
                  {t("verify_listing.uploaded", { when: document.uploadedAt })}
                </span>
              </div>
              {document.deletable ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("verify_listing.confirm_delete"))) return;
                    const form = new FormData();
                    form.set("id", document.id);
                    startTransition(async () => {
                      await deleteAction(form);
                      window.location.reload();
                    });
                  }}
                >
                  {t("verify_listing.delete_document")}
                </Button>
              ) : (
                <span className="max-w-xs text-caption text-muted">
                  {t("verify_listing.cannot_delete")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
