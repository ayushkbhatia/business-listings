"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, StatusBadge } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { CategoryAllowance } from "@/lib/onboarding/categories";
import type { ProfileCategory, PatchField, PatchProblem } from "@/lib/onboarding/profile";
import { DESCRIPTION_MAX, ESTABLISHED_MIN } from "@/lib/onboarding/profile-fields";
import type { AddCategoryResult } from "@/lib/onboarding/categories";
import type { ContinueResult, SaveFieldResult } from "./actions";
import { useSaved } from "../_saved";

/**
 * Board 2c's left column — the first screen in onboarding where a seller writes
 * rather than proves.
 *
 * Autosave on 800ms idle, per field, patching the field that changed. The header
 * timestamp is the promise the board makes: the seller can close the tab at any
 * point and resume with everything intact.
 *
 * One button, and two deliberate absences. **No Back** — steps 1 and 2 are
 * irreversible, a claim is submitted and a licence is with a reviewer, so a Back
 * leading to a read-only receipt is a dead click. **No Skip** — the three
 * required fields are the minimum for a publishable listing, so there is nothing
 * to skip past, and the optional items are the meter's levers rather than a
 * queue to dismiss.
 */

const IDLE_MS = 800;

export interface ProfileFormProps {
  tradeName: string;
  displayName: string;
  description: string;
  establishedYear: number | null;
  teamSize: string | null;
  primaryCategoryLabel: string;
  extras: readonly ProfileCategory[];
  allowance: CategoryAllowance;
  /** Leaves the plan can add. Absent where there is nothing above this one. */
  upgrade: { planName: string; more: number | null } | null;
  addable: readonly { value: string; label: string }[];
  teamSizes: readonly { value: string; label: string }[];
  /** Lifted so the preview beside this form re-renders as it is typed. */
  onDraft: (draft: { displayName: string; description: string; establishedYear: number | null }) => void;
  saveAction: (formData: FormData) => Promise<SaveFieldResult>;
  addAction: (formData: FormData) => Promise<AddCategoryResult>;
  removeAction: (formData: FormData) => Promise<{ ok: true }>;
  continueAction: () => Promise<ContinueResult>;
}

const PROBLEM: Record<string, MessageKey> = {
  too_short: "profile_step.error.too_short",
  too_long: "profile_step.error.too_long",
  legal_suffix: "profile_step.error.legal_suffix",
  repeats_category: "profile_step.error.repeats_category",
  description_too_long: "profile_step.error.description_too_long",
  established_out_of_range: "profile_step.error.established_out_of_range",
  unknown_team_size: "profile_step.error.unknown_team_size",
};

