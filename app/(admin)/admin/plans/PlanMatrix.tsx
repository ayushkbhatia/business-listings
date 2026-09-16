"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Checkbox, Input, Label, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatAED, formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  PLAN_FIELDS,
  type PlanEditableField,
  type PlanFieldGroup,
  type PlanFieldSpec,
} from "@/lib/plan/plan-fields";
import type { PlanChangeSet, PlanFieldValue } from "@/lib/billing/plan-diff";
import type { ActionResult, PreviewResult } from "./actions";

/**
 * Board 12e — the config table, as the board draws it.
 *
 * Entitlements down the side, plans across the top, every cell an input. The
 * shipped screen was the transpose of this: a row per plan and a separate form
 * behind an Edit button, which answered "what does Pro allow" and not "what do
 * the three plans allow, compared". The board's shape is the one an ops lead
 * reads — *"Entitlements per plan"* — and it is also the shape of the thing
 * `11f` renders to the seller, which is the screen this one writes for.
 *
 * ## The three controls that are not a number
 *
 * **Unlimited is a checkbox, never a word.** `B6`: the board's render put the
 * string `Unlimited` inside a bordered mono field that otherwise holds numbers.
 * A cap's box is disabled while its Unlimited box is ticked, and an untick
 * leaves the box empty and blocks the review until a number is in it — so an
 * empty cell can never quietly mean "no cap", which is how a storage cap was
 * lifted once by somebody saving an unrelated change.
 *
 * **Every switch posts both states.** A checkbox posts nothing when it is
 * unticked, so a form that read only what arrived would make each entitlement
 * a grant that could be given and never withdrawn.
 *
 * **Apply to existing is the third step, not a tick in the corner.** `B7`: it
 * is a bulk mutation over every live account on the plans that moved, and the
 * board offered it as one unticked box at the foot of a table where any cell
 * can be edited — no scope, no preview, no confirm. Here nothing is written
 * until a diff has been read back from the server and the button says how many
 * accounts it is about.
 */

export interface PlanColumn {
  id: string;
  name: string;
  /** Today's config, straight off the row. */
  values: Record<PlanEditableField, PlanFieldValue>;
  onSale: boolean;
  /** Formatted, because a Date is not the thing to send across this boundary. */
  withdrawnOn: string | null;
  subscriptions: number;
  grandfathered: number;
  /** `AED 8,990`, derived from the two price fields. Null where no year is sold. */
  annualPrice: string | null;
}

export interface PlanMatrixProps {
  plans: readonly PlanColumn[];
  canEdit: boolean;
  preview: (formData: FormData) => Promise<PreviewResult>;
  commit: (formData: FormData) => Promise<ActionResult>;
  /** The `+ Add plan` panel, rendered by the page so this file stays one job. */
  addPlan?: React.ReactNode;
}

const MIN_REASON = 4;

/**
 * A card that is not a landmark.
 *
 * `Panel` with a `title` renders `<section aria-labelledby>`, which is a
 * landmark — a region a screen-reader user navigates *between*. The gallery
 * renders this editor in three states, and three identically named regions is
 * an `landmark-unique` failure in both shards after a full build. The same
 * trade board `12c`'s publish strip already made: `group` names the thing
 * without claiming it is a destination.
 */
function GroupCard({
  label,
  title,
  description,
  actions,
  children,
}: {
  label: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="relative overflow-hidden rounded-panel border border-line bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-h2 text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="p-4">{children}</div>
    </div>
  );
}

const GROUPS: { group: PlanFieldGroup; labelKey: string }[] = [
  { group: "price", labelKey: "admin.plans.group.price" },
  { group: "caps", labelKey: "admin.plans.group.caps" },
  { group: "features", labelKey: "admin.plans.group.features" },
];

type CellState = { text: string; empty: boolean };
type Draft = {
  cells: Record<string, CellState>;
  sale: Record<string, boolean>;
  key: string;
};

function cellKey(planId: string, field: PlanEditableField): string {
  return `${planId}:${field}`;
}

function seedOf(plans: readonly PlanColumn[]): Draft {
  const cells: Record<string, CellState> = {};
  const sale: Record<string, boolean> = {};
  for (const plan of plans) {
    for (const spec of PLAN_FIELDS) {
      const value = plan.values[spec.field];
      cells[cellKey(plan.id, spec.field)] =
        spec.kind === "switch"
          ? { text: value === true ? "on" : "off", empty: false }
          : { text: value === null ? "" : String(value), empty: value === null };
    }
    sale[plan.id] = plan.onSale;
  }
  return { cells, sale, key: JSON.stringify({ cells, sale }) };
}

