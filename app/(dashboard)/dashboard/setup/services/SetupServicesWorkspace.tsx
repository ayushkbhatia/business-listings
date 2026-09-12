"use client";

import { useId, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Tag } from "@/components/display";
import { Button, Input, Select } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { FIELD_LABEL } from "@/lib/services/gaps";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type {
  AddRowResult,
  ChooseSheetResult,
  PatchRowResult,
  SeedListResult,
} from "./actions";

/**
 * Board `8c-s` — two steps, and the order is the whole design.
 *
 * Step 1 picks the scope sheet; step 2 adds services. The sheet decides which
 * rows exist, so a service added before one is chosen has nowhere to put its
 * values — which is why step 2 is not merely disabled here but refused by the
 * server too (`seedFromCommonServices` answers `no_sheet`). A disabled
 * fieldset is a hint, not a gate.
 *
 * ## Typed inline, saved per field
 *
 * Four cheap fields — name, engagement, turnaround, fee basis — through the
 * same `patchServiceField` the `3g-s` editor uses, so the fee-basis rule is
 * enforced once rather than twice. Everything else is a link out to that
 * editor. **No fee amount is collected here at all** (B7, AC7): it is on
 * `3g-s`, it is private, and this screen does not name it.
 *
 * Each field saves on blur rather than on a form submit, because the table is
 * the form — there is no moment at which a seller "finishes" a row, and a
 * screen that lost a typed cell on navigation would be the one thing a setup
 * task cannot afford.
 */

export interface SheetCardView {
  id: string;
  name: string;
  rows: number;
  required: number;
  filterable: number;
  usedBy: number;
  matchRank: number | null;
  isDefault: boolean;
  chosen: boolean;
}

export interface ServiceRowView {
  id: string;
  name: string;
  engagementType: string | null;
  feeBasis: string | null;
  turnaround: string | null;
  live: boolean;
  filled: number;
  total: number;
  counts: boolean;
  href: string;
}

export interface SetupServicesWorkspaceProps {
  sheets: readonly SheetCardView[];
  chosenFamilyId: string | null;
  /** The chosen family's own fee bases — never a global list, `3g-s` B2. */
  feeBases: readonly { value: string; label: string }[];
  engagementTypes: readonly { value: string; label: string }[];
  rows: readonly ServiceRowView[];
  /** The trade named in the seed button, e.g. "audit & assurance". */
  seedTrade: string | null;
  seedCount: number;
  target: number;
  atCap: boolean;
  choose: (formData: FormData) => Promise<ChooseSheetResult>;
  seed: () => Promise<SeedListResult>;
  add: (formData: FormData) => Promise<AddRowResult>;
  patch: (formData: FormData) => Promise<PatchRowResult>;
}

interface Failure {
  error: string;
  fix: string;
}

