"use client";

import { useMemo, useState } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Label, Textarea } from "@/components/primitives";
import { DataTable, Modal, Panel, SelectionBar, type Column } from "@/components/structure";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { TradeKindBoard as Board, TradeKindBoardRow } from "@/lib/taxonomy/service";
import type { ActionResult } from "./actions";

/**
 * Board `4d-s` — how every trade is sold.
 *
 * The fork, made operable. About forty screens read what this sets, so it is
 * the first board of the service track and the only place the value is written.
 *
 * ## Why the rows are ordered the way they are
 *
 * Unset first, and that is the screen's whole argument rather than a default.
 * An unset row is not neutral: it inherits whatever the sector says, silently,
 * and no sector is purely one kind — so every unset row is a place a supplier
 * may be shown the wrong screens. Burying them alphabetically would hide the
 * only work this screen exists to produce.
 *
 * The order and the progress figure come from one array (`loadTradeKindBoard`),
 * because this project has shipped a header reading `18 OF 22` over a table of
 * sixteen rows. Two numbers derived separately are two numbers that can
 * disagree.
 *
 * ## Why changing a row asks first
 *
 * Flipping a trade changes which onboarding its suppliers get, which dashboard
 * nav they see and which storefront renders — so the confirmation names how
 * many published listings that is, at the moment of the click. It also says
 * plainly that nothing is converted: a product keeps its stock level, a service
 * keeps its scope, and the fields the other kind does not have stay empty. A
 * silent conversion would destroy data, and this screen is the only place
 * somebody could trigger one.
 *
 * A selection touching no listings skips the confirmation. Asking about
 * nothing teaches people to click through the dialog that matters.
 */

const MIN_REASON = 4;
const PAGE_SIZE = 25;

type Pending = { kind: "goods" | "services" | "inherit"; ids: string[] };

