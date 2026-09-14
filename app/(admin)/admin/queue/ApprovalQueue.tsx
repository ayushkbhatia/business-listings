"use client";

import Link from "next/link";
import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { Button, buttonClassName, Label, Select, Textarea } from "@/components/primitives";
import { DataTable, Modal, SelectionBar, type Column } from "@/components/structure";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { ReasonModal } from "../ingest/ReasonModal";
import type { ActionResult } from "./actions";
import type { BoardRow } from "./board";

/**
 * Board 4b — the rows, the selection and the decisions.
 *
 * **The bulk action is bounded in the bar that offers it.** `Approve all` is
 * enabled only while every selected row passed every check, and when it is not
 * the bar says how many rows block it rather than greying out a button with no
 * explanation. The server checks again, row by row, on submit (B1); this is the
 * rule where a person can see it.
 *
 * **The per-row action differs by what the checks found** (B6): approve where
 * everything passed, request a document where a check asked for one, reject
 * where one failed outright, and open the file everywhere else. There is no
 * row with a lone Approve that the checks did not earn.
 *
 * Every decision asks for a written reason in the same dialog that names what
 * it will do (B8).
 */

type Op = "approve" | "reject" | "request_docs" | "reassign";

export interface ApprovalQueueProps {
  rows: readonly BoardRow[];
  staff: readonly { id: string; name: string }[];
  empty: React.ReactNode;
  decide: (formData: FormData) => Promise<ActionResult>;
  bulk: (formData: FormData) => Promise<ActionResult>;
}

const CHECK_TONE = { pass: "text-ok-ink", warn: "text-warn-ink", fail: "text-bad-ink" } as const;

