"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input } from "@/components/primitives";
import { DataTable, Modal, SelectionBar } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ServiceRow, ServicesBoard } from "@/lib/services/service";
import type { Completeness, RequiredField } from "@/lib/services/scope-sheet";
import type {
  addService,
  publishServices,
  removeService,
  saveServiceOrder,
} from "./actions";

/**
 * Board `3f-s` — the services list.
 *
 * The goods equivalent is a table of hundreds with stock, price, CSV import,
 * bulk price edit and a search box you need because you cannot see your own
 * catalogue. **The volume assumption inverts**: an FM contractor has six
 * services, an audit practice four, nobody has six hundred. So this is short
 * and dense, with no search and no pagination, and the interesting column is
 * one the product list does not have — how complete each scope sheet is.
 *
 * Every label is resolved here rather than passed in from the page, because a
 * function prop crossing into a client component is this repo's most repeated
 * defect and `tests/unit/client-labels` fails the build on one.
 */

const GAP_LABEL: Record<RequiredField, string> = {
  name: t("service_editor.name"),
  engagementType: t("service_editor.engagement"),
  feeBasis: t("service_editor.fee_basis"),
  turnaround: t("service_editor.turnaround"),
  deliveredWhere: t("service_editor.delivered_where"),
  deliverable: t("service_editor.deliverable"),
};

const ENGAGEMENT_LABEL: Record<string, string> = {
  ongoing_contract: t("engagement.ongoing_contract"),
  one_off_job: t("engagement.one_off_job"),
  call_off: t("engagement.call_off"),
};