export function TradeKindBoard({
  board,
  canWrite,
  setKindBulk,
  preview,
}: {
  board: Board;
  canWrite: boolean;
  setKindBulk: (formData: FormData) => Promise<ActionResult>;
  preview: (
    categoryIds: readonly string[],
    kind: string,
  ) => Promise<{ rows: number; alsoInheriting: number; listings: number }>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);
  const [impact, setImpact] = useState<{
    rows: number;
    alsoInheriting: number;
    listings: number;
  } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  const pageRows = useMemo(
    () => board.rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [board.rows, page],
  );

  function ask(kind: Pending["kind"]) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setPending({ kind, ids });
    setImpact(null);
    void preview(ids, kind).then(setImpact);
  }

  function commit() {
    if (!pending) return;
    const form = new FormData();
    form.set("categoryIds", pending.ids.join(","));
    form.set("kind", pending.kind);
    form.set("reason", reason);

    void (async () => {
      setBusy(true);
      try {
        const outcome = await setKindBulk(form);
        setResult(outcome);
        if (outcome.ok) {
          setSelected([]);
          setReason("");
          setPending(null);
          setImpact(null);
        }
      } finally {
        setBusy(false);
      }
    })();
  }

  /*
     Ancestor names, so an inherited row says which sector it came from.
     "From Logistics & freight forwarding" is a reason to leave a row alone; a
     bare "sold by the job" is not, and there are 440 rows to triage.

     Built from the whole board rather than the page, because the ancestor of a
     row on page 12 is usually a sector on page 1.
  */
  const nameOf = useMemo(
    () => new Map(board.rows.map((row) => [row.id, row.name])),
    [board.rows],
  );
  const ancestorName = (id: string) => nameOf.get(id) ?? "—";

  const columns: Column<TradeKindBoardRow>[] = [
    {
      key: "trade",
      header: t("taxonomy.col.subcategory"),
      render: (row) => (
        <span className="flex flex-col">
          <span className={row.isSector ? "text-ink" : "text-body"}>{row.name}</span>
          {row.isSector && (
            <span className="font-mono text-eyebrow uppercase text-faint">
              {t("taxonomy.kind_sector")}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "sector",
      header: t("taxonomy.col.sector"),
      hideBelow: "md",
      render: (row) => row.sectorName ?? "—",
    },
    {
      key: "kind",
      header: t("taxonomy.kind"),
      width: "13rem",
      render: (row) => (
        <span className="flex flex-col">
          {/*
             Three states kept apart. A row nobody has decided about is NOT
             rendered as "sold by the item" with a quiet note — it is rendered
             as not set, because a trade somebody decided is sold by the item
             and one nobody has opened are different facts, and finding the
             second is the whole job of this screen.
          */}
          {row.trade.from === "default" ? (
            <StatusBadge tone="warn">{t("taxonomy.kind_unset")}</StatusBadge>
          ) : (
            <StatusBadge tone={row.trade.kind === "services" ? "info" : "neutral"}>
              {row.trade.kind === "services"
                ? t("taxonomy.kind_services")
                : t("taxonomy.kind_goods")}
            </StatusBadge>
          )}
          {row.trade.from === "inherited" && (
            <span className="mt-0.5 text-caption text-faint">
              {t("taxonomy.kind_from", { name: ancestorName(row.trade.ancestorId) })}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "listings",
      header: t("taxonomy.col.listings"),
      numeric: true,
      width: "7rem",
      // On the row deliberately: changing a trade with 488 listings is a
      // different act from changing one with 12, and the number belongs where
      // the decision is made rather than only in the dialog after it.
      render: (row) => formatCount(row.listings),
    },
    {
      key: "setBy",
      header: t("taxonomy.col.set_by"),
      hideBelow: "lg",
      width: "9rem",
      // Read from the audit log, never a column on the category. A second copy
      // of "who decided this" is a second thing to keep in step with the log.
      render: (row) => row.setBy ?? "—",
    },
  ];

  const actions = [
    { key: "goods", label: t("taxonomy.kind_set_goods"), onSelect: () => ask("goods") },
    { key: "services", label: t("taxonomy.kind_set_services"), onSelect: () => ask("services") },
    { key: "inherit", label: t("taxonomy.kind_clear_inherit"), onSelect: () => ask("inherit") },
  ];

  const ready = reason.trim().length >= MIN_REASON;
  const consequential = (impact?.listings ?? 0) > 0;

  return (
    <Panel
      title={t("taxonomy.kind_board_title")}
      description={t("taxonomy.kind_board_meta", {
        decided: formatCount(board.decided),
        total: formatCount(board.total),
      })}
    >
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"}>{result.ok ? result.message : result.error}</Alert>
      )}

      {!canWrite && <Alert tone="info">{t("taxonomy.kind_read_only")}</Alert>}

      <p className="mt-2 max-w-prose text-body-sm text-prose">
        {board.unset > 0
          ? t("taxonomy.kind_unset_note", { count: board.unset })
          : t("taxonomy.kind_none_unset")}
      </p>

      {canWrite && selected.length > 0 && (
        <div className="mt-4">
          <SelectionBar
            count={selected.length}
            countLabel={(count) => t("taxonomy.kind_selected", { count })}
            actions={actions}
            onClear={() => setSelected([])}
            clearLabel={t("taxonomy.kind_clear_selection")}
          />
        </div>
      )}

      <div className="mt-4">
        <DataTable
          columns={columns}
          rows={pageRows}
          rowKey={(row) => row.id}
          caption={t("taxonomy.kind_board_caption")}
          {...(canWrite
            ? {
                selectable: true as const,
                selected,
                onSelectedChange: setSelected,
                selectAllLabel: t("taxonomy.kind_select_all"),
                selectRowLabel: (row: TradeKindBoardRow) =>
                  t("taxonomy.kind_select_row", { name: row.name }),
              }
            : {})}
          rowTone={(row) => (selected.includes(row.id) ? "selected" : "default")}
          empty={<p className="text-body-sm text-muted">{t("taxonomy.kind_empty")}</p>}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total: board.total,
            onPageChange: setPage,
            rangeLabel: (from, to, total) =>
              t("taxonomy.kind_range", {
                from: formatCount(from),
                to: formatCount(to),
                total: formatCount(total),
              }),
            previousLabel: t("taxonomy.kind_prev"),
            nextLabel: t("taxonomy.kind_next"),
            pageLabel: (p) => t("taxonomy.kind_page", { page: formatCount(p) }),
          }}
        />
      </div>

      <Modal
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setImpact(null);
        }}
        title={t("taxonomy.kind_confirm_title")}
        closeLabel={t("taxonomy.kind_cancel")}
      >
        <div className="flex flex-col gap-3">
          {/*
             The three numbers, and the middle one is the reason a sector write
             is not the same act as a trade write: selecting one sector with no
             listings of its own can change what forty trades holding four
             thousand businesses render.
          */}
          <ul className="flex flex-col gap-1 text-body-sm text-prose">
            <li>{t("taxonomy.kind_confirm_rows", { count: impact?.rows ?? 0 })}</li>
            {(impact?.alsoInheriting ?? 0) > 0 && (
              <li>
                {t("taxonomy.kind_confirm_inheriting", { count: impact!.alsoInheriting })}
              </li>
            )}
            <li>
              {consequential
                ? t("taxonomy.kind_confirm_listings", { count: impact!.listings })
                : t("taxonomy.kind_confirm_nothing")}
            </li>
          </ul>

          <p className="max-w-prose text-body-sm text-prose">{t("taxonomy.kind_confirm_body")}</p>

          <div>
            <Label htmlFor="kind-bulk-reason">{t("guide_admin.field.reason")}</Label>
            <Textarea
              id="kind-bulk-reason"
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={commit} disabled={!ready || busy || impact === null}>
              {t("taxonomy.kind_confirm_go")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setPending(null);
                setImpact(null);
              }}
            >
              {t("taxonomy.kind_cancel")}
            </Button>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}
