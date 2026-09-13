"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button } from "@/components/primitives";
import type { CategoryOption } from "@/lib/ingest/queue";
import { t } from "@/lib/i18n";
import type { ActionResult } from "../../actions";
import { CategorisePanel } from "../../categorise/CategorisePanel";

/** The record page's one control: file this record, or re-file it. */
export function RecordCategorise({
  recordId,
  label,
  hasCategory,
  categoryId,
  options,
  categorise,
}: {
  recordId: string;
  label: string;
  hasCategory: boolean;
  categoryId: string | null;
  options: readonly CategoryOption[];
  categorise: (formData: FormData) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button variant={hasCategory ? "secondary" : "primary"} onClick={() => setOpen(true)}>
          {hasCategory ? t("admin.record.recategorise") : t("admin.record.categorise")}
        </Button>
      </div>
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live={result.ok ? "polite" : "assertive"}>
          {result.ok ? result.message : result.error}
        </Alert>
      )}
      <CategorisePanel
        key={open ? "open" : "closed"}
        open={open}
        onClose={() => setOpen(false)}
        target={{ kind: "records", ids: [recordId], labels: [label], records: 1 }}
        options={options}
        initialCategoryId={categoryId}
        categorise={categorise}
        onDone={(outcome) => {
          setOpen(false);
          setResult(outcome);
          router.refresh();
        }}
      />
    </div>
  );
}