export function ServicesWorkspace({
  board,
  businessSlug,
  canEdit,
  actions,
}: {
  board: ServicesBoard;
  businessSlug: string;
  canEdit: boolean;
  actions: {
    add: typeof addService;
    publish: typeof publishServices;
    reorder: typeof saveServiceOrder;
    remove: typeof removeService;
  };
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ServiceRow[]>(board.rows);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [doomed, setDoomed] = useState<ServiceRow | null>(null);

  const atCap = board.allowance.atCap;

  const onAdd = () => {
    if (busy) return;
    setBusy(true);
    const form = new FormData();
    form.set("name", name);
    void actions.add(form).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(
          result.reason === "at_cap"
            ? t("services.at_cap", {
                cap: formatCount(result.cap ?? 0),
                plan: result.planName ?? board.planName,
              })
            : t("services.error.save_failed"),
        );
        return;
      }
      setName("");
      // Straight into the editor: a service with no scope sheet is a row, and
      // the row is not the thing the seller came here to make.
      router.push(`/dashboard/services/${result.id}`);
    });
  };

  const setStatus = (ids: readonly string[], status: "live" | "draft") => {
    if (busy || ids.length === 0) return;
    setBusy(true);
    setRows((current) =>
      current.map((row) => (ids.includes(row.id) ? { ...row, status } : row)),
    );
    const form = new FormData();
    form.set("ids", ids.join(","));
    form.set("status", status);
    void actions.publish(form).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setRows(board.rows);
        setError(t("services.error.save_failed"));
        return;
      }
      setSelected([]);
      setError(null);
      router.refresh();
    });
  };

  const move = (id: string, by: -1 | 1) => {
    const index = rows.findIndex((row) => row.id === id);
    const next = index + by;
    if (index < 0 || next < 0 || next >= rows.length) return;

    const reordered = [...rows];
    const [row] = reordered.splice(index, 1);
    reordered.splice(next, 0, row!);
    setRows(reordered);

    const form = new FormData();
    form.set("ids", reordered.map((entry) => entry.id).join(","));
    void actions.reorder(form).then((result) => {
      if (!result.ok) {
        setRows(board.rows);
        setError(t("services.error.save_failed"));
      }
    });
  };

  const onDelete = () => {
    if (!doomed || busy) return;
    setBusy(true);
    const form = new FormData();
    form.set("id", doomed.id);
    void actions.remove(form).then((result) => {
      setBusy(false);
      setDoomed(null);
      if (!result.ok) {
        setError(t("services.error.save_failed"));
        return;
      }
      router.refresh();
    });
  };

  const columns = useMemo(
    () => [
      {
        key: "name",
        header: t("services.col.service"),
        render: (row: ServiceRow) => (
          <Link
            href={`/dashboard/services/${row.id}`}
            className="rounded-tag text-body-sm text-ink underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {row.name}
          </Link>
        ),
      },
      {
        key: "engagement",
        header: t("services.col.engagement"),
        hideBelow: "md" as const,
        render: (row: ServiceRow) => notSet(row.engagementType && ENGAGEMENT_LABEL[row.engagementType]),
      },
      {
        key: "fee",
        header: t("services.col.fee_basis"),
        hideBelow: "md" as const,
        render: (row: ServiceRow) => notSet(row.feeBasisLabel),
      },
      {
        key: "turnaround",
        header: t("services.col.turnaround"),
        hideBelow: "lg" as const,
        render: (row: ServiceRow) => notSet(row.turnaround),
      },
      {
        key: "sheet",
        header: t("services.col.sheet"),
        numeric: true,
        render: (row: ServiceRow) => <SheetCount value={row.completeness} />,
      },
      {
        key: "status",
        header: t("services.col.status"),
        render: (row: ServiceRow) => (
          <StatusBadge tone={row.status === "live" ? "ok" : "neutral"}>
            {row.status === "live" ? t("services.status.live") : t("services.status.draft")}
          </StatusBadge>
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={t("services.error.save_failed")}>
          {error}
        </Alert>
      )}

      {/*
        The counter and the control beside it, in the grammar board 2c set and
        3f kept: used over allowed, plan named, and where the cap is reached the
        control becomes a link to the plan rather than a button that would be
        refused on click.
      */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-dashed border-line-strong bg-card px-4 py-3">
        <p className="text-body-sm text-body">{counterLabel(board)}</p>

        {canEdit &&
          (atCap ? (
            board.upgrade && (
              <Link
                href="/dashboard/billing"
                className="ms-auto inline-flex w-fit items-center rounded-pill border border-dashed border-line-strong px-3 py-1.5 text-caption text-moss hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
              >
                {board.upgrade.cap === null
                  ? t("services.upgrade_unlimited", { plan: board.upgrade.planName })
                  : t("services.upgrade", {
                      plan: board.upgrade.planName,
                      cap: formatCount(board.upgrade.cap),
                    })}
              </Link>
            )
          ) : (
            <div className="ms-auto flex flex-wrap items-center gap-2">
              <Input
                value={name}
                disabled={busy}
                placeholder={t("services.add_placeholder")}
                aria-label={t("services.add_placeholder")}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onAdd();
                  }
                }}
              />
              <Button size="sm" variant="secondary" disabled={busy} onClick={onAdd}>
                {t("services.add")}
              </Button>
            </div>
          ))}
      </div>

      <p className="text-caption text-muted">{t("services.no_stock_note")}</p>

      {selected.length > 0 && canEdit && (
        <SelectionBar
          count={selected.length}
          countLabel={(count) => t("services.selected", { count })}
          clearLabel={t("services.clear_selection")}
          onClear={() => setSelected([])}
          actions={[
            {
              key: "publish",
              label: t("services.publish"),
              onSelect: () => setStatus(selected, "live"),
            },
            {
              key: "unpublish",
              label: t("services.unpublish"),
              onSelect: () => setStatus(selected, "draft"),
            },
          ]}
        />
      )}

      <DataTable
        caption={t("services.title")}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        selectable={canEdit}
        selected={selected}
        onSelectedChange={setSelected}
        selectAllLabel={t("services.select_all")}
        selectRowLabel={(row) => t("services.select_row", { name: row.name })}
        {...(canEdit
          ? {
              /*
                 No `rowAction`. The service name in the first column is already
                 a link to the editor, and a second button repeating it with the
                 row's full name in it is a wide column of wrapped text saying
                 what the row beside it already says.
              */
              rowMenu: (row: ServiceRow) => [
                ...(ordering
                  ? [
                      {
                        key: "up",
                        label: t("services.move_up", { name: row.name }),
                        onSelect: () => move(row.id, -1),
                        disabled: rows[0]?.id === row.id,
                      },
                      {
                        key: "down",
                        label: t("services.move_down", { name: row.name }),
                        onSelect: () => move(row.id, 1),
                        disabled: rows.at(-1)?.id === row.id,
                      },
                    ]
                  : []),
                {
                  key: "status",
                  label: row.status === "live" ? t("services.unpublish") : t("services.publish"),
                  onSelect: () => setStatus([row.id], row.status === "live" ? "draft" : "live"),
                },
                ...(row.status === "live"
                  ? [
                      {
                        key: "view",
                        label: t("services.view_public"),
                        onSelect: () =>
                          router.push(`/b/${businessSlug}/s/${row.slug}`),
                      },
                    ]
                  : []),
                {
                  key: "delete",
                  label: t("services.delete"),
                  onSelect: () => setDoomed(row),
                  destructive: true,
                },
              ],
              rowMenuLabel: (row: ServiceRow) => t("services.open", { name: row.name }),
              actionsHeader: t("services.col.actions"),
            }
          : {})}
        empty={
          <div className="px-4 py-8 text-center">
            <p className="text-body-sm text-ink">{t("services.empty_title")}</p>
            <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
              {t("services.empty_body")}
            </p>
          </div>
        }
      />

      {/*
        The line under the table, and it names the row — `3f-s` Q1. "Chiller
        overhaul is at 4 of 6" is actionable; "2 services incomplete" is a nag.
        Suppressed entirely when every sheet is complete rather than replaced by
        a congratulation.
      */}
      {board.worst ? (
        <p className="max-w-prose text-caption text-muted">
          {t("services.gap_line", {
            name: board.worst.name,
            filled: formatCount(board.worst.completeness.filled),
            total: formatCount(board.worst.completeness.total),
            missing: listGaps(board.worst.completeness.missing),
          })}
        </p>
      ) : (
        rows.length > 0 && (
          <p className="text-caption text-muted">{t("services.all_complete")}</p>
        )
      )}

      {canEdit && rows.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => setOrdering((on) => !on)}>
            {ordering ? t("services.reorder_done") : t("services.reorder")}
          </Button>
          {ordering && <p className="text-caption text-muted">{t("services.reorder_hint")}</p>}
        </div>
      )}

      {doomed && (
        <Modal
          open
          title={t("services.delete_title", { name: doomed.name })}
          closeLabel={t("services.cancel")}
          onClose={() => setDoomed(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDoomed(null)}>
                {t("services.cancel")}
              </Button>
              <Button variant="danger" disabled={busy} onClick={onDelete}>
                {t("services.delete_confirm")}
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-body">{t("services.delete_body")}</p>
        </Modal>
      )}
    </div>
  );
}

