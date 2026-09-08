"use client";

import { useId, useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Checkbox, Input, Label, Textarea } from "@/components/primitives";
import { DataTable, Panel, type Column } from "@/components/structure";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12e — entitlements as data.
 *
 * The screen is a table of caps and a form that changes them, and the only
 * interesting control on it is the tick box. Unticked, an edit changes what new
 * subscriptions get. Ticked, it rewrites every existing snapshot — which is the
 * destructive option, so it names the count it would move before it does it.
 *
 * That count is the reason the snapshot had to start carrying numbers. Until
 * this step `entitlementSnapshot` held `{ planId, capturedAt }`, nothing read
 * it, and "apply to existing" had nothing to switch off.
 */

export interface PlanRowView {
  id: string;
  name: string;
  monthlyPriceAed: number;
  enquiriesPerMonth: number | null;
  productLimit: number | null;
  locationLimit: number | null;
  photoLimit: number | null;
  storageMb: number | null;
  teamSeats: number;
  subscriptions: number;
  grandfathered: number;
}

const CAPS = [
  { field: "enquiriesPerMonth", labelKey: "admin.plans.col.enquiries" },
  { field: "productLimit", labelKey: "admin.plans.col.products" },
  { field: "locationLimit", labelKey: "admin.plans.col.locations" },
  { field: "photoLimit", labelKey: "admin.plans.col.photos" },
  { field: "storageMb", labelKey: "admin.plans.col.storage" },
  { field: "teamSeats", labelKey: "admin.plans.col.seats" },
] as const;

const MIN_REASON = 4;

function cap(value: number | null): string {
  return value === null ? t("admin.plans.unlimited") : formatCount(value);
}

export function PlanEditor({
  plans,
  save,
  canEdit,
}: {
  plans: readonly PlanRowView[];
  save: (formData: FormData) => Promise<ActionResult>;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [applyToExisting, setApply] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonId = useId();

  const open = plans.find((plan) => plan.id === editing) ?? null;

  function start(plan: PlanRowView) {
    setEditing(plan.id);
    setResult(null);
    setReason("");
    setApply(false);
    setValues({
      enquiriesPerMonth: plan.enquiriesPerMonth === null ? "" : String(plan.enquiriesPerMonth),
      productLimit: plan.productLimit === null ? "" : String(plan.productLimit),
      locationLimit: plan.locationLimit === null ? "" : String(plan.locationLimit),
      photoLimit: plan.photoLimit === null ? "" : String(plan.photoLimit),
      /*
         Seeded like the rest, and the omission would not have been cosmetic.

         `submit` posts every field in `CAPS`, and an empty box is `null` —
         unlimited. A storage row that opened blank while the plan held 50 would
         have lifted the cap the moment somebody saved a change to the enquiry
         allowance, without either of them appearing in the reason.
      */
      storageMb: plan.storageMb === null ? "" : String(plan.storageMb),
      teamSeats: String(plan.teamSeats),
    });
  }

  function submit() {
    if (!open) return;
    const form = new FormData();
    form.set("planId", open.id);
    form.set("reason", reason);
    if (applyToExisting) form.set("applyToExisting", "on");
    for (const { field } of CAPS) form.set(field, values[field] ?? "");

    startTransition(async () => {
      const outcome = await save(form);
      setResult(outcome);
      if (outcome.ok) setEditing(null);
    });
  }

  const columns: Column<PlanRowView>[] = [
    { key: "plan", header: t("admin.plans.col.plan"), render: (row) => row.name },
    {
      key: "price",
      header: t("admin.plans.col.price"),
      numeric: true,
      render: (row) => formatAED(row.monthlyPriceAed),
    },
    {
      key: "enquiries",
      header: t("admin.plans.col.enquiries"),
      numeric: true,
      render: (row) => cap(row.enquiriesPerMonth),
    },
    {
      key: "products",
      header: t("admin.plans.col.products"),
      numeric: true,
      render: (row) => cap(row.productLimit),
    },
    {
      key: "locations",
      header: t("admin.plans.col.locations"),
      numeric: true,
      hideBelow: "md",
      render: (row) => cap(row.locationLimit),
    },
    {
      key: "photos",
      header: t("admin.plans.col.photos"),
      numeric: true,
      hideBelow: "md",
      render: (row) => cap(row.photoLimit),
    },
    {
      key: "storage",
      header: t("admin.plans.col.storage"),
      numeric: true,
      hideBelow: "lg",
      render: (row) => cap(row.storageMb),
    },
    {
      key: "seats",
      header: t("admin.plans.col.seats"),
      numeric: true,
      hideBelow: "lg",
      render: (row) => formatCount(row.teamSeats),
    },
    {
      key: "accounts",
      header: t("admin.plans.col.accounts"),
      numeric: true,
      render: (row) => formatCount(row.subscriptions),
    },
    {
      key: "grandfathered",
      header: t("admin.plans.col.grandfathered"),
      numeric: true,
      render: (row) => (
        <span className={row.grandfathered > 0 ? "text-ink" : "text-faint"}>
          {formatCount(row.grandfathered)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <DataTable
        caption={t("admin.plans.caption")}
        columns={columns}
        rows={plans}
        rowKey={(row) => row.id}
        {...(canEdit
          ? {
              rowAction: (row: PlanRowView) => ({
                label: t("admin.plans.edit", { plan: row.name }),
                onSelect: () => start(row),
              }),
              actionsHeader: t("admin.plans.col.plan"),
            }
          : {})}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.plans.empty.title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("admin.plans.empty.body")}
            </p>
          </div>
        }
      />

      {open && (
        <Panel title={t("admin.plans.edit", { plan: open.name })}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPS.map(({ field, labelKey }) => (
              <div key={field} className="flex flex-col gap-1">
                <Label
                  htmlFor={`${reasonId}-${field}`}
                  hint={field === "teamSeats" ? undefined : t("admin.plans.unlimited_hint")}
                >
                  {t(labelKey)}
                </Label>
                <Input
                  id={`${reasonId}-${field}`}
                  inputMode="numeric"
                  value={values[field] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [field]: event.target.value }))
                  }
                />
              </div>
            ))}
          </div>

          <p className="mt-3 max-w-prose text-caption text-muted">
            {t("admin.plans.price_note")}
          </p>

          <div className="mt-4 border-t border-line pt-4">
            <Checkbox
              checked={applyToExisting}
              onChange={(event) => setApply(event.target.checked)}
              label={t("admin.plans.apply_label", { count: formatCount(open.subscriptions) })}
              description={t("admin.plans.apply_hint")}
            />
          </div>

          <div className="mt-4 flex flex-col gap-1">
            <Label
              htmlFor={reasonId}
              requirement="required"
              requirementLabel={t("field.required")}
              hint={t("admin.plans.reason_hint")}
            >
              {t("admin.plans.reason_label")}
            </Label>
            <Textarea
              id={reasonId}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={reason.trim().length < MIN_REASON || pending} onClick={submit}>
              {t("admin.plans.save")}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setEditing(null)}>
              {t("action.cancel")}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
