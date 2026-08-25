"use client";

import { useState, useTransition } from "react";
import { Button, Input, Select, Textarea } from "@/components/primitives";
import { Alert, StatusBadge } from "@/components/display";
import { Panel } from "@/components/structure";
import { DESCRIPTION_LIMIT } from "@/lib/listing/constants";
import { formatDateTime } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { ActionResult } from "./actions";

/**
 * Board 3b — the two halves, side by side, saying which is which.
 *
 * The board draws both states on one screen, and that is the point rather than
 * a layout convenience: a seller who has only ever seen the moderated half
 * assumes everything waits, and stops editing. Putting "publishes as soon as
 * you save" above the fields that do is the cheapest way to say otherwise.
 */

export interface PendingChange {
  id: string;
  field: string;
  afterValue: string;
  createdAt: string;
}

export interface ListingFormProps {
  displayName: string;
  description: string;
  establishedYear: number | null;
  teamSize: string | null;
  languages: string[];

  tradeName: string;
  licenceNumber: string;
  categoryName: string;
  categories: { value: string; label: string }[];
  primaryCategoryId: string;

  pending: PendingChange[];

  saveAction: (formData: FormData) => Promise<ActionResult>;
  submitAction: (formData: FormData) => Promise<ActionResult>;
  withdrawAction: (formData: FormData) => Promise<ActionResult>;
}

const TEAM_SIZES = ["b1_10", "b11_50", "b51_200", "b201_500", "b500_plus"] as const;
const LANGUAGES = ["English", "Arabic", "Hindi", "Urdu", "Malayalam", "Tagalog", "Tamil", "Bengali"];