/** Board `3f-s` B6: a draft's empty enum reads `Not set`, never a blank cell. */
function notSet(value: string | null | undefined) {
  return value ? (
    <span className="text-body-sm text-body">{value}</span>
  ) : (
    <span className="text-body-sm text-faint">{t("services.not_set")}</span>
  );
}

/**
 * `6 of 6`, and amber under the bar rather than red.
 *
 * Not an error state. A 4-of-6 service is live and allowed to be — the colour
 * says there is reach being left behind, not that something is broken, and a
 * red cell over a working listing is the completeness gate arriving by the back
 * door.
 */
function SheetCount({ value }: { value: Completeness }) {
  const short = value.filled < value.total;
  return (
    <span className={short ? "text-body-sm text-warn-ink" : "text-body-sm text-body"}>
      {t("services.sheet", {
        filled: formatCount(value.filled),
        total: formatCount(value.total),
      })}
    </span>
  );
}

function counterLabel(board: ServicesBoard): string {
  const { used, cap } = board.allowance;
  if (cap === null) {
    return t("services.counter_unlimited", { used: formatCount(used), plan: board.planName });
  }
  const key = cap === 1 ? "services.counter_one" : "services.counter";
  return t(key, { used: formatCount(used), cap: formatCount(cap), plan: board.planName });
}

/**
 * `no deliverable and no delivered where`.
 *
 * "no" on each item rather than once at the front, because "no deliverable and
 * delivered where" reads as one missing field and one present one — which is
 * the opposite of what it says.
 */
function listGaps(gaps: readonly RequiredField[]): string {
  const words = gaps.map((gap) =>
    t("services.gap_none", { field: GAP_LABEL[gap].toLowerCase() }),
  );
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")}${t("services.gap_join")}${words.at(-1)}`;
}
