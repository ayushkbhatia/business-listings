"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Tag } from "@/components/display";
import { Button, Input, Select } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ScopeResult } from "./scope-actions";

/**
 * Board `4e-s` — the five families, and what each one is allowed to vary.
 *
 * ## Every control carries a reason
 *
 * `CLAUDE.md` non-negotiable 3: every staff state change writes an audit row
 * with a written reason. The field is beside the control rather than behind a
 * dialog, because a reason asked for after the decision is a reason nobody
 * writes — and `staffMutation` refuses a blank one, so a form without the field
 * would fail at the server with nothing on screen to fix.
 *
 * ## The six are shown, not offered
 *
 * B4: a family cannot add to or remove from the required six. They render as a
 * list with no control at all, which is the honest way to say "platform-level"
 * — an admin who cannot see them wonders whether they are missing.
 */

export interface FeeBasisView {
  key: string;
  label: string;
  usedBy: number;
}

export interface RowView {
  key: string;
  label: string;
  filterable: boolean;
}

export interface FamilyView {
  id: string;
  name: string;
  isDefault: boolean;
  retired: boolean;
  credentialLabel: string | null;
  feeBases: FeeBasisView[];
  rows: RowView[];
  common: string[];
  subcategories: number;
  publishedServices: number;
  templates: number;
}

export interface UnassignedView {
  id: string;
  name: string;
  parent: string | null;
}

export interface ScopeFamiliesProps {
  families: readonly FamilyView[];
  unassigned: readonly UnassignedView[];
  requiredFields: readonly { key: string; label: string }[];
  assign: (formData: FormData) => Promise<ScopeResult>;
  retire: (formData: FormData) => Promise<ScopeResult>;
  addBasis: (formData: FormData) => Promise<ScopeResult>;
  removeBasis: (formData: FormData) => Promise<ScopeResult>;
  saveOrder: (formData: FormData) => Promise<ScopeResult>;
}

interface Failure {
  error: string;
  fix: string;
}

