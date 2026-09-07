"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Alert } from "@/components/display";
import { Button, Input, Select } from "@/components/primitives";
import { Modal, Panel } from "@/components/structure";
import { HoursEditor } from "@/components/domain";
import { describeProblemText } from "@/lib/trade/hours-copy";
import { copyPreview } from "@/lib/hours/copy";
import { t } from "@/lib/i18n";
import type { Day, RamadanHours, WeekHours } from "@/lib/trade/hours";
import { HolidayRail, type HolidayRow } from "./HolidayRail";
import { RamadanCard } from "./RamadanCard";
import type { ClosureActionResult, HoursResult } from "./actions";

/**
 * Board 3d — hours, holidays and Ramadan.
 *
 * `3c` owns where a branch is; this owns when it is open. `Open now` is the
 * third most-used filter on the site, so every value on this screen is a claim
 * made to buyers on the seller's behalf — which is why the screen's real job is
 * saying **which claims we maintain and which they do**, and **which one wins
 * when two apply to the same day**.
 */

export interface WorkspaceBranch {
  id: string;
  name: string;
  hours: WeekHours;
  ramadanHours: RamadanHours | null;
  ramadanConfirmedYear: number | null;
  hidden: boolean;
  needsConfirming: boolean;
  closure: { from: string; until: string; reason: string } | null;
  holidays: HolidayRow[];
}

export interface HoursWorkspaceProps {
  branches: readonly WorkspaceBranch[];
  dayLabels: Record<Day, string>;
  holidayYears: string;
  ramadan: { year: number; from: string; to: string; confirmed: boolean } | null;
  jumuahNote: string;
  readOnly: boolean;

  saveAction: (formData: FormData) => Promise<HoursResult>;
  copyAction: (formData: FormData) => Promise<HoursResult>;
  confirmAction: (formData: FormData) => Promise<HoursResult>;
  addDateAction: (formData: FormData) => Promise<ClosureActionResult>;
  dropDateAction: (formData: FormData) => Promise<ClosureActionResult>;
  saveClosureAction: (formData: FormData) => Promise<ClosureActionResult>;
  endClosureAction: (formData: FormData) => Promise<ClosureActionResult>;
}

