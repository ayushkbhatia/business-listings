"use client";

import { useState, useTransition } from "react";
import { Button, Input } from "@/components/primitives";
import { DataTable, type Column } from "@/components/structure";
import { Alert, StatusBadge } from "@/components/display";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 12i — catalogues sent in and not yet keyed in.
 *
 * The same shape as `/admin/reports` and `/admin/visits`, deliberately: a
 * `DataTable` of open work oldest first, one visible row action, and a reason
 * bar that has to be filled in before any of the three moves is allowed.
 * Somebody working two of these queues in an afternoon should not have to learn
 * a second grammar.
 *
 * **Every move captures a written reason before it is possible.** The buttons
 * are disabled until the field holds one, `assertReason` refuses a row of
 * punctuation at the fence, and `staffMutation` writes the row that records
 * what was decided and why. The disabled state here is a courtesy; the service
 * is the rule.
 *
 * The due column is what makes this queue readable at a glance. A row past its
 * date is tinted `attention` — the seller was told two working days, and this
 * is the only screen where anybody finds out we are about to miss it.
 */

export interface ImportRow {
  id: string;
  businessName: string;
  planName: string;
  /** Already through `formatAED`. */
  fee: string;
  note: string | null;
  filename: string | null;
  status: "requested" | "in_progress";
  /** Already formatted in Asia/Dubai, or an em dash. */
  due: string;
  ageDays: number;
  late: boolean;
}

/** `assertReason` refuses anything shorter. Matched here so the button says so first. */
const MIN_REASON = 4;

export function ImportQueue({
  rows,
  start,
  complete,
  reject,
}: {
  rows: readonly ImportRow[];
  start: (formData: FormData) => Promise<ActionResult>;
  complete: (formData: FormData) => Promise<ActionResult>;
  reject: (formData: FormData) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState<ImportRow | null>(null);
  const [reason, setReason] = useState("");
  const [products, setProducts] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send(row: ImportRow, move: (formData: FormData) => Promise<ActionResult>) {
    const form = new FormData();
    form.set("id", row.id);
    form.set("reason", reason);
    form.set("productsLoaded", products);
    startTransition(async () => {
      const moved = await move(form);
      setResult(moved);
      if (moved.ok) {
        setOpen(null);
        setReason("");
        setProducts("");
      }
    });
  }

  const columns: Column<ImportRow>[] = [
    {
      key: "business",
      header: t("admin.queue.col.business"),
      render: (row) => (
        <span className="flex flex-col">
          {/*
            displayName, always. A trade name here would send whoever picks the
            row up to a storefront titled something else.
          */}
          <span className="text-ink">{row.businessName}</span>
          {row.filename && (
            <span className="font-mono text-eyebrow uppercase text-faint">{row.filename}</span>
          )}
        </span>
      ),
    },
    {
      key: "plan",
      header: t("admin.subscriptions.col.plan"),
      width: "7rem",
      render: (row) => <span className="text-muted">{row.planName}</span>,
    },
    {
      key: "fee",
      header: t("billing.col.amount"),
      numeric: true,
      width: "8rem",
      render: (row) => row.fee,
    },
    {
      key: "note",
      header: t("admin.reports.col.detail"),
      hideBelow: "lg",
      render: (row) => <span className="text-muted">{row.note ?? "—"}</span>,
    },
    {
      key: "status",
      header: t("admin.ingest.col.status"),
      width: "9rem",
      render: (row) => (
        <StatusBadge tone={row.status === "in_progress" ? "info" : "neutral"} size="sm" shape="chip">
          {row.status === "in_progress"
            ? t("subscription.status.active")
            : t("admin.dunning.stage.none")}
        </StatusBadge>
      ),
    },
    {
      key: "due",
      header: t("ranking.col.expires"),
      mono: true,
      width: "8rem",
      render: (row) => row.due,
    },
    {
      key: "age",
      header: t("admin.queue.col.age"),
      numeric: true,
      width: "6rem",
      render: (row) => t("admin.queue.age_days", { days: String(row.ageDays) }),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={t("admin.queue.caption")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        stickyHeader
        rowTone={(row) => (row.late ? "attention" : "default")}
        rowAction={(row) => ({
          label: t("admin.review.decision_heading"),
          onSelect: () => {
            setOpen(row);
            setResult(null);
          },
        })}
        actionsHeader={t("admin.review.decision_heading")}
        empty={
          <div className="text-center">
            <p className="text-body-sm text-body">{t("admin.queue.empty.title")}</p>
          </div>
        }
      />

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-card p-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1">
            <span className="text-body-sm text-ink">{t("admin.review.reason_label")}</span>
            <Input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>

          {/*
            The count the seller reads back. Only on the completing move, and
            typed rather than derived: nothing on this platform can see how many
            rows a person keyed in, so the honest field is the one somebody
            fills in from the catalogue in front of them.
          */}
          <label className="flex w-40 flex-col gap-1">
            <span className="text-body-sm text-ink">{t("admin.plans.col.products")}</span>
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={products}
              onChange={(event) => setProducts(event.target.value)}
            />
          </label>

          <Button
            variant="secondary"
            disabled={
              open.status !== "requested" || reason.trim().length < MIN_REASON || pending
            }
            onClick={() => send(open, start)}
          >
            {t("setup.start")}
          </Button>
          <Button
            disabled={reason.trim().length < MIN_REASON || products.trim() === "" || pending}
            onClick={() => send(open, complete)}
          >
            {t("setup.done")}
          </Button>
          <Button
            variant="secondary"
            disabled={reason.trim().length < MIN_REASON || pending}
            onClick={() => send(open, reject)}
          >
            {t("admin.review.reject")}
          </Button>
        </div>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.review.reason_hint") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