export function ProfileForm(props: ProfileFormProps) {
  const router = useRouter();

  const [displayName, setDisplayName] = useState(props.displayName);
  const [description, setDescription] = useState(props.description);
  const [established, setEstablished] = useState(
    props.establishedYear === null ? "" : String(props.establishedYear),
  );
  const [teamSize, setTeamSize] = useState(props.teamSize ?? "");

  const [errors, setErrors] = useState<Partial<Record<PatchField, string>>>({});
  const [blocked, setBlocked] = useState<string | null>(null);

  // The header says when it last saved — one indicator, where the board puts it.
  const { setSaved } = useSaved();

  const timers = useRef<Partial<Record<PatchField, ReturnType<typeof setTimeout>>>>({});

  const save = useCallback(
    (field: PatchField, value: string) => {
      const form = new FormData();
      form.set("field", field);
      form.set("value", value);

      void props.saveAction(form).then((result) => {
        if (result.ok) {
          setErrors((current) => ({ ...current, [field]: undefined }));
          setSaved(t("onboarding.saved_now"));
          return;
        }
        const problem = result.problem as PatchProblem;
        const key = PROBLEM[problem.kind];
        setErrors((current) => ({
          ...current,
          [field]: key
            ? t(key, {
                found: "found" in problem ? problem.found : "",
                word: "word" in problem ? problem.word : "",
                length: "length" in problem ? problem.length : 0,
              })
            : t("profile_step.save_failed"),
        }));
      });
    },
    [props, setSaved],
  );

  /**
   * Idle, not throttled.
   *
   * The timer is cleared and restarted on every keystroke, so a seller writing a
   * sentence sends one request at the end of it rather than one per pause. Per
   * field, so a description still being written does not cancel the save of a
   * display name finished ten seconds ago.
   */
  const scheduleSave = useCallback(
    (field: PatchField, value: string) => {
      clearTimeout(timers.current[field]);
      timers.current[field] = setTimeout(() => save(field, value), IDLE_MS);
    },
    [save],
  );

  // A tab closed mid-sentence still has a pending timer. Clearing them on
  // unmount stops a save firing against a page that has gone.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of Object.values(pending)) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    props.onDraft({
      displayName,
      description,
      establishedYear: established === "" ? null : Number(established),
    });
    // `onDraft` is the parent's setter and stable; depending on it would re-run
    // this on every parent render, which is every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, description, established]);

  const nameId = useId();
  const descriptionId = useId();
  const establishedId = useId();
  const teamId = useId();

  return (
    <div className="flex flex-col gap-5">
      {blocked && (
        <Alert tone="bad" live="assertive" fix={t("profile_step.error.required")}>
          {blocked}
        </Alert>
      )}

      {/* Trade name — locked, and there is no code path that unlocks it. */}
      <div className="flex flex-col gap-1.5">
        <Label>
          {t("profile_step.trade_name")}{" "}
          <span className="font-normal text-muted">{t("profile_step.trade_name_locked")}</span>
        </Label>
        <p className="rounded-ctl border border-line bg-fill px-3 py-2 text-body-sm text-muted">
          {props.tradeName /* licence-locked */}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId} hint={t("profile_step.display_name_hint")}>
          {t("profile_step.display_name")}
        </Label>
        <Input
          id={nameId}
          value={displayName}
          invalid={Boolean(errors.displayName)}
          onChange={(event) => {
            setDisplayName(event.target.value);
            scheduleSave("displayName", event.target.value);
          }}
        />
        {errors.displayName && (
          <p role="alert" className="text-caption text-bad-ink">
            {errors.displayName}
          </p>
        )}
      </div>

      {/*
        The primary category is set from the licence import and changing it goes
        through moderation, so it is stated here rather than offered as a
        control a seller would find refused.
      */}
      <div className="flex flex-col gap-1.5">
        <Label>{t("profile_step.primary_category")}</Label>
        <p className="rounded-ctl border border-line bg-card px-3 py-2 text-body-sm text-ink">
          {props.primaryCategoryLabel}
        </p>
      </div>

      <Extras
        extras={props.extras}
        allowance={props.allowance}
        upgrade={props.upgrade}
        addable={props.addable}
        addAction={props.addAction}
        removeAction={props.removeAction}
        onChanged={() => router.refresh()}
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={descriptionId}>{t("profile_step.description")}</Label>
        {/*
          The primitive's own counter, computed from the field it sits under —
          criterion 9, and the reason not to hand-roll a second one. It is a soft
          limit by design: `maxLength` on the element would silently swallow a
          paste, so typing past six hundred is allowed, flagged, and refused by
          the server on save.
        */}
        <Textarea
          id={descriptionId}
          rows={5}
          limit={DESCRIPTION_MAX}
          counterLabel={(used, max) => t("profile_step.counter", { used, max })}
          value={description}
          invalid={Boolean(errors.description)}
          onChange={(event) => {
            setDescription(event.target.value);
            scheduleSave("description", event.target.value);
          }}
        />
        <p className="text-caption text-muted">{t("profile_step.description_hint")}</p>
        {errors.description && (
          <p role="alert" className="text-caption text-bad-ink">
            {errors.description}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={establishedId}>{t("profile_step.established")}</Label>
          <Input
            id={establishedId}
            type="number"
            inputMode="numeric"
            min={ESTABLISHED_MIN}
            max={new Date().getUTCFullYear()}
            value={established}
            invalid={Boolean(errors.establishedYear)}
            onChange={(event) => {
              setEstablished(event.target.value);
              scheduleSave("establishedYear", event.target.value);
            }}
          />
          {errors.establishedYear && (
            <p role="alert" className="text-caption text-bad-ink">
              {errors.establishedYear}
            </p>
          )}
        </div>

        {/*
          A band, not a number. Nobody maintains a headcount field, and a stale
          exact number is worse than a current range.
        */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={teamId}>{t("profile_step.team_size")}</Label>
          <Select
            id={teamId}
            value={teamSize}
            options={props.teamSizes}
            onChange={(event) => {
              setTeamSize(event.target.value);
              save("teamSize", event.target.value);
            }}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button
          size="lg"
          onClick={() => {
            setBlocked(null);
            void props.continueAction().then((result) => {
              if (result.ok) router.push("/onboarding/locations");
              else setBlocked(result.error);
            });
          }}
        >
          {t("profile_step.continue")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Also list under" — the extras, and the two counters that must not be merged.
 *
 * The counter here is the **extras allowance**: the plan's cap minus the
 * primary. The strength meter counts the total. Both are correct at once, and a
 * single shared component would have to be wrong on one of them.
 */
function Extras({
  extras,
  allowance,
  upgrade,
  addable,
  addAction,
  removeAction,
  onChanged,
}: {
  extras: readonly ProfileCategory[];
  allowance: CategoryAllowance;
  upgrade: { planName: string; more: number | null } | null;
  addable: readonly { value: string; label: string }[];
  addAction: (formData: FormData) => Promise<AddCategoryResult>;
  removeAction: (formData: FormData) => Promise<{ ok: true }>;
  onChanged: () => void;
}) {
  const addId = useId();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Label htmlFor={addId}>{t("profile_step.extras")}</Label>
        <span className="text-caption text-muted">
          {allowance.extras === null
            ? t("profile_step.extras_unlimited", { plan: allowance.planName })
            : t("profile_step.extras_used", {
                used: allowance.extrasUsed,
                allowed: allowance.extras,
                plan: allowance.planName,
              })}
        </span>
      </div>

      {extras.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {extras.map((extra) => (
            <li key={extra.id}>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-caption",
                  extra.unverifiedActivity
                    ? "border-warn-line bg-warn-wash text-warn-ink"
                    : "border-line bg-fill text-body",
                )}
              >
                {extra.name}
                <form
                  action={(formData) => {
                    void removeAction(formData).then(onChanged);
                  }}
                >
                  <input type="hidden" name="categoryId" value={extra.id} />
                  <button
                    type="submit"
                    aria-label={t("profile_step.extras_remove", { category: extra.name })}
                    className="flex size-4 items-center justify-center rounded-pill text-muted hover:text-ink focus-visible:shadow-focus focus-visible:outline-none"
                  >
                    <Close size={10} />
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/*
        Accepted, then checked. The chip is on the card and out of that
        category's fan-outs until a reviewer clears it — stated here rather than
        left for the seller to discover in a month of quiet.
      */}
      {extras.some((extra) => extra.unverifiedActivity) && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warn" size="sm">
            {t("profile_step.unverified_activity")}
          </StatusBadge>
          <span className="text-caption text-muted">
            {t("profile_step.unverified_activity_note")}
          </span>
        </div>
      )}

      {allowance.canAddMore && addable.length > 0 ? (
        <form
          action={(formData) => {
            void addAction(formData).then(onChanged);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <Select
            id={addId}
            name="categoryId"
            options={addable}
            placeholder={t("profile_step.extras_add")}
            defaultValue=""
          />
          <Button type="submit" variant="secondary" size="sm">
            {t("profile_step.extras_add")}
          </Button>
        </form>
      ) : (
        /*
          The upgrade, never a dashed "+ Add" that would be refused on click.
          Board 2c's third fix: a cap that is real only in the API's rejection is
          a screen that disagrees with its own product.
        */
        upgrade && (
          <Link
            href="/onboarding/plan"
            className="inline-flex w-fit items-center rounded-pill border border-dashed border-line-strong px-3 py-1.5 text-caption text-moss hover:bg-fill focus-visible:shadow-focus focus-visible:outline-none"
          >
            {upgrade.more === null
              ? t("profile_step.extras_upgrade_unlimited", { plan: upgrade.planName })
              : t("profile_step.extras_upgrade", {
                  plan: upgrade.planName,
                  more: upgrade.more,
                })}
          </Link>
        )
      )}
    </div>
  );
}