export function SetupServicesWorkspace({
  sheets,
  chosenFamilyId,
  feeBases,
  engagementTypes,
  rows,
  seedTrade,
  seedCount,
  target,
  atCap,
  choose,
  seed,
  add,
  patch,
}: SetupServicesWorkspaceProps) {
  const router = useRouter();
  const ids = useId();
  /** The new-service field, cleared and refocused after each add. */
  const newRowId = `${useId()}-new`;
  const newRow = () => document.getElementById(newRowId) as HTMLInputElement | null;

  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const locked = chosenFamilyId === null;
  const matched = sheets.filter((sheet) => sheet.matchRank !== null).length;

  function onChoose(familyId: string): void {
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("familyId", familyId);
      const done = await choose(form);
      if (!done.ok) {
        setFailure(done);
        return;
      }
      router.refresh();
    });
  }

  function onSeed(): void {
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const done = await seed();
      if (!done.ok) {
        setFailure(done);
        return;
      }
      setNote(
        done.created === 0
          ? t("setup_services.seed_all_present")
          : t("setup_services.seeded", {
              count: done.created,
              formatted: formatCount(done.created),
            }),
      );
      router.refresh();
    });
  }

  function onAdd(formData: FormData): void {
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const done = await add(formData);
      if (!done.ok) {
        setFailure(done);
        return;
      }
      const field = newRow();
      if (field) field.value = "";
      router.refresh();
      field?.focus();
    });
  }

  /**
   * Save one cell, and only when it changed.
   *
   * Blurring a field nobody touched would write a revision row saying a seller
   * set turnaround to the value it already had — `3g-s`'s change log is read by
   * people, and filling it with no-ops makes it useless.
   */
  function onCell(id: string, field: string, value: string, before: string | null): void {
    if (value.trim() === (before ?? "").trim()) return;
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const form = new FormData();
      form.set("id", id);
      form.set("field", field);
      form.set("value", value);
      const done = await patch(form);
      if (!done.ok) {
        setFailure(done);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-7">
      {/* ── Step 1 ─────────────────────────────────────────────────────── */}
      <section aria-labelledby={`${ids}-step1`} className="flex flex-col gap-3.5">
        <div>
          <h2 id={`${ids}-step1`} className="text-h3 font-medium text-ink">
            {t("setup_services.step1_title")}
          </h2>
          {/*
             The count is the number of sheets actually authored. The board
             writes "Seven trades are authored so far" as a constant and this
             tree holds fewer — `CLAUDE.md`: if a sentence states a count, count
             the elements.
          */}
          <p className="mt-1.5 max-w-prose text-body-sm text-body">
            {t("setup_services.step1_body", {
              count: sheets.length,
              formatted: formatCount(sheets.length),
            })}
          </p>
        </div>

        <ul className="grid list-none gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sheets.map((sheet) => (
            <li key={sheet.id}>
              <SheetCard sheet={sheet} busy={pending} onChoose={onChoose} />
            </li>
          ))}
        </ul>

        <p className="max-w-prose text-caption text-muted">
          {matched === 0
            ? t("setup_services.match_none")
            : t("setup_services.match_note", {
                count: matched,
                formatted: formatCount(matched),
              })}
        </p>

        {!locked && (
          <p className="max-w-prose text-caption text-muted">
            {t("setup_services.sheet_kept")}
          </p>
        )}
      </section>

      {/* ── Step 2 ─────────────────────────────────────────────────────── */}
      <section aria-labelledby={`${ids}-step2`} className="flex flex-col gap-3.5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id={`${ids}-step2`} className="text-h3 font-medium text-ink">
              {t("setup_services.step2_title", { formatted: formatCount(target) })}
            </h2>
            <p className="mt-1.5 max-w-prose text-body-sm text-body">
              {t("setup_services.step2_body", { formatted: formatCount(target) })}
            </p>
          </div>

          {/*
             B8. Names only, as drafts — `3g-s` B6 and `3h-s` both refuse to
             template scope and exclusions, and an engagement type would be the
             same mistake one field over.
          */}
          {!locked && seedTrade && seedCount > 0 && (
            <Button variant="secondary" size="sm" onClick={onSeed} disabled={pending || atCap}>
              {t("setup_services.seed_list", { trade: seedTrade })}
            </Button>
          )}
        </div>

        {locked ? (
          /*
             Inert, and it says why rather than simply looking dead — B1, AC1.
             The server refuses too; this is the explanation, not the gate.
          */
          <p className="rounded-card border border-dashed border-line bg-paper-sunk px-5 py-4 text-body-sm text-muted">
            {t("setup_services.step2_locked")}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-card border border-line-strong bg-card">
              <table className="w-full border-collapse text-body-sm">
                {/*
                   Its own words, not the heading's. A caption repeating the h2
                   directly above it is a screen reader reading the same
                   sentence twice — the correction `1g-s` already carries.
                */}
                <caption className="sr-only">{t("setup_services.table_caption")}</caption>
                <thead>
                  <tr className="border-b border-line">
                    <Th>{t("setup_services.col_service")}</Th>
                    <Th>{t("setup_services.col_engagement")}</Th>
                    <Th>{t("setup_services.col_turnaround")}</Th>
                    <Th>{t("setup_services.col_fee_basis")}</Th>
                    <Th align="end">{t("setup_services.col_required")}</Th>
                    <Th align="end">{t("setup_services.col_actions")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-5 text-center text-caption text-muted">
                        {t("setup_services.empty")}
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <ServiceRow
                      key={row.id}
                      row={row}
                      feeBases={feeBases}
                      engagementTypes={engagementTypes}
                      busy={pending}
                      onCell={onCell}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {!atCap && (
              <form action={onAdd} className="flex flex-wrap items-center gap-2.5">
                <span className="min-w-0 flex-1">
                  <Input
                    id={newRowId}
                    name="name"
                    aria-label={t("setup_services.add_row")}
                    placeholder={t("setup_services.new_row")}
                  />
                </span>
                <Button type="submit" variant="secondary" size="md" disabled={pending}>
                  {pending ? t("setup_services.adding") : t("setup_services.add_row")}
                </Button>
              </form>
            )}
          </>
        )}

        {note && (
          <Alert tone="ok" live="polite">
            {note}
          </Alert>
        )}
        {failure && (
          <Alert tone="bad" live="assertive" fix={failure.fix}>
            {failure.error}
          </Alert>
        )}
      </section>
    </div>
  );
}

/* ── One sheet ───────────────────────────────────────────────────────────── */

