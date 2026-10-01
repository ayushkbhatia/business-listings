"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert } from "@/components/display";
import { FileDrop } from "@/components/primitives";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { MAX_LICENCE_BYTES } from "@/lib/storage/buckets";
import type { RecordResult, SignResult } from "../actions";

/**
 * Board 4c Q4 — the one document an ops lead may ask every side of a conflict
 * for: the registered tenancy contract for the claimant's unit. Same three
 * steps as the licence upload on this screen — sign, put, record — and the
 * record attaches it to this claimant's own claim and nobody else's.
 */
export function TenancyUpload({
  businessId,
  sign,
  record,
}: {
  businessId: string;
  sign: (form: FormData) => Promise<SignResult>;
  record: (form: FormData) => Promise<RecordResult>;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<{ name: string; size: string } | null>(null);

  async function upload(files: FileList) {
    const chosen = files[0];
    if (!chosen) return;
    setError(null);
    setState("uploading");

    const signForm = new FormData();
    signForm.set("businessId", businessId);
    signForm.set("filename", chosen.name);
    signForm.set("type", chosen.type);
    signForm.set("bytes", String(chosen.size));
    const signed = await sign(signForm);
    if (!signed.ok) {
      setError(signed.error);
      setState("error");
      return;
    }
    const response = await fetch(signed.url, { method: "PUT", headers: { "content-type": chosen.type }, body: chosen });
    if (!response.ok) {
      setError(t("media.storage_off"));
      setState("error");
      return;
    }
    const recordForm = new FormData();
    recordForm.set("businessId", businessId);
    recordForm.set("path", signed.path);
    recordForm.set("filename", chosen.name);
    recordForm.set("bytes", String(chosen.size));
    recordForm.set("type", chosen.type);
    const recorded = await record(recordForm);
    if (!recorded.ok) {
      setError(recorded.error);
      setState("error");
      return;
    }
    setFile({ name: chosen.name, size: formatBytes(chosen.size) });
    setState("done");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <FileDrop
        idleLabel={t("verify.tenancy.drop")}
        idleHint={t("verify.route.licence_hint", { limit: formatBytes(MAX_LICENCE_BYTES) })}
        accept="image/*,application/pdf"
        state={state === "uploading" ? "uploading" : state === "done" ? "done" : "idle"}
        {...(file ? { filename: file.name, filesize: file.size } : {})}
        uploadingLabel={t("verify.tenancy.uploading")}
        removeLabel={t("verify.file.replace")}
        onSelect={upload}
        onRemove={() => {
          setFile(null);
          setState("idle");
        }}
      />
      {error && (
        <Alert tone="bad" live="assertive" fix={t("verify.tenancy.fix")}>
          {error}
        </Alert>
      )}
    </div>
  );
}
