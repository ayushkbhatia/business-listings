"use client";

import { useState } from "react";
import { FileDrop, type FileDropState } from "@/components/primitives";
import { formatBytes } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

export function Upload() {
  const [live, setLive] = useState<FileDropState>("idle");

  return (
    <Section
      id="file-drop"
      title="FileDrop"
      note="idle is the only dashed state — a dashed border means empty, and nothing else"
    >
      <States label="states" stack>
        <div className="w-full max-w-lg">
          <FileDrop
            state="idle"
            idleLabel={t("upload.idle")}
            idleHint={t("upload.hint")}
            accept="application/pdf,image/*"
          />
        </div>
        <div className="w-full max-w-lg">
          <FileDrop
            state="uploading"
            progress={62}
            filename="trade-licence-2026.pdf"
            uploadingLabel={t("upload.uploading")}
            idleLabel={t("upload.idle")}
          />
        </div>
        <div className="w-full max-w-lg">
          <FileDrop
            state="done"
            filename="trade-licence-2026.pdf"
            filesize={formatBytes(2_400_000)}
            removeLabel={t("upload.remove")}
            idleLabel={t("upload.idle")}
          />
        </div>
        <div className="w-full max-w-lg">
          <FileDrop
            state="error"
            filename="site-photos.zip"
            errorMessage={t("upload.too_large")}
            retryLabel={t("upload.retry")}
            idleLabel={t("upload.idle")}
          />
        </div>
        <div className="w-full max-w-lg">
          <FileDrop
            state="idle"
            disabled
            idleLabel={t("upload.idle")}
            idleHint={t("upload.hint")}
          />
        </div>
      </States>

      <States label="live" stack>
        <div className="w-full max-w-lg">
          <FileDrop
            state={live}
            progress={40}
            filename="datasheet.pdf"
            filesize={formatBytes(184_000)}
            errorMessage={t("upload.too_large")}
            idleLabel={t("upload.idle")}
            idleHint={t("upload.hint")}
            uploadingLabel={t("upload.uploading")}
            removeLabel={t("upload.remove")}
            retryLabel={t("upload.retry")}
            onSelect={() => {
              setLive("uploading");
              window.setTimeout(() => setLive("done"), 900);
            }}
            onRemove={() => setLive("idle")}
            onRetry={() => setLive("idle")}
          />
        </div>
      </States>
    </Section>
  );
}
