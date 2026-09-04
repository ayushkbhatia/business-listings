"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Input, Label, Select } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import type { RamadanHours, WeekHours } from "@/lib/trade/hours";
import { BRANCH_TYPES } from "@/lib/onboarding/branch-fields";
import type { AreaOption, BranchField, BranchState } from "@/lib/onboarding/locations";
import { BranchHours } from "./BranchHours";
import type { countBranchesWithHours, saveBranchField, saveHours } from "./actions";

/**
 * One branch: where it is, how to reach it, and when it is open.
 *
 * Autosave on 800ms idle per field, patching the field that changed — the same
 * contract board 2c set and for the same reason. Posting the whole card on every
 * idle is what turns two open tabs into one of them quietly writing its
 * ten-minute-old copy of the address over the other's work.
 *
 * The hours are a separate save. `BranchHours` produces a whole week at once — a
 * day toggled off is four fields changing together — so idling per field would
 * send four requests describing one edit, three of them describing a week that
 * never existed.
 */

const IDLE_MS = 800;

export interface BranchCardProps {
  branch: BranchState;
  /** 1-based, for `Branch 2 — Workshop`. Position on the page, not an id. */
  index: number;
  areas: readonly AreaOption[];
  selected: boolean;
  canRemove: boolean;
  ramadanWindow: { from: string; to: string; active: boolean } | null;
  onSelect: () => void;
  onPatched: (branchId: string, change: Partial<BranchState>) => void;
  onRemove: () => void;
  onNotice: (message: string | null) => void;
  actions: {
    saveField: typeof saveBranchField;
    saveHours: typeof saveHours;
    countHours: typeof countBranchesWithHours;
  };
}