export function HoursWorkspace(props: HoursWorkspaceProps) {
  const [branchId, setBranchId] = useState(props.branches[0]?.id ?? "");
  const branch = props.branches.find((row) => row.id === branchId) ?? props.branches[0];

  const [hours, setHours] = useState<WeekHours>(branch?.hours ?? {});
  const [ramadan, setRamadan] = useState<RamadanHours | null>(branch?.ramadanHours ?? null);
  const [copying, setCopying] = useState(false);
  const [schedulingClosure, setSchedulingClosure] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<{ error: string; fix: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!branch) return <p className="text-body-sm text-muted">{t("hours.no_branches")}</p>;

  /*
     Switching branches replaces the whole editor state.

     Board 3d's fifth correction is that nothing said which branch was being
     written. Half of that is the scope line in the header; the other half is
     this — a picker that changed the label and left the previous branch's
     unsaved week in the fields would be worse than the label being absent.
  */
  function switchBranch(id: string) {
    const next = props.branches.find((row) => row.id === id);
    if (!next) return;
    setBranchId(id);
    setHours(next.hours);
    setRamadan(next.ramadanHours);
    setNotice(null);
    setError(null);
  }

  const preview = copyPreview(
    props.branches,
    branch.id,
    hours,
    props.dayLabels,
    t("hours.closed"),
  );

  function save() {
    const form = new FormData();
    form.set("locationId", branch!.id);
    form.set("hours", JSON.stringify(hours));
    form.set("ramadanHours", ramadan ? JSON.stringify(ramadan) : "");
    setError(null);
    startTransition(async () => {
      const result = await props.saveAction(form);
      if (!result.ok) setError(result);
      else setNotice(t("hours.saved"));
    });
  }

  function commitCopy() {
    const form = new FormData();
    form.set("fromLocationId", branch!.id);
    form.set("toLocationIds", preview.targets.map((target) => target.id).join(","));
    startTransition(async () => {
      const result = await props.copyAction(form);
      setCopying(false);
      if (!result.ok) setError(result);
      else setNotice(t("hours.copied_to", { count: result.applied }));
    });
  }

  function confirmRamadan() {
    const form = new FormData();
    form.set("locationId", branch!.id);
    startTransition(async () => {
      const result = await props.confirmAction(form);
      if (!result.ok) setError(result);
      else setNotice(t("hours.saved"));
    });
  }

  function submitClosure(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("locationId", branch!.id);
    setError(null);
    startTransition(async () => {
      const result = await props.saveClosureAction(form);
      setSchedulingClosure(false);
      if (!result.ok) setError(result);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <Alert tone="bad" live="assertive" fix={error.fix}>
          {error.error}
        </Alert>
      )}
      {props.readOnly && <Alert tone="info">{t("hours.read_only")}</Alert>}

      {/*
        Correction 5. The picker, the scope line and the two actions in one row,
        with the scope line between them — a branch picker, a copy-to-all button
        and a Save with nothing saying which branch is being written is how a
        seller overwrites a depot's hours with a head office's.
      */}
      <div className="flex flex-wrap items-center gap-3">
        {props.branches.length > 1 ? (
          /*
             Wrapped rather than sized. `Select` fills its parent and omits
             `className` from its props on purpose — the design system does not
             let a caller restyle a control — so the width belongs to the box
             around it. Unconstrained it took the whole row and pushed the scope
             line onto a line of its own, and that line is half of correction 5.
          */
          <div className="w-full max-w-80">
            <Select
              value={branchId}
              onChange={(event) => switchBranch(event.target.value)}
              aria-label={t("hours.branch_picker")}
              size="sm"
              options={props.branches.map((row) => ({
                value: row.id,
                label: row.hidden ? t("hours.hidden_branch", { branch: row.name }) : row.name,
              }))}
            />
          </div>
        ) : (
          // Board 8d §2: a single-branch business loses the picker across the
          // product, and the copy button with it — there is nothing to copy to.
          <span className="text-body-sm font-medium text-ink">{branch.name}</span>
        )}
        <span className="text-caption text-muted">{t("hours.scope")}</span>

        <div className="ms-auto flex items-center gap-2">
          {props.branches.length > 1 && !props.readOnly && (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setCopying(true)}
            >
              {t("hours.copy_to", { count: preview.targets.length })}
            </Button>
          )}
          {!props.readOnly && (
            <Button size="sm" onClick={save} disabled={pending}>
              {t("hours.save")}
            </Button>
          )}
          <span aria-live="polite" className="text-caption text-muted">
            {notice}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23.25rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={t("hours.standard_week")}
            actions={
              <span className="font-mono text-eyebrow uppercase tracking-wide text-body">
                {t("hours.timezone")}
              </span>
            }
          >
            <div className="flex flex-col gap-3">
              <HoursEditor
                hours={hours}
                onChange={setHours}
                label={t("hours.week")}
                dayLabels={props.dayLabels}
                openLabel={t("hours.open")}
                closeLabel={t("hours.close")}
                closedLabel={t("hours.closed")}
                addShiftLabel={t("hours.add_shift")}
                removeShiftLabel={t("hours.remove_shift")}
                copyAllLabel={t("hours.copy_all")}
                publicHolidaysLabel={t("hours.public_holidays")}
                publicHolidayOptions={[
                  { value: "closed", label: t("hours.public.closed") },
                  { value: "reduced", label: t("hours.public.reduced") },
                  { value: "normal", label: t("hours.public.normal") },
                ]}
                ramadanLabel={t("hours.ramadan")}
                ramadanHint={t("hours.ramadan_hint")}
                ramadanOnLabel={t("hours.ramadan_toggle")}
                problemLabel={describeProblemText}
                disabled={pending || props.readOnly}
              />
              {/*
                Correction 3. The board asserted `Jumu'ah break applied` beside a
                single range ending at noon — a note contradicting the control
                next to it. It appears only while the gap is actually in the
                seller's Friday, because Jumu'ah is a default we prefill and not
                a rule we enforce.
              */}
              {props.jumuahNote && (
                <p className="text-caption text-body">{props.jumuahNote}</p>
              )}
            </div>
          </Panel>

          <RamadanCard
            hours={ramadan}
            onChange={setRamadan}
            window={props.ramadan}
            needsConfirming={branch.needsConfirming}
            confirmedYear={branch.ramadanConfirmedYear}
            onConfirm={confirmRamadan}
            disabled={pending}
            readOnly={props.readOnly}
          />
        </div>

        <div className="flex flex-col gap-4">
          <HolidayRail
            years={props.holidayYears}
            rows={branch.holidays}
            locationId={branch.id}
            addAction={props.addDateAction}
            removeAction={props.dropDateAction}
            readOnly={props.readOnly}
          />

          <Panel eyebrow={t("hours.closure_eyebrow")}>
            <div className="flex flex-col gap-3">
              {branch.closure ? (
                <>
                  {/* Board 3d's "closure active today" state: a banner saying
                      what buyers currently see, because the week is not it. */}
                  <Alert tone="warn" fix={t("hours.closure_note")}>
                    {t("hours.closure_active", {
                      from: branch.closure.from,
                      until: branch.closure.until,
                    })}
                  </Alert>
                  {!props.readOnly && (
                    <div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          const form = new FormData();
                          form.set("locationId", branch.id);
                          startTransition(async () => {
                            const result = await props.endClosureAction(form);
                            if (!result.ok) setError(result);
                          });
                        }}
                      >
                        {t("hours.closure_clear")}
                      </Button>
                    </div>
                  )}
                </>
              ) : schedulingClosure ? (
                <form onSubmit={submitClosure} className="flex flex-col gap-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-ink">{t("hours.add_date_from")}</span>
                      <Input name="from" size="sm" type="date" required />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-caption text-ink">{t("hours.add_date_to")}</span>
                      <Input name="until" size="sm" type="date" required />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="text-caption text-ink">{t("hours.closure_reason")}</span>
                    <Input name="reason" size="sm" required />
                    <span className="text-caption text-muted">{t("hours.closure_reason_hint")}</span>
                  </label>
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" disabled={pending}>
                      {t("hours.closure_schedule")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setSchedulingClosure(false)}
                    >
                      {t("hours.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="text-caption text-body">{t("hours.closure_body")}</p>
                  {!props.readOnly && (
                    <div>
                      <Button size="sm" variant="secondary" onClick={() => setSchedulingClosure(true)}>
                        {t("hours.closure_schedule")}
                      </Button>
                    </div>
                  )}
                  <p className="text-caption text-muted">{t("hours.closure_note")}</p>
                </>
              )}
            </div>
          </Panel>

          <Panel title={t("hours.why_title")}>
            <p className="text-caption text-body">
              {t("hours.why_body")}{" "}
              <Link
                href="/dashboard/locations"
                className="text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("locations.title")}
              </Link>
            </p>
          </Panel>
        </div>
      </div>

      {/*
        Correction 4. `Copy to all branches` silently overwrote four other
        branches, including a depot and a sales office that plainly keep
        different hours. Board 3f §4's rule for a destructive bulk action: name
        what it touches before it runs.
      */}
      <Modal
        open={copying}
        onClose={() => setCopying(false)}
        title={t("hours.copy_title", { count: preview.targets.length })}
        closeLabel={t("hours.cancel")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCopying(false)} disabled={pending}>
              {t("hours.cancel")}
            </Button>
            <Button onClick={commitCopy} disabled={pending || preview.targets.length === 0}>
              {t("hours.copy_confirm")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-body">
            {preview.changing === 0
              ? t("hours.copy_none")
              : t("hours.copy_body", { count: preview.changing })}
          </p>
          <ul className="flex flex-col divide-y divide-line">
            {preview.targets.map((target) => (
              <li key={target.id} className="py-2 first:pt-0">
                <p className="text-body-sm font-medium text-ink">{target.name}</p>
                <p className="font-mono text-eyebrow uppercase tracking-wide text-body">
                  {target.summary}
                </p>
                {target.unchanged && (
                  <p className="text-caption text-muted">{t("hours.copy_unchanged")}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="text-caption text-muted">{t("hours.copy_ramadan_note")}</p>
        </div>
      </Modal>
    </div>
  );
}