export function ApprovalQueue({ rows, staff, empty, decide, bulk }: ApprovalQueueProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ op: Op; refs: string[]; name?: string } | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);

  // A selection only ever names rows that are on screen: a decision elsewhere
  // or a filter change drops the rest rather than acting on rows nobody can see.
  const visible = useMemo(() => new Set(rows.map((row) => row.ref)), [rows]);
  const selection = selected.filter((ref) => visible.has(ref));
  const chosen = rows.filter((row) => selection.includes(row.ref));
  const blocking = chosen.filter((row) => !row.allPassed).length;

  function done(outcome: ActionResult) {
    setDialog(null);
    setResult(outcome);
    if (outcome.ok) setSelected([]);
    router.refresh();
  }

  const columns: Column<BoardRow>[] = [
    {
      key: "submission",
      header: t("admin.queue.col.submission"),
      render: (row) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-ink">{row.businessName}</span>
          {/* Body, not muted, on a conflict's red wash: muted there is 4.17:1, under §09.2's floor. */}
          <span className={cn("text-caption", row.kind === "conflict" ? "text-body" : "text-muted")}>{row.summary}</span>
          {row.docsWaiting && <span className="text-caption text-warn-ink">{row.docsWaiting}</span>}
        </span>
      ),
    },
    {
      key: "type",
      header: t("admin.queue.col.type"),
      width: "8.5rem",
      hideBelow: "md",
      render: (row) => (
        <StatusBadge tone={row.kind === "conflict" ? "bad" : "neutral"} shape="chip">
          {row.typeLabel}
        </StatusBadge>
      ),
    },
    {
      key: "checks",
      header: t("admin.queue.col.checks"),
      width: "17rem",
      render: (row) => (
        <span className={cn("text-body-sm", CHECK_TONE[row.worst])}>
          {row.checks
            .slice(0, 3)
            .map((check) => check.text)
            .join(" · ")}
        </span>
      ),
    },
    {
      key: "waiting",
      header: t("admin.queue.col.waiting"),
      width: "7rem",
      render: (row) => (
        <span className={cn("tabular-nums", row.late ? "font-medium text-bad-ink" : "text-body")}>
          {row.waiting}
          {row.late && <span className="sr-only"> {t("admin.queue.late_label")}</span>}
        </span>
      ),
    },
    {
      key: "owner",
      header: t("admin.queue.col.owner"),
      width: "9rem",
      hideBelow: "lg",
      render: (row) =>
        row.owner ? (
          <span className="text-body">{row.owner}</span>
        ) : (
          <span className={row.kind === "conflict" ? "text-body" : "text-muted"}>{t("admin.queue.unassigned")}</span>
        ),
    },
    {
      key: "action",
      header: t("admin.queue.col.action"),
      width: "8rem",
      render: (row) => <RowButton row={row} onOpen={(op) => setDialog({ op, refs: [row.ref], name: row.businessName })} />,
    },
  ];

  const count = { count: dialog?.refs.length ?? 0, n: formatCount(dialog?.refs.length ?? 0) };
  const single = dialog?.refs.length === 1 && dialog.name;
  const fields = (op: Op): Record<string, string> =>
    dialog ? (dialog.refs.length === 1 && single ? { op, ref: dialog.refs[0]! } : { op }) : {};
  // Bulk sends every ref under the same name; a single row uses the per-row action.
  const actionFor = (refs: readonly string[]) =>
    refs.length === 1 && single
      ? decide
      : async (form: FormData) => {
          for (const ref of refs) form.append("ref", ref);
          return bulk(form);
        };

  return (
    <div className="flex flex-col gap-3">
      {result && (
        <Alert
          tone={result.ok ? "ok" : "bad"}
          live={result.ok ? "polite" : "assertive"}
          {...(result.ok ? {} : { fix: t("admin.queue.error.fix") })}
        >
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      {selection.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <SelectionBar
            count={selection.length}
            countLabel={(value) => t("admin.queue.bulk.selected", { count: value, n: formatCount(value) })}
            onClear={() => setSelected([])}
            clearLabel={t("admin.queue.bulk.clear")}
            actions={[
              {
                key: "approve",
                label: t("admin.queue.bulk.approve"),
                disabled: blocking > 0,
                onSelect: () => setDialog({ op: "approve", refs: selection }),
              },
              { key: "request", label: t("admin.queue.bulk.request_docs"), onSelect: () => setDialog({ op: "request_docs", refs: selection }) },
              { key: "reassign", label: t("admin.queue.bulk.reassign"), onSelect: () => setDialog({ op: "reassign", refs: selection }) },
              {
                key: "reject",
                label: t("admin.queue.bulk.reject"),
                destructive: true,
                onSelect: () => setDialog({ op: "reject", refs: selection }),
              },
            ]}
          />
          <p className={cn("text-caption", blocking > 0 ? "text-warn-ink" : "text-muted")} aria-live="polite">
            {blocking > 0
              ? t("admin.queue.bulk.blocked", { count: blocking, n: formatCount(blocking) })
              : t("admin.queue.bulk.rule")}
          </p>
        </div>
      )}

      <DataTable
        caption={t("admin.queue.caption_board")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.ref}
        selectable
        selected={selection}
        onSelectedChange={setSelected}
        selectAllLabel={t("admin.queue.select_all")}
        selectRowLabel={(row) => t("admin.queue.select_row", { name: row.businessName })}
        rowTone={(row) => (row.kind === "conflict" ? "blocked" : "default")}
        stickyHeader
        empty={empty}
      />

      <ReasonModal
        open={dialog?.op === "approve"}
        onClose={() => setDialog(null)}
        title={single ? t("admin.queue.dialog.approve_one_title", { name: dialog!.name! }) : t("admin.queue.dialog.approve_title", count)}
        description={single ? t("admin.queue.dialog.approve_one_description") : t("admin.queue.dialog.approve_description")}
        confirmLabel={single ? t("admin.queue.action.approve") : t("admin.queue.dialog.approve_confirm", count)}
        reasonHint={t("admin.queue.dialog.reason_hint")}
        fields={fields("approve")}
        action={actionFor(dialog?.refs ?? [])}
        onDone={done}
      />
      <ReasonModal
        open={dialog?.op === "reject"}
        onClose={() => setDialog(null)}
        title={single ? t("admin.queue.dialog.reject_one_title", { name: dialog!.name! }) : t("admin.queue.dialog.reject_title", count)}
        description={t("admin.queue.dialog.reject_description")}
        confirmLabel={single ? t("admin.queue.action.reject") : t("admin.queue.dialog.reject_confirm", count)}
        destructive
        reasonHint={t("admin.queue.needs_reason")}
        fields={fields("reject")}
        action={actionFor(dialog?.refs ?? [])}
        onDone={done}
      />
      <ReasonModal
        open={dialog?.op === "request_docs"}
        onClose={() => setDialog(null)}
        title={single ? t("admin.queue.dialog.request_one_title", { name: dialog!.name! }) : t("admin.queue.dialog.request_title", count)}
        description={t("admin.queue.dialog.request_description")}
        confirmLabel={t("admin.queue.dialog.request_confirm")}
        reasonHint={t("admin.queue.dialog.request_hint")}
        fields={fields("request_docs")}
        action={actionFor(dialog?.refs ?? [])}
        onDone={done}
      />
      {dialog?.op === "reassign" && (
        <ReassignDialog
          refs={dialog.refs}
          staff={staff}
          onClose={() => setDialog(null)}
          bulk={bulk}
          onDone={done}
        />
      )}
    </div>
  );
}

