"use client";

import { useState, useTransition } from "react";
import { Button, Checkbox } from "@/components/primitives";
import { Alert } from "@/components/display/Alert";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { sendToMoreSuppliers } from "./add-actions";

/**
 * The suppliers `/rfq/new?from=` would add, ticked, and the one send.
 *
 * Every row starts ticked — they are the ones the buyer's own link offered —
 * and unticking one is a decision about that supplier, which the send honours
 * rather than refilling the slot with the next in rank. Every string is `t()`
 * called here; the rows arrive as data with their meta line already worded.
 */
export function AddSuppliersForm({
  refOrId,
  token,
  suppliers,
  backHref,
}: {
  refOrId: string;
  token: string | null;
  suppliers: readonly { businessId: string; displayName: string; meta: string }[];
  backHref: string;
}) {
  const [picked, setPicked] = useState<string[]>(() => suppliers.map((s) => s.businessId));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      aria-label={t("add.list")}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await sendToMoreSuppliers({ refOrId, token, chosenBusinessIds: picked });
          // A redirect on success; only a refusal comes back.
          if (result && !result.ok) setError(result.error);
        });
      }}
    >
      <ul aria-label={t("add.list")} className="divide-y divide-line rounded-card border border-line">
        {suppliers.map((supplier) => (
          <li key={supplier.businessId} className="px-4 py-3">
            <Checkbox
              checked={picked.includes(supplier.businessId)}
              aria-label={t("add.pick", { name: supplier.displayName })}
              label={<span className="font-medium text-ink">{supplier.displayName}</span>}
              onChange={(event) =>
                setPicked((current) =>
                  event.target.checked
                    ? [...current, supplier.businessId]
                    : current.filter((id) => id !== supplier.businessId),
                )
              }
            />
            <p className="ml-7 font-mono text-eyebrow uppercase tracking-eyebrow text-faint">{supplier.meta}</p>
          </li>
        ))}
      </ul>

      {error && (
        <Alert tone="bad" live="assertive" fix={t("add.error_fix")}>
          {error}
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" loading={pending} disabled={picked.length === 0}>
          {t("add.send", { count: Math.max(1, picked.length), formatted: formatCount(Math.max(1, picked.length)) })}
        </Button>
        <a
          href={backHref}
          className="rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("add.back")}
        </a>
      </div>
      {picked.length === 0 && <p className="text-caption text-warn-ink">{t("add.none_chosen")}</p>}
    </form>
  );
}