/** What the cell reads when its value is empty — "Unlimited", "Monthly only". */
function emptyLabel(spec: PlanFieldSpec): string {
  return spec.empty ? t(spec.empty.labelKey) : "";
}

function renderValue(spec: PlanFieldSpec, value: PlanFieldValue): string {
  if (spec.kind === "switch") return value === true ? t("admin.plans.on") : t("admin.plans.off");
  if (value === null) return emptyLabel(spec);
  if (spec.kind === "money") return formatAED(value as number);
  return formatCount(value as number);
}

export function PlanMatrix({ plans, canEdit, preview, commit, addPlan }: PlanMatrixProps) {
  const seed = useMemo(() => seedOf(plans), [plans]);
  const [draft, setDraft] = useState<Draft>(seed);
  const [seeded, setSeeded] = useState(seed.key);
  const [change, setChange] = useState<PlanChangeSet | null>(null);
  const [applyToExisting, setApply] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ActionResult | { ok: false; error: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const reasonId = useId();
  const tableId = useId();

  /*
     Re-seed when the server hands back new rows.

     A commit revalidates this route, so the props change underneath a draft
     that has already been written. Adjusting state during render is the
     documented way to do that; a `useEffect` would paint the old numbers first.
  */
  if (seeded !== seed.key) {
    setSeeded(seed.key);
    setDraft(seed);
    setChange(null);
  }

  function setCell(planId: string, field: PlanEditableField, next: Partial<CellState>) {
    const key = cellKey(planId, field);
    setDraft((current) => ({
      ...current,
      cells: { ...current.cells, [key]: { ...current.cells[key]!, ...next } },
    }));
    setChange(null);
  }

  function formOf(): FormData {
    const form = new FormData();
    for (const plan of plans) {
      for (const spec of PLAN_FIELDS) {
        const cell = draft.cells[cellKey(plan.id, spec.field)]!;
        form.set(
          `cell:${plan.id}:${spec.field}`,
          spec.kind === "switch" ? cell.text : cell.empty ? "" : cell.text.trim(),
        );
      }
      form.set(`sale:${plan.id}`, draft.sale[plan.id] ? "on" : "off");
    }
    return form;
  }

  /*
     A cap whose Unlimited box is unticked and whose box is empty.

     Not an error to be reported after a save — the review button simply does
     not arm, and the cell says what it wants. An empty box that meant unlimited
     is the shape of the defect that lifted a storage cap on an unrelated save,
     and this is where it is closed.
  */
  const blanks = useMemo(() => {
    const found: string[] = [];
    for (const plan of plans) {
      for (const spec of PLAN_FIELDS) {
        if (spec.kind === "switch") continue;
        const cell = draft.cells[cellKey(plan.id, spec.field)]!;
        if (!cell.empty && cell.text.trim() === "") found.push(`${plan.name} · ${t(spec.labelKey)}`);
      }
    }
    return found;
  }, [draft, plans]);

  /*
     Dirty, computed rather than flagged.

     The draft's own key is written once when it is seeded, so comparing the two
     keys would compare a value to itself. Comparing the posted shape of both is
     the same comparison the server makes, which is what keeps the button's
     "nothing to review" and the service's `nothing_changed` from disagreeing.
  */
  const moved = useMemo(() => {
    for (const plan of plans) {
      if ((draft.sale[plan.id] ?? false) !== (seed.sale[plan.id] ?? false)) return true;
      for (const spec of PLAN_FIELDS) {
        const key = cellKey(plan.id, spec.field);
        const now = draft.cells[key]!;
        const was = seed.cells[key]!;
        if (now.empty !== was.empty) return true;
        if (!now.empty && now.text.trim() !== was.text.trim()) return true;
      }
    }
    return false;
  }, [draft, seed, plans]);

  function runPreview() {
    startTransition(async () => {
      const outcome = await preview(formOf());
      if (outcome.ok) {
        setChange(outcome.change);
        setApply(false);
        setReason("");
        setResult(null);
      } else {
        setChange(null);
        setResult({ ok: false, error: outcome.error });
      }
    });
  }

  function runCommit() {
    if (!change) return;
    const form = formOf();
    form.set("reason", reason);
    form.set("expect", change.fingerprint);
    if (applyToExisting) form.set("applyToExisting", "on");

    startTransition(async () => {
      const outcome = await commit(form);
      setResult(outcome);
      if (outcome.ok) {
        setChange(null);
        setReason("");
        setApply(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-[var(--gutter)]">
      {result && (
        <Alert tone={result.ok ? "ok" : "bad"} live="assertive">
          {result.ok ? result.message : result.error}
        </Alert>
      )}

      <GroupCard
        label={t("admin.plans.matrix.title")}
        title={t("admin.plans.matrix.title")}
        description={t("admin.plans.matrix.warning")}
        {...(addPlan ? { actions: addPlan } : {})}
      >
        <div className="overflow-x-auto">
          <table id={tableId} className="w-full border-collapse text-left">
            <caption className="sr-only">{t("admin.plans.caption")}</caption>
            <thead>
              <tr className="bg-paper-sunk">
                <th
                  scope="col"
                  className="w-56 px-3 py-2 font-mono text-colhead uppercase text-muted"
                >
                  {t("admin.plans.col.entitlement")}
                </th>
                {plans.map((plan) => (
                  <th
                    key={plan.id}
                    scope="col"
                    className="min-w-40 border-s border-line px-3 py-2 align-bottom"
                  >
                    <span className="block font-mono text-colhead uppercase text-ink">
                      {plan.name}
                    </span>
                    {!plan.onSale && (
                      <span className="mt-1 inline-block">
                        <StatusBadge tone="warn">
                          {plan.withdrawnOn
                            ? t("admin.plans.withdrawn_on", { when: plan.withdrawnOn })
                            : t("admin.plans.withdrawn_badge")}
                        </StatusBadge>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>

            {GROUPS.map(({ group, labelKey }) => (
              <tbody key={group}>
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={plans.length + 1}
                    className="border-t border-line bg-fill px-3 py-1.5 text-left font-mono text-eyebrow uppercase text-muted"
                  >
                    {t(labelKey as never)}
                  </th>
                </tr>
                {PLAN_FIELDS.filter((spec) => spec.group === group).map((spec) => (
                  <tr key={spec.field}>
                    <th
                      scope="row"
                      className="border-t border-line px-3 py-2 align-middle text-caption font-normal text-body"
                    >
                      {t(spec.labelKey)}
                    </th>
                    {plans.map((plan) => (
                      <td
                        key={plan.id}
                        className="border-s border-t border-line px-3 py-2 align-middle"
                      >
                        {canEdit ? (
                          <Cell
                            spec={spec}
                            plan={plan}
                            state={draft.cells[cellKey(plan.id, spec.field)]!}
                            onChange={(next) => setCell(plan.id, spec.field, next)}
                          />
                        ) : (
                          <span className="font-mono text-body-sm tabular-nums text-ink">
                            {renderValue(spec, plan.values[spec.field])}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}

            <tbody>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={plans.length + 1}
                  className="border-t border-line bg-fill px-3 py-1.5 text-left font-mono text-eyebrow uppercase text-muted"
                >
                  {t("admin.plans.group.sale")}
                </th>
              </tr>
              {/*
                 On sale is a row on the matrix and not a cap.

                 It changes nothing for anybody already on the plan and must
                 never reach the entitlement snapshot — what it changes is
                 whether the plan can be bought. It rides the same review and
                 the same reason because it is the same decision to take.
              */}
              <tr>
                <th
                  scope="row"
                  className="border-t border-line px-3 py-2 align-middle text-caption font-normal text-body"
                >
                  {t("admin.plans.row.on_sale")}
                </th>
                {plans.map((plan) => (
                  <td key={plan.id} className="border-s border-t border-line px-3 py-2">
                    {canEdit ? (
                      <Checkbox
                        checked={draft.sale[plan.id] ?? false}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setDraft((current) => ({
                            ...current,
                            sale: { ...current.sale, [plan.id]: checked },
                          }));
                          setChange(null);
                        }}
                        aria-label={t("admin.plans.on_sale_cell", { plan: plan.name })}
                      />
                    ) : (
                      <span className="text-body-sm text-ink">
                        {plan.onSale ? t("admin.plans.on") : t("admin.plans.off")}
                      </span>
                    )}
                  </td>
                ))}
              </tr>

              {/*
                 Read-only, and the last band deliberately.

                 An annual price is arithmetic on two cells above it — the
                 config holds months charged, never a second price column — so
                 it is shown rather than typed. The two counts are the blast
                 radius of everything above them, which is what makes the tick
                 box below a decision rather than a label.
              */}
              <tr>
                <th
                  scope="row"
                  className="border-t border-line px-3 py-2 align-middle text-caption font-normal text-muted"
                >
                  {t("admin.plans.row.annual_price")}
                </th>
                {plans.map((plan) => (
                  <td
                    key={plan.id}
                    className="border-s border-t border-line px-3 py-2 font-mono text-caption tabular-nums text-muted"
                  >
                    {plan.annualPrice ?? t("admin.plans.monthly_only")}
                  </td>
                ))}
              </tr>
              <tr>
                <th
                  scope="row"
                  className="border-t border-line px-3 py-2 align-middle text-caption font-normal text-muted"
                >
                  {t("admin.plans.col.accounts")}
                </th>
                {plans.map((plan) => (
                  <td
                    key={plan.id}
                    className="border-s border-t border-line px-3 py-2 font-mono text-caption tabular-nums text-ink"
                  >
                    {formatCount(plan.subscriptions)}
                  </td>
                ))}
              </tr>
              <tr>
                <th
                  scope="row"
                  className="border-t border-line px-3 py-2 align-middle text-caption font-normal text-muted"
                >
                  {t("admin.plans.col.grandfathered")}
                </th>
                {plans.map((plan) => (
                  <td
                    key={plan.id}
                    className={cn(
                      "border-s border-t border-line px-3 py-2 font-mono text-caption tabular-nums",
                      plan.grandfathered > 0 ? "text-ink" : "text-muted",
                    )}
                  >
                    {formatCount(plan.grandfathered)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-4 rounded-panel border border-warn-line bg-warn-wash p-4">
            <p className="max-w-prose text-caption text-warn-ink">
              {t("admin.plans.grandfathering")}
            </p>
            {blanks.length > 0 && (
              <p className="mt-2 max-w-prose text-caption text-warn-ink">
                {t("admin.plans.blank_cells", { cells: blanks.join(", ") })}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                disabled={!moved || blanks.length > 0 || pending}
                onClick={runPreview}
              >
                {t("admin.plans.review")}
              </Button>
              {moved && (
                <Button variant="ghost" disabled={pending} onClick={() => { setDraft(seed); setChange(null); }}>
                  {t("admin.plans.discard")}
                </Button>
              )}
            </div>
          </div>
        )}
      </GroupCard>

      {change && <ChangeConfirm
        change={change}
        applyToExisting={applyToExisting}
        onApplyChange={setApply}
        reason={reason}
        onReasonChange={setReason}
        reasonId={reasonId}
        pending={pending}
        onCommit={runCommit}
        onCancel={() => setChange(null)}
      />}
    </div>
  );
}

/**
 * One editable cell.
 *
 * A switch is a checkbox because this section applies on save: §02's rule is
 * that a toggle applies immediately and a checkbox applies on a button, and
 * mixing the two conventions inside one panel is how somebody learns that half
 * of it saved itself.
 */
function Cell({
  spec,
  plan,
  state,
  onChange,
}: {
  spec: PlanFieldSpec;
  plan: PlanColumn;
  state: CellState;
  onChange: (next: Partial<CellState>) => void;
}) {
  const id = useId();

  if (spec.kind === "switch") {
    return (
      <Checkbox
        id={id}
        checked={state.text === "on"}
        onChange={(event) => onChange({ text: event.target.checked ? "on" : "off" })}
        aria-label={`${t(spec.labelKey)} · ${plan.name}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Input
        id={id}
        size="sm"
        mono
        inputMode="numeric"
        aria-label={`${t(spec.labelKey)} · ${plan.name}`}
        disabled={state.empty}
        value={state.empty ? emptyLabel(spec) : state.text}
        /*
           No unit on an empty cell, for two reasons.

           It reads wrong — "Monthly only · of 12" is a unit on a value that has
           none — and it fails the contrast floor: `Input` renders its suffix in
           a sibling span that a disabled control does not dim, so the adornment
           sat at 2.37:1 on the disabled fill while axe passed the box itself by
           exempting it for being disabled.
        */
        {...(spec.suffix && !state.empty ? { suffix: spec.suffix } : {})}
        onChange={(event) => onChange({ text: event.target.value })}
      />
      {spec.empty && (
        <Checkbox
          checked={state.empty}
          onChange={(event) => onChange({ empty: event.target.checked, text: "" })}
          label={t(spec.empty.hintKey)}
        />
      )}
    </div>
  );
}

/**
 * Step three. What this would do, then the button that does it.
 *
 * The count on the button is the whole of `B7`: *"the affected count labels the
 * button"*, the shape `12c` uses. Every figure here came back from the server
 * with the diff, so the number on the button and the number in the audit row
 * are the same query.
 */
function ChangeConfirm({
  change,
  applyToExisting,
  onApplyChange,
  reason,
  onReasonChange,
  reasonId,
  pending,
  onCommit,
  onCancel,
}: {
  change: PlanChangeSet;
  applyToExisting: boolean;
  onApplyChange: (next: boolean) => void;
  reason: string;
  onReasonChange: (next: string) => void;
  reasonId: string;
  pending: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ready = reason.trim().length >= MIN_REASON;

  return (
    <GroupCard
      label={t("admin.plans.confirm.title")}
      title={t("admin.plans.confirm.title")}
      description={t("admin.plans.confirm.body")}
    >
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{t("admin.plans.confirm.caption")}</caption>
        <thead>
          <tr className="bg-paper-sunk">
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.plans.col.plan")}
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.plans.col.entitlement")}
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.plans.confirm.from")}
            </th>
            <th scope="col" className="px-3 py-2 font-mono text-colhead uppercase text-muted">
              {t("admin.plans.confirm.to")}
            </th>
          </tr>
        </thead>
        <tbody>
          {change.changes.flatMap((plan) =>
            plan.fields.map((field) => {
              const spec = PLAN_FIELDS.find((one) => one.field === field.field) ?? null;
              const show = (value: PlanFieldValue) =>
                field.field === "onSale"
                  ? value === true
                    ? t("admin.plans.on")
                    : t("admin.plans.off")
                  : spec
                    ? renderValue(spec, value)
                    : String(value);
              return (
                <tr key={`${plan.planId}:${field.field}`}>
                  <th
                    scope="row"
                    className="border-t border-line px-3 py-2 text-left text-caption font-normal text-body"
                  >
                    {plan.planName}
                  </th>
                  <td className="border-t border-line px-3 py-2 text-caption text-body">
                    {t(field.labelKey as never)}
                  </td>
                  <td className="border-t border-line px-3 py-2 font-mono text-caption tabular-nums text-muted">
                    {show(field.before)}
                  </td>
                  <td className="border-t border-line px-3 py-2 font-mono text-caption tabular-nums text-ink">
                    {show(field.after)}
                    {field.reduction && (
                      <span className="ms-2">
                        <StatusBadge tone="warn">{t("admin.plans.confirm.reduction")}</StatusBadge>
                      </span>
                    )}
                  </td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>

      <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-4 text-caption text-body">
        <li>
          {change.accounts === 0
            ? t("admin.plans.confirm.accounts_none")
            : change.accounts === 1
              ? t("admin.plans.confirm.accounts_one")
              : t("admin.plans.confirm.accounts", { count: formatCount(change.accounts) })}
        </li>
        {change.repriced > 0 && (
          /*
             Its own line, and it is the one an ops lead most needs.

             A price is not in the entitlement snapshot and never has been, so
             grandfathering does not cover it: a price change reaches every live
             subscription on that plan at its next renewal whether or not
             anybody ticks the box below.
          */
          <li className="text-warn-ink">
            {change.repriced === 1
              ? t("admin.plans.confirm.repriced_one")
              : t("admin.plans.confirm.repriced", { count: formatCount(change.repriced) })}
          </li>
        )}
      </ul>

      {change.capsMoved > 0 && (
        <div className="mt-4 border-t border-line pt-4">
          <Checkbox
            checked={applyToExisting}
            onChange={(event) => onApplyChange(event.target.checked)}
            /*
               Three strings rather than one with a count in it. English
               pluralises the noun *and* the demonstrative here — one plan,
               these plans — and "the 1 accounts already on these plans" is the
               sentence a single count placeholder produces.
            */
            label={
              change.changes.length > 1
                ? t("admin.plans.apply_label", { count: formatCount(change.capsMoved) })
                : change.capsMoved === 1
                  ? t("admin.plans.apply_label_one_account")
                  : t("admin.plans.apply_label_one_plan", { count: formatCount(change.capsMoved) })
            }
            description={t("admin.plans.apply_hint")}
          />
        </div>
      )}

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
          onChange={(event) => onReasonChange(event.target.value)}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={!ready || pending} onClick={onCommit}>
          {applyToExisting && change.capsMoved > 0
            ? change.capsMoved === 1
              ? t("admin.plans.commit_apply_one")
              : t("admin.plans.commit_apply", { count: formatCount(change.capsMoved) })
            : change.changes.length === 1
              ? t("admin.plans.commit_one")
              : t("admin.plans.commit", { count: formatCount(change.changes.length) })}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onCancel}>
          {t("admin.plans.back")}
        </Button>
      </div>
    </GroupCard>
  );
}
