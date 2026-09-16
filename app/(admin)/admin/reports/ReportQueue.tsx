"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { Button, buttonClassName, Input, Label, Select } from "@/components/primitives";
import { DataTable, Modal, type Column } from "@/components/structure";
import { Alert, StatusBadge, Tag } from "@/components/display";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ReportBoardRow } from "./board";
import type { ActionResult } from "./actions";

/**
 * Board 4h — the queue, as a table.
 *
 * Real `<table>` markup through `DataTable`, which is non-negotiable 4 and the
 * reason the design canvas's div grid is not what ships. Every interpolated
 * string arrives resolved from `board.ts`; the fixed labels are read from the
 * catalogue here, the same arrangement board 4b's `ApprovalQueue` has.
 *
 * ## What this component may do
 *
 * Two things: open a row, and hand it to somebody. Every decision — the
 * outcome, the escalation, the duplicate — is taken on the row's own screen,
 * which is `B5`'s whole point. A dialog on the queue would be a second place a
 * report can be closed, and the one thing stopping this board growing a second
 * route to every outcome is that it has exactly one route to each.
 *
 * The row's action is a **link**, not a button that navigates: a moderator
 * working a queue opens rows in tabs, and a button cannot be middle-clicked.
 */

export interface StaffOption {
  id: string;
  name: string;
}

const MIN_REASON = 4;

/** The option that takes the owner off, rather than an empty value. */
const NOBODY = "nobody";

/**
 * The design system's floor: pagination above fifty rows, and never infinite
 * scroll. The board's own flag 3 — *"46 items, six drawn, no filter, no sort,
 * no pagination"* — is the third of those, and a queue that renders four
 * hundred rows is one nobody reaches the bottom of.
 */
const PAGE_SIZE = 25;