export function BranchCard(props: BranchCardProps) {
  const { branch } = props;

  const [street, setStreet] = useState(branch.addressLine);
  const [landline, setLandline] = useState(branch.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(branch.whatsapp ?? "");
  const [errors, setErrors] = useState<Partial<Record<BranchField, string>>>({});

  const [hours, setHours] = useState<WeekHours>(branch.hours);
  const [ramadan, setRamadan] = useState<RamadanHours | null>(branch.ramadanHours);
  const [confirmCopy, setConfirmCopy] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  /*
     The emirate the Area list is filtered to.

     A control on this screen and not a column on the row: the stored emirate is
     derived from the chosen area on the server, so the two cannot disagree.
     Board 3c learned that the hard way — two independent fields that must agree
     are two fields that eventually will not, and the failure mode there was a
     supplier's address changing when they edited their phone number.
  */
  const [emirate, setEmirate] = useState<string>(branch.emirate);

  const areasIn = useMemo(
    () => props.areas.filter((area) => area.emirate === emirate),
    [props.areas, emirate],
  );

  const timers = useRef<Partial<Record<BranchField, ReturnType<typeof setTimeout>>>>({});

  const save = useCallback(
    (field: BranchField, value: string) => {
      const form = new FormData();
      form.set("branchId", branch.id);
      form.set("field", field);
      form.set("value", value);

      void props.actions.saveField(form).then((result) => {
        if (result.ok) {
          setErrors((current) => ({ ...current, [field]: undefined }));
          props.onPatched(branch.id, {
            ...fieldChange(field, value),
            ...(result.emirate ? { emirate: result.emirate } : {}),
          });
          return;
        }
        setErrors((current) => ({ ...current, [field]: problemText(result.problem) }));
      });
    },
    [branch.id, props],
  );

  /*
     Idle, not throttled. The timer restarts on every keystroke, so a seller
     typing an address sends one request at the end of it. Per field, so an
     address still being written does not cancel the save of a landline finished
     ten seconds ago.
  */
  const scheduleSave = useCallback(
    (field: BranchField, value: string) => {
      clearTimeout(timers.current[field]);
      timers.current[field] = setTimeout(() => save(field, value), IDLE_MS);
    },
    [save],
  );

  // A tab closed mid-address still has a pending timer. Clearing them on unmount
  // stops a save firing against a page that has gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  /* ── Hours ─────────────────────────────────────────────────────────────── */

  const commitHours = useCallback(
    (week: WeekHours, block: RamadanHours | null, scope: "one" | "all") => {
      const form = new FormData();
      form.set("branchId", branch.id);
      form.set("hours", JSON.stringify(week));
      form.set("ramadanHours", block ? JSON.stringify(block) : "");
      if (scope === "all") form.set("scope", "all");

      void props.actions.saveHours(form).then((result) => {
        if (!result.ok) {
          props.onNotice(result.problem);
          return;
        }
        props.onPatched(branch.id, { hours: week, ramadanHours: block });
        if (scope === "all") {
          props.onNotice(t("locations_step.copied", { count: String(result.applied) }));
        }
      });
    },
    [branch.id, props],
  );

  /*
     Criterion 17. The confirm names how many branches would lose their hours
     rather than asking a generic "are you sure": a seller who has set nothing
     elsewhere should not be stopped at all, and one who has set three should be
     told it is three. This control sits one click from the row they were
     editing, so the cost of getting it wrong is somebody else's Tuesday.
  */
  const askCopyAll = () => {
    const form = new FormData();
    form.set("branchId", branch.id);
    void props.actions.countHours(form).then((count) => {
      if (count === 0) {
        commitHours(hours, ramadan, "all");
        return;
      }
      setConfirmCopy(count);
    });
  };

  const headingId = useId();
  const gaps = branch.gaps;

  return (
    <section
      aria-labelledby={headingId}
      onFocusCapture={props.selected ? undefined : props.onSelect}
      className={cn(
        "overflow-hidden rounded-card border bg-card transition-colors duration-120 ease-out",
        props.selected ? "border-line-strong" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-fill px-4 py-3">
        <h2 id={headingId} className="text-body-sm font-medium text-ink">
          {t("locations_step.branch", {
            n: String(props.index),
            type: t(`locations.type.${branch.type}` as never),
          })}
        </h2>

        <div className="ms-auto flex items-center gap-3">
          {!props.selected && (
            <Button size="sm" variant="ghost" onClick={props.onSelect}>
              {t("locations_step.select_branch")}
            </Button>
          )}
          {props.canRemove && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
              {t("locations_step.remove")}
            </Button>
          )}

          {/*
            Criterion 3: the tag is state, not decoration. A mono eyebrow, which
            is one of the two places §08 allows uppercase — and the word carries
            the state, so it is readable without the colour.
          */}
          <span
            className={cn(
              "font-mono text-eyebrow uppercase tracking-wide",
              branch.pinned ? "text-ok-ink" : "text-warn-ink",
            )}
          >
            {branch.pinned ? t("locations_step.pinned") : t("locations_step.not_pinned")}
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        {/*
          The confirm, inline and worded. §05 asks that a destructive action's
          confirm button repeat the verb rather than say "OK" — which is the one
          thing `window.confirm` cannot be made to do, and the reason it is not
          used here.
        */}
        {confirmRemove && (
          <div
            role="alertdialog"
            aria-label={t("locations_step.confirm_remove")}
            className="flex flex-wrap items-center gap-3 rounded-card border border-bad-line bg-bad-wash px-3 py-2"
          >
            <p className="text-caption text-bad-ink">{t("locations_step.confirm_remove")}</p>
            <div className="ms-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmRemove(false)}>
                {t("locations_step.keep_branch")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmRemove(false);
                  props.onRemove();
                }}
              >
                {t("locations_step.remove")}
              </Button>
            </div>
          </div>
        )}

        {!branch.pinned && (
          <p className="text-caption text-warn-ink">{t("locations_step.not_pinned_help")}</p>
        )}

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {/*
            Criterion 6: the emirate drives the area list, and the area is a
            select over the `Area` table with no code path that takes free text.
            Every area page on board 6a is generated from this join, so a typed
            area is a listing that appears on no area page at all.
          */}
          <Field label={t("locations_step.emirate")}>
            {(id) => (
              <Select
                id={id}
                value={emirate}
                options={EMIRATES.map((row) => ({ value: row.value, label: row.label }))}
                onChange={(event) => {
                  const next = event.target.value;
                  setEmirate(next);
                  /*
                     Moving emirate moves the branch to the first area in it, and
                     saves. Leaving the area pointing at another emirate would be
                     the disagreement this control exists to prevent — and the
                     seller is one select away from the right one.
                  */
                  const first = props.areas.find((area) => area.emirate === next);
                  if (first && first.id !== branch.areaId) save("areaId", first.id);
                }}
              />
            )}
          </Field>

          <Field label={t("locations_step.area")} error={errors.areaId}>
            {(id) => (
              <Select
                id={id}
                value={branch.areaId}
                invalid={Boolean(errors.areaId) || gaps.includes("area")}
                placeholder={t("locations.area_placeholder")}
                options={areasIn.map((area) => ({
                  value: area.id,
                  label: area.isFreeZone
                    ? `${area.name} · ${t("locations.free_zone_tag")}`
                    : area.name,
                }))}
                onChange={(event) => save("areaId", event.target.value)}
              />
            )}
          </Field>
        </div>

        {/* Free text by design — UAE addressing is not structured, and a schema
            imposed on it would refuse the way most of Al Quoz is described. */}
        <Field
          label={t("locations_step.street")}
          hint={t("locations_step.street_hint")}
          error={errors.addressLine}
        >
          {(id) => (
            <Input
              id={id}
              value={street}
              invalid={Boolean(errors.addressLine) || gaps.includes("address")}
              onChange={(event) => {
                setStreet(event.target.value);
                scheduleSave("addressLine", event.target.value);
              }}
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
          <Field label={t("locations_step.landline")} error={errors.phone}>
            {(id) => (
              <Input
                id={id}
                type="tel"
                inputMode="tel"
                value={landline}
                invalid={Boolean(errors.phone) || gaps.includes("contact")}
                onChange={(event) => {
                  setLandline(event.target.value);
                  scheduleSave("phone", event.target.value);
                }}
              />
            )}
          </Field>

          <Field label={t("locations_step.whatsapp")} error={errors.whatsapp}>
            {(id) => (
              <Input
                id={id}
                type="tel"
                inputMode="tel"
                value={whatsapp}
                invalid={Boolean(errors.whatsapp) || gaps.includes("contact")}
                onChange={(event) => {
                  setWhatsapp(event.target.value);
                  scheduleSave("whatsapp", event.target.value);
                }}
              />
            )}
          </Field>

          {/*
            Not cosmetic. Board 1f groups branches by this, and a buyer looking
            for a workshop does not want the trade counter's address.
          */}
          <Field label={t("locations_step.branch_type")} error={errors.type}>
            {(id) => (
              <Select
                id={id}
                value={branch.type}
                invalid={Boolean(errors.type)}
                options={BRANCH_TYPES.map((type) => ({
                  value: type,
                  label: t(`locations.type.${type}` as never),
                }))}
                onChange={(event) => save("type", event.target.value)}
              />
            )}
          </Field>
        </div>

        {confirmCopy !== null && (
          <div
            role="alertdialog"
            aria-label={t("locations_step.copy_all")}
            className="flex flex-wrap items-center gap-3 rounded-card border border-warn-line bg-warn-wash px-3 py-2"
          >
            <p className="text-caption text-warn-ink">
              {confirmCopy === 1
                ? t("locations_step.copy_all_confirm_one")
                : t("locations_step.copy_all_confirm", { count: String(confirmCopy) })}
            </p>
            <div className="ms-auto flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setConfirmCopy(null)}>
                {t("locations_step.copy_all_cancel")}
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setConfirmCopy(null);
                  commitHours(hours, ramadan, "all");
                }}
              >
                {t("locations_step.copy_all_go")}
              </Button>
            </div>
          </div>
        )}

        <BranchHours
          hours={hours}
          ramadanHours={ramadan}
          ramadanWindow={props.ramadanWindow}
          onChange={(week) => {
            setHours(week);
            commitHours(week, ramadan, "one");
          }}
          onRamadanChange={(block) => {
            setRamadan(block);
            commitHours(hours, block, "one");
          }}
          {...(props.canRemove ? { onCopyToAll: askCopyAll } : {})}
        />
      </div>
    </section>
  );
}

/** A label, a control and the one line that says what is wrong with it. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} {...(hint ? { hint } : {})}>
        {label}
      </Label>
      {children(id)}
      {error && (
        <p role="alert" className="text-caption text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

/** What the optimistic copy of the branch should say after a save landed. */
function fieldChange(field: BranchField, value: string): Partial<BranchState> {
  switch (field) {
    case "areaId":
      return { areaId: value };
    case "type":
      return { type: value as BranchState["type"] };
    case "addressLine":
      return { addressLine: value };
    case "phone":
      return { phone: value.trim() || null };
    case "whatsapp":
      return { whatsapp: value.trim() || null };
  }
}

function problemText(problem: {
  kind: string;
  field?: "phone" | "whatsapp";
  problem?: string;
}): string {
  if (problem.kind === "phone") {
    if (problem.problem === "not_a_landline") return t("locations_step.error.landline");
    if (problem.problem === "not_a_mobile") return t("locations_step.error.whatsapp");
    return t("locations_step.error.number");
  }
  if (problem.kind === "address_required") return t("locations_step.error.address");
  if (problem.kind === "unknown_area") return t("locations_step.error.area");
  if (problem.kind === "unknown_type") return t("locations_step.error.type");
  return t("locations_step.error.save_failed");
}