export function ScopeFamilies({
  families,
  unassigned,
  requiredFields,
  assign,
  retire,
  addBasis,
  removeBasis,
  saveOrder,
}: ScopeFamiliesProps) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(families[0]?.id ?? null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(call: (form: FormData) => Promise<ScopeResult>, form: FormData): void {
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const done = await call(form);
      if (!done.ok) {
        setFailure(done);
        return;
      }
      setNote(done.note ?? null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
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

      {/* ── The six, shown as fixed ─────────────────────────────────────── */}
      <section
        aria-labelledby="scope-fixed"
        className="rounded-card border border-line bg-paper-sunk px-5 py-4"
      >
        <h2 id="scope-fixed" className="text-body-sm font-medium text-ink">
          {t("admin.scope.fixed_title")}
        </h2>
        <ul className="mt-2.5 flex list-none flex-wrap gap-1.5">
          {requiredFields.map((field) => (
            <li key={field.key}>
              <Tag size="sm">{field.label}</Tag>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 max-w-prose text-caption text-muted">
          {t("admin.scope.fixed_note")}
        </p>
      </section>

      {/* ── The families ────────────────────────────────────────────────── */}
      <ul className="flex list-none flex-col gap-2.5">
        {families.map((family) => (
          <li key={family.id}>
            <FamilyCard
              family={family}
              expanded={open === family.id}
              onToggle={() => setOpen(open === family.id ? null : family.id)}
              busy={pending}
              run={run}
              retire={retire}
              addBasis={addBasis}
              removeBasis={removeBasis}
              saveOrder={saveOrder}
            />
          </li>
        ))}
      </ul>

      {/* ── What has no family yet ──────────────────────────────────────── */}
      <section aria-labelledby="scope-unassigned" className="rounded-card border border-line bg-card px-5 py-4">
        <h2 id="scope-unassigned" className="text-body-sm font-medium text-ink">
          {t("admin.scope.unassigned_title")}
        </h2>
        {unassigned.length === 0 ? (
          <p className="mt-2 text-caption text-muted">{t("admin.scope.unassigned_none")}</p>
        ) : (
          <>
            <p className="mt-2 max-w-prose text-caption text-muted">
              {t("admin.scope.unassigned_note")}
            </p>
            <ul className="mt-3 flex list-none flex-col gap-2.5">
              {unassigned.map((row) => (
                <li key={row.id}>
                  <AssignRow
                    row={row}
                    families={families}
                    busy={pending}
                    onSubmit={(form) => run(assign, form)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/* ── One family ──────────────────────────────────────────────────────────── */

function FamilyCard({
  family,
  expanded,
  onToggle,
  busy,
  run,
  retire,
  addBasis,
  removeBasis,
  saveOrder,
}: {
  family: FamilyView;
  expanded: boolean;
  onToggle: () => void;
  busy: boolean;
  run: (call: (form: FormData) => Promise<ScopeResult>, form: FormData) => void;
  retire: (formData: FormData) => Promise<ScopeResult>;
  addBasis: (formData: FormData) => Promise<ScopeResult>;
  removeBasis: (formData: FormData) => Promise<ScopeResult>;
  saveOrder: (formData: FormData) => Promise<ScopeResult>;
}) {
  const [order, setOrder] = useState(family.rows.map((row) => row.key));

  const move = (index: number, by: number) => {
    const next = [...order];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  };

  const label = (key: string) => family.rows.find((row) => row.key === key)?.label ?? key;
  const moved = order.join(",") !== family.rows.map((row) => row.key).join(",");

  return (
    <div
      className={cn(
        "rounded-card border bg-card px-5 py-4",
        family.retired ? "border-line" : "border-line-strong",
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
        >
          {family.name}
        </button>
        {family.isDefault && <Tag size="sm">{t("admin.scope.fallback")}</Tag>}
        {family.retired && <Tag size="sm">{t("admin.scope.retired")}</Tag>}
        <span className="ms-auto font-mono text-eyebrow tabular-nums text-muted">
          {[
            t("admin.scope.used_subcats", {
              count: family.subcategories,
              formatted: formatCount(family.subcategories),
            }),
            t("admin.scope.used_live", {
              count: family.publishedServices,
              formatted: formatCount(family.publishedServices),
            }),
            t("admin.scope.used_templates", {
              count: family.templates,
              formatted: formatCount(family.templates),
            }),
          ].join(" · ")}
        </span>
      </div>

      {family.isDefault && (
        <p className="mt-2 max-w-prose text-caption text-muted">
          {t("admin.scope.fallback_note")}
        </p>
      )}

      {expanded && (
        <div className="mt-4 flex flex-col gap-5">
          {/* ── Fee bases ───────────────────────────────────────────── */}
          <section>
            <h3 className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.scope.fee_bases")}
            </h3>
            <p className="mt-1.5 max-w-prose text-caption text-muted">
              {t("admin.scope.fee_bases_note")}
            </p>
            <ul className="mt-2.5 flex list-none flex-col gap-2">
              {family.feeBases.map((basis) => (
                <li key={basis.key} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-caption text-body">{basis.label}</span>
                  <span className="font-mono text-eyebrow tabular-nums text-faint">
                    {basis.usedBy === 0
                      ? t("admin.scope.fee_unused")
                      : t("admin.scope.fee_used", {
                          count: basis.usedBy,
                          formatted: formatCount(basis.usedBy),
                        })}
                  </span>
                  <ReasonedAction
                    label={t("admin.scope.fee_remove", { label: basis.label })}
                    warning={
                      basis.usedBy === 0
                        ? null
                        : t("admin.scope.fee_remove_warn", {
                            count: basis.usedBy,
                            formatted: formatCount(basis.usedBy),
                          })
                    }
                    busy={busy}
                    fields={{ familyId: family.id, key: basis.key }}
                    onSubmit={(form) => run(removeBasis, form)}
                  />
                </li>
              ))}
            </ul>

            <ReasonedForm
              submit={t("admin.scope.fee_add")}
              busy={busy}
              fields={{ familyId: family.id }}
              onSubmit={(form) => run(addBasis, form)}
            >
              <span className="flex flex-wrap gap-2.5">
                <Input name="key" size="sm" aria-label={t("admin.scope.fee_key")} placeholder={t("admin.scope.fee_key")} />
                <Input name="label" size="sm" aria-label={t("admin.scope.fee_label")} placeholder={t("admin.scope.fee_label")} />
              </span>
            </ReasonedForm>
          </section>

          {/* ── Row order ───────────────────────────────────────────── */}
          <section>
            <h3 className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.scope.rows")}
            </h3>
            {/*
               B7: the count travels with the control, before the save rather
               than after. A reorder that quietly reshapes two hundred
               buyer-facing tables is one an admin should be made to look at.
            */}
            <p className="mt-1.5 max-w-prose text-caption text-muted">
              {family.publishedServices === 0
                ? t("admin.scope.rows_none")
                : t("admin.scope.rows_note", {
                    count: family.publishedServices,
                    formatted: formatCount(family.publishedServices),
                  })}
            </p>
            <ol className="mt-2.5 flex list-none flex-col gap-1.5">
              {order.map((key, index) => (
                <li key={key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 text-caption text-body">{label(key)}</span>
                  {family.rows.find((row) => row.key === key)?.filterable && (
                    <Tag size="sm">{t("admin.scope.filterable")}</Tag>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    {t("admin.scope.row_up", { label: label(key) })}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy || index === order.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    {t("admin.scope.row_down", { label: label(key) })}
                  </Button>
                </li>
              ))}
            </ol>
            {moved && (
              <ReasonedForm
                submit={t("admin.scope.rows_save")}
                busy={busy}
                fields={{ familyId: family.id, order: order.join(",") }}
                onSubmit={(form) => run(saveOrder, form)}
              />
            )}
          </section>

          {/* ── The credential, prompted ────────────────────────────── */}
          <section>
            <h3 className="font-mono text-eyebrow uppercase text-faint">
              {t("admin.scope.credential")}
            </h3>
            <p className="mt-1.5 text-caption text-body">
              {family.credentialLabel ?? t("admin.scope.credential_none")}
            </p>
            <p className="mt-1.5 max-w-prose text-caption text-muted">
              {t("admin.scope.credential_note")}
            </p>
            {family.credentialLabel === null && !family.isDefault && (
              <p className="mt-1.5 max-w-prose text-caption text-muted">
                {t("admin.scope.credential_lookup")}
              </p>
            )}
          </section>

          {family.common.length > 0 && (
            <section>
              <h3 className="font-mono text-eyebrow uppercase text-faint">
                {t("admin.scope.common")}
              </h3>
              <p className="mt-1.5 text-caption text-body">{family.common.join(" · ")}</p>
            </section>
          )}

          {/* ── Retire ─────────────────────────────────────────────── */}
          {!family.isDefault ? (
            <section>
              <p className="max-w-prose text-caption text-muted">
                {t("admin.scope.retire_note")}
              </p>
              <ReasonedAction
                label={family.retired ? t("admin.scope.restore") : t("admin.scope.retire")}
                warning={null}
                busy={busy}
                fields={{ familyId: family.id, retired: family.retired ? "false" : "true" }}
                onSubmit={(form) => run(retire, form)}
              />
            </section>
          ) : (
            <p className="text-caption text-muted">{t("admin.scope.retire_fallback")}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── One unassigned subcategory ──────────────────────────────────────────── */

function AssignRow({
  row,
  families,
  busy,
  onSubmit,
}: {
  row: UnassignedView;
  families: readonly FamilyView[];
  busy: boolean;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-line bg-paper-sunk px-4 py-3">
      <p className="text-caption text-ink">
        {row.parent ? `${row.parent} › ${row.name}` : row.name}
      </p>
      <ReasonedForm
        submit={t("admin.scope.assign")}
        busy={busy}
        fields={{ categoryId: row.id }}
        onSubmit={onSubmit}
      >
        <Select
          name="familyId"
          size="sm"
          aria-label={t("admin.scope.assign_to", { name: row.name })}
          options={families
            .filter((family) => !family.isDefault && !family.retired)
            .map((family) => ({ value: family.id, label: family.name }))}
          placeholder={t("admin.scope.assign_to", { name: row.name })}
        />
      </ReasonedForm>
    </div>
  );
}

/* ── The reason, on everything ───────────────────────────────────────────── */

function ReasonedForm({
  submit,
  busy,
  fields,
  onSubmit,
  children,
}: {
  submit: string;
  busy: boolean;
  fields: Record<string, string>;
  onSubmit: (form: FormData) => void;
  children?: React.ReactNode;
}) {
  return (
    <form
      action={(form) => {
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        onSubmit(form);
      }}
      className="mt-2.5 flex flex-wrap items-center gap-2.5"
    >
      {children}
      <Input
        name="reason"
        size="sm"
        aria-label={t("admin.scope.reason")}
        placeholder={t("admin.scope.reason")}
      />
      <Button type="submit" size="sm" variant="secondary" disabled={busy}>
        {submit}
      </Button>
    </form>
  );
}

/**
 * A destructive control that states its blast radius before it is pressed.
 *
 * The warning is not a confirmation dialog: the count is what an admin needs,
 * and a dialog that repeats the label adds a click without adding a fact.
 */
function ReasonedAction({
  label,
  warning,
  busy,
  fields,
  onSubmit,
}: {
  label: string;
  warning: string | null;
  busy: boolean;
  fields: Record<string, string>;
  onSubmit: (form: FormData) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    <span className="flex w-full flex-col gap-1.5">
      {warning && <span className="text-caption text-warn-ink">{warning}</span>}
      <ReasonedForm submit={label} busy={busy} fields={fields} onSubmit={onSubmit} />
    </span>
  );
}