function SheetCard({
  sheet,
  busy,
  onChoose,
}: {
  sheet: SheetCardView;
  busy: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "flex h-full flex-col gap-2 rounded-card border px-4 py-3.5",
        sheet.chosen ? "border-moss bg-moss-wash" : "border-line-strong bg-card",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-body-sm font-medium text-ink">{sheet.name}</p>
        {/*
           Rank, not a colour: the strongest match wears the moss eyebrow the
           rest of this product uses for "we checked this", and the second wears
           the neutral tag. Two identical badges would say the order is
           arbitrary, which is the one thing the ranking exists to deny.
        */}
        {sheet.matchRank === 0 && (
          <span className="font-mono text-eyebrow uppercase text-moss">
            {t("setup_services.match_first")}
          </span>
        )}
        {sheet.matchRank === 1 && <Tag size="sm">{t("setup_services.match_second")}</Tag>}
      </div>

      {/*
         Counted off the family's own rows. Zero firms renders as zero — a
         directory at its cold start owes a seller the truth about how thin it
         is, and hiding the clause would be padding with a layout reason.
      */}
      <p className="font-mono text-eyebrow tabular-nums text-muted">
        {sheet.isDefault
          ? t("setup_services.sheet_blank_body")
          : t("setup_services.sheet_shape", {
              rows: formatCount(sheet.rows),
              required: formatCount(sheet.required),
              filterable: formatCount(sheet.filterable),
            })}
      </p>
      <p className="font-mono text-eyebrow tabular-nums text-faint">
        {sheet.usedBy === 0
          ? t("setup_services.sheet_used_none")
          : t("setup_services.sheet_used", {
              count: sheet.usedBy,
              formatted: formatCount(sheet.usedBy),
            })}
      </p>

      <div className="mt-auto pt-2">
        {sheet.chosen ? (
          <span className="font-mono text-eyebrow uppercase text-moss">
            {t("setup_services.chosen")}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => onChoose(sheet.id)}
          >
            {sheet.isDefault ? t("setup_services.sheet_blank") : t("setup_services.choose")}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ── One service ─────────────────────────────────────────────────────────── */

function ServiceRow({
  row,
  feeBases,
  engagementTypes,
  busy,
  onCell,
}: {
  row: ServiceRowView;
  feeBases: readonly { value: string; label: string }[];
  engagementTypes: readonly { value: string; label: string }[];
  busy: boolean;
  onCell: (id: string, field: string, value: string, before: string | null) => void;
}) {
  return (
    <tr className="border-b border-line last:border-b-0">
      <td className="px-3 py-2 align-middle">
        <div className="flex items-center gap-2">
          <Input
            size="sm"
            defaultValue={row.name}
            aria-label={FIELD_LABEL.name}
            disabled={busy}
            onBlur={(event) => onCell(row.id, "name", event.target.value, row.name)}
          />
          {!row.live && <Tag>{t("setup_services.draft")}</Tag>}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <Select
          size="sm"
          defaultValue={row.engagementType ?? ""}
          aria-label={FIELD_LABEL.engagementType}
          options={engagementTypes}
          placeholder={t("setup_services.unset")}
          disabled={busy}
          onChange={(event) =>
            onCell(row.id, "engagementType", event.target.value, row.engagementType)
          }
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <Input
          size="sm"
          defaultValue={row.turnaround ?? ""}
          aria-label={FIELD_LABEL.turnaround}
          disabled={busy}
          onBlur={(event) => onCell(row.id, "turnaround", event.target.value, row.turnaround)}
        />
      </td>
      <td className="px-3 py-2 align-middle">
        {/*
           The family's own list — `3g-s` B2. A key from another family is
           refused by the server for the reason the label would not exist here.
        */}
        <Select
          size="sm"
          defaultValue={row.feeBasis ?? ""}
          aria-label={FIELD_LABEL.feeBasis}
          options={feeBases}
          placeholder={t("setup_services.no_fee_basis")}
          disabled={busy}
          onChange={(event) => onCell(row.id, "feeBasis", event.target.value, row.feeBasis)}
        />
      </td>
      {/*
         Live and counting are two things. A thin row shows its score in the
         tone that says it is not paying, and the callout beside the table names
         the fields — a score with no instruction is a nag.
      */}
      <td
        className={cn(
          "px-3 py-2 text-end font-mono text-caption tabular-nums align-middle",
          row.live && !row.counts ? "text-warn-ink" : "text-muted",
        )}
      >
        {/* The same key `3f-s`'s completeness column renders, so the two
            screens cannot start saying "4 of 6" and "4/6". */}
        {t("services.sheet", {
          filled: formatCount(row.filled),
          total: formatCount(row.total),
        })}
      </td>
      <td className="px-3 py-2 text-end align-middle">
        <Link
          href={row.href}
          className="text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {t("setup_services.open_editor", { name: row.name })}
        </Link>
      </td>
    </tr>
  );
}

function Th({ children, align = "start" }: { children: React.ReactNode; align?: "start" | "end" }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2 font-mono text-eyebrow uppercase text-faint",
        align === "end" ? "text-end" : "text-start",
      )}
    >
      {children}
    </th>
  );
}