function RowButton({ row, onOpen }: { row: BoardRow; onOpen: (op: Op) => void }) {
  if (row.action === "review" || row.kind === "conflict") {
    if (!row.actionHref) return <span className="text-caption text-body">{t("admin.queue.ops_lead_decides")}</span>;
    return (
      <Link
        href={row.actionHref}
        className={buttonClassName({ size: "sm", variant: row.kind === "conflict" ? "danger" : "secondary" })}
      >
        {t("admin.queue.action.review")}
      </Link>
    );
  }
  if (row.decidesOnScreen && row.actionHref) {
    const label =
      row.action === "approve"
        ? "admin.queue.action.approve"
        : row.action === "reject"
          ? "admin.queue.action.reject"
          : "admin.queue.action.request_doc";
    return (
      <Link href={row.actionHref} className={buttonClassName({ size: "sm", variant: row.action === "approve" ? "primary" : "secondary" })}>
        {t(label)}
      </Link>
    );
  }
  if (row.action === "approve") {
    return (
      <Button size="sm" onClick={() => onOpen("approve")}>
        {t("admin.queue.action.approve")}
      </Button>
    );
  }
  return (
    <Button size="sm" variant="secondary" onClick={() => onOpen(row.action === "reject" ? "reject" : "request_docs")}>
      {t(row.action === "reject" ? "admin.queue.action.reject" : "admin.queue.action.request_doc")}
    </Button>
  );
}

const MIN_REASON = 4;

function ReassignDialog({
  refs,
  staff,
  onClose,
  bulk,
  onDone,
}: {
  refs: readonly string[];
  staff: readonly { id: string; name: string }[];
  onClose: () => void;
  bulk: (formData: FormData) => Promise<ActionResult>;
  onDone: (result: ActionResult) => void;
}) {
  const ids = { assignee: useId(), reason: useId() };
  const [assigneeId, setAssigneeId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const form = new FormData();
    form.set("op", "reassign");
    form.set("assigneeId", assigneeId === "nobody" ? "" : assigneeId);
    form.set("reason", reason);
    for (const ref of refs) form.append("ref", ref);
    startTransition(async () => {
      const outcome = await bulk(form);
      if (outcome.ok) onDone(outcome);
      else setError(outcome.error);
    });
  }

  const count = { count: refs.length, n: formatCount(refs.length) };
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={t("admin.queue.dialog.reassign_title", count)}
      closeLabel={t("action.cancel")}
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button loading={pending} disabled={pending || assigneeId === "" || reason.trim().length < MIN_REASON} onClick={send}>
            {t("admin.queue.dialog.reassign_confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={ids.assignee} requirement="required" requirementLabel={t("field.required")}>
            {t("admin.queue.dialog.assignee")}
          </Label>
          <Select
            id={ids.assignee}
            value={assigneeId}
            placeholder={t("admin.queue.dialog.assignee")}
            onChange={(event) => setAssigneeId(event.target.value)}
            options={[
              ...staff.map((person) => ({ value: person.id, label: person.name })),
              { value: "nobody", label: t("admin.queue.dialog.nobody") },
            ]}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={ids.reason}
            requirement="required"
            requirementLabel={t("field.required")}
            hint={t("admin.queue.dialog.reason_hint")}
          >
            {t("admin.review.reason_label")}
          </Label>
          <Textarea id={ids.reason} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        {error && (
          <Alert tone="bad" live="assertive" fix={t("admin.queue.error.fix")}>
            {error}
          </Alert>
        )}
      </div>
    </Modal>
  );
}
