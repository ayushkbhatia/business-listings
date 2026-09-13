"use client";

import { useState } from "react";
import { Button } from "@/components/primitives";
import { Modal } from "@/components/structure";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";
import { StageForm } from "./StageForm";

/**
 * "New import", top right, as the board draws it.
 *
 * The staging form used to sit at the top of the runs page, above the run
 * waiting for a decision — which put an upload control between a person and
 * the 6,000 listings they had come to approve. It opens on demand now.
 */
export function NewImport({
  authorities,
  stage,
}: {
  authorities: readonly { value: string; label: string }[];
  stage: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("admin.ingest.new")}</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t("admin.ingest.stage_title")}
        closeLabel={t("action.cancel")}
        size="lg"
      >
        {open && <StageForm authorities={authorities} stage={stage} onCancel={() => setOpen(false)} />}
      </Modal>
    </>
  );
}