export function ListingForm(props: ListingFormProps) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState(props.description);
  const [pending, startTransition] = useTransition();

  const pendingFor = (field: string) => props.pending.find((p) => p.field === field) ?? null;

  function onSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    startTransition(async () => {
      const result = await props.saveAction(form);
      if (!result.ok) setError(result.error);
      else setNotice(t("listing.saved"));
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <Alert tone="bad" live="assertive">{error}</Alert>
      )}

      <form onSubmit={onSave}>
        <Panel title={t("listing.instant_heading")} description={t("listing.instant_body")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-body-sm text-ink">{t("listing.display_name")}</span>
              <Input name="displayName" defaultValue={props.displayName} required />
              <span className="text-caption text-muted">{t("listing.display_name_hint")}</span>
            </label>

            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-body-sm text-ink">{t("listing.description")}</span>
              {/*
                A soft limit, which is the primitive's own behaviour: typing
                past it is allowed and flagged rather than blocked. A hard
                maxLength truncates a sentence mid-word and the seller does not
                see it happen.
              */}
              <Textarea
                name="description"
                rows={4}
                value={description}
                limit={DESCRIPTION_LIMIT}
                counterLabel={(used, limit) => `${used} / ${limit}`}
                onChange={(e) => setDescription(e.target.value)}
              />
              <span className="text-caption text-muted">
                {t("listing.description_hint", { limit: String(DESCRIPTION_LIMIT) })}
              </span>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("listing.established")}</span>
              <Input
                name="establishedYear"
                mono
                inputMode="numeric"
                defaultValue={props.establishedYear ?? ""}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-body-sm text-ink">{t("listing.team_size")}</span>
              <Select
                name="teamSize"
                defaultValue={props.teamSize ?? ""}
                placeholder="—"
                options={TEAM_SIZES.map((size) => ({
                  value: size,
                  label: t(`listing.team.${size}` as never),
                }))}
              />
            </label>

            <fieldset className="flex flex-col gap-1 sm:col-span-2">
              <legend className="text-body-sm text-ink">{t("listing.languages")}</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
                {LANGUAGES.map((language) => (
                  <label key={language} className="flex items-center gap-1.5 text-body-sm">
                    <input
                      type="checkbox"
                      name="language"
                      value={language}
                      defaultChecked={props.languages.includes(language)}
                      className="size-4 rounded-sm border-line-strong accent-moss focus-visible:shadow-focus focus-visible:outline-none"
                    />
                    {language}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={pending}>
              {t("listing.save")}
            </Button>
            <span aria-live="polite" className="text-body-sm text-muted">
              {notice}
            </span>
          </div>
        </Panel>
      </form>

      <Panel title={t("listing.moderated_heading")} description={t("listing.moderated_body")}>
        <div className="flex flex-col gap-5">
          <ModeratedField
            field="trade_name"
            label={t("listing.trade_name")}
            hint={t("listing.trade_name_hint")}
            current={props.tradeName}
            pending={pendingFor("trade_name")}
            submitAction={props.submitAction}
            withdrawAction={props.withdrawAction}
          />

          <ModeratedField
            field="primary_category"
            label={t("listing.primary_category")}
            current={props.categoryName}
            currentValue={props.primaryCategoryId}
            options={props.categories}
            pending={pendingFor("primary_category")}
            submitAction={props.submitAction}
            withdrawAction={props.withdrawAction}
          />

          <ModeratedField
            field="licence"
            label={t("listing.licence_number")}
            current={props.licenceNumber}
            mono
            pending={pendingFor("licence")}
            submitAction={props.submitAction}
            withdrawAction={props.withdrawAction}
          />
        </div>
      </Panel>
    </div>
  );
}

function ModeratedField({
  field,
  label,
  hint,
  current,
  currentValue,
  options,
  mono = false,
  pending,
  submitAction,
  withdrawAction,
}: {
  field: string;
  label: string;
  hint?: string;
  current: string;
  currentValue?: string;
  options?: { value: string; label: string }[];
  mono?: boolean;
  pending: PendingChange | null;
  submitAction: (formData: FormData) => Promise<ActionResult>;
  withdrawAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [value, setValue] = useState(currentValue ?? current);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const unchanged = value.trim() === (currentValue ?? current).trim();

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4 first:border-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body-sm text-ink">{label}</span>
        {pending && (
          <StatusBadge tone="warn" shape="chip" size="sm">
            {t("listing.pending")}
          </StatusBadge>
        )}
      </div>
      {hint && <span className="text-caption text-muted">{hint}</span>}

      {pending ? (
        /*
          The request, not the field. Offering an editable box under a pending
          request invites a second submission that supersedes the first, and a
          seller who does that twice has no idea which one a moderator is
          looking at. Withdraw, then ask again.
        */
        <Alert
          tone="warn"
          fix={t("listing.pending_since", { when: formatDateTime(new Date(pending.createdAt)) })}
          action={
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                const form = new FormData();
                form.set("id", pending.id);
                startTransition(async () => {
                  const result = await withdrawAction(form);
                  if (result.ok) setNotice(t("listing.withdrawn"));
                  else setError(result.error);
                });
              }}
            >
              {t("listing.withdraw")}
            </Button>
          }
        >
          {t("listing.pending_change", { value: pending.afterValue })}
        </Alert>
      ) : (
        <div className="flex flex-wrap items-end gap-2">
          {options ? (
            <Select
              aria-label={label}
              value={value}
              options={options}
              onChange={(e) => setValue(e.target.value)}
            />
          ) : (
            <Input
              aria-label={label}
              mono={mono}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          )}
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || unchanged}
            onClick={() => {
              const form = new FormData();
              form.set("field", field);
              form.set("value", value);
              setError(null);
              startTransition(async () => {
                const result = await submitAction(form);
                if (result.ok) setNotice(t("listing.submitted"));
                else setError(result.error);
              });
            }}
          >
            {t("listing.submit_change")}
          </Button>
        </div>
      )}

      <span aria-live="polite" className="text-caption text-muted">
        {error ?? notice}
      </span>
    </div>
  );
}