export function ReportQueue({
  rows,
  staff,
  empty,
  assign,
}: {
  rows: readonly ReportBoardRow[];
  staff: readonly StaffOption[];
  empty: React.ReactNode;
  assign: (formData: FormData) => Promise<ActionResult>;
}) {
  const ids = { assignee: useId(), reason: useId() };
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<ReportBoardRow | null>(null);
  const [assigneeId, setAssigneeId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    if (!open) return;
    const form = new FormData();
    form.set("ref", open.ref);
    form.set("assigneeId", assigneeId === NOBODY ? "" : assigneeId);
    form.set("reason", reason);
    startTransition(async () => {
      const outcome = await assign(form);
      setResult(outcome);
      if (outcome.ok) {
        setOpen(null);
        setReason("");
        setAssigneeId("");
      }
    });
  }

  /*
     The order is the server's — over service level first, then oldest — and
     this only takes a window of it. A page that re-sorted would put a moderator
     on page two of a different queue from the one page one was cut from.
  */
  const shown = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [rows, page],
  );

  const columns: Column<ReportBoardRow>[] = [
    {
      key: "type",
      header: t("admin.reports.col.type"),
      width: "8rem",
      render: (row) => (
        <span className="flex flex-col items-start gap-1">
          {/*
             A tag, not a status badge. The type is a taxonomy and the four
             status tones belong to trust — colouring `Fraud` red here would
             borrow the palette that says *verified* and *expired* to say
             *this is a kind of thing*. The row's tone comes from its service
             level, one column across.
          */}
          <Tag>{row.typeLabel}</Tag>
          {row.escalated && (
            <StatusBadge tone="warn" size="sm">
              {t("admin.reports.escalated")}
            </StatusBadge>
          )}
          {row.suspended && (
            <StatusBadge tone="bad" size="sm">
              {t("admin.reports.suspended")}
            </StatusBadge>
          )}
        </span>
      ),
    },
    {
      key: "what",
      header: t("admin.reports.col.what"),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="text-ink">{row.claim}</span>
          {/*
             The measurement, in mono under the claim. Board 4h: *"a moderator
             opens the row already knowing why it is there."*
          */}
          {row.evidence && (
            <span className="font-mono text-eyebrow uppercase tracking-eyebrow text-body">
              {row.evidence}
            </span>
          )}
          <Link
            href={row.businessHref}
            className="w-fit rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {row.businessName}
          </Link>
        </span>
      ),
    },
    {
      key: "reporter",
      header: t("admin.reports.col.reporter"),
      width: "9rem",
      hideBelow: "md",
      render: (row) => (
        <span className="flex flex-col">
          <span className="text-body">{row.reporter}</span>
          {row.duplicates && <span className="text-caption text-muted">{row.duplicates}</span>}
        </span>
      ),
    },
    {
      key: "owner",
      header: t("admin.reports.col.owner"),
      width: "7rem",
      hideBelow: "lg",
      render: (row) =>
        row.owner ? (
          <span className="text-body">{row.owner}</span>
        ) : (
          <span className="text-muted">{t("admin.reports.unassigned")}</span>
        ),
    },
    {
      key: "age",
      header: t("admin.reports.col.age"),
      numeric: true,
      width: "8rem",
      render: (row) => (
        <span className="flex flex-col items-end gap-0.5">
          <span className="font-mono tabular-nums text-ink">{row.waiting}</span>
          {/*
             The word beside the colour, always. `B4`: the tone is derived from
             the service level and is never the only carrier of the state.
          */}
          <StatusBadge tone={row.tone} size="sm">
            {row.slaLabel}
          </StatusBadge>
        </span>
      ),
    },
    {
      key: "action",
      header: t("admin.reports.col.action"),
      width: "8rem",
      render: (row) => (
        <Link href={row.href} className={buttonClassName({ size: "sm", variant: "secondary" })}>
          {row.actionLabel}
        </Link>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        caption={t("admin.reports.caption")}
        columns={columns}
        rows={shown}
        rowKey={(row) => row.ref}
        stickyHeader
        {...(rows.length > PAGE_SIZE
          ? {
              pagination: {
                page,
                pageSize: PAGE_SIZE,
                total: rows.length,
                onPageChange: setPage,
                rangeLabel: (from: number, to: number, total: number) =>
                  t("table.range", {
                    from: formatCount(from),
                    to: formatCount(to),
                    total: formatCount(total),
                  }),
                previousLabel: t("table.previous"),
                nextLabel: t("table.next"),
                pageLabel: (n: number) => t("table.page", { page: formatCount(n) }),
              },
            }
          : {})}
        rowTone={(row) => (row.late ? "attention" : "default")}
        rowMenu={(row) => [
          {
            key: "assign",
            label: t("admin.reports.reassign"),
            onSelect: () => {
              setOpen(row);
              setAssigneeId("");
              setReason("");
              setResult(null);
            },
          },
        ]}
        rowMenuLabel={(row) => t("admin.reports.row_menu", { business: row.businessName })}
        actionsHeader={t("admin.reports.col.more")}
        empty={empty}
      />

      {/*
         A dialog, not a panel under the table.

         The row menu is at the end of a row that can be most of a screen down,
         and an inline editor appended after the table put the controls a long
         scroll from the row they were about. Board 4b's reassign is a `Modal`
         for the same reason, and one control opening in two shapes across two
         queues is a thing to notice rather than to design.
      */}
      {open && (
      <Modal
        open
        onClose={() => {
          if (!pending) setOpen(null);
        }}
        title={t("admin.reports.assign_heading", { business: open.businessName })}
        closeLabel={t("action.cancel")}
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(null)}>
              {t("action.cancel")}
            </Button>
            <Button
              loading={pending}
              disabled={pending || assigneeId === "" || reason.trim().length < MIN_REASON}
              onClick={send}
            >
              {t("admin.reports.assign_confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.assignee} requirement="required" requirementLabel={t("field.required")}>
              {t("admin.reports.assign_to")}
            </Label>
            <Select
              id={ids.assignee}
              value={assigneeId}
              placeholder={t("admin.reports.assign_placeholder")}
              onChange={(event) => setAssigneeId(event.target.value)}
              options={[
                ...staff.map((person) => ({ value: person.id, label: person.name })),
                /*
                   Taking the owner off is a choice in the list rather than an
                   empty value, so an unassignment is something somebody picked.
                */
                { value: NOBODY, label: t("admin.reports.unassign") },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={ids.reason} requirement="required" requirementLabel={t("field.required")}>
              {t("admin.review.reason_label")}
            </Label>
            <Input
              id={ids.reason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        </div>
      </Modal>
      )}

      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: result.fix })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}
    </div>
  );
}
