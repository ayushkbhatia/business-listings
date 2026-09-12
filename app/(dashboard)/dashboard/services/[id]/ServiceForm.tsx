"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { Card } from "@/components/structure";
import { cn } from "@/lib/cn";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  DELIVERED_WHERE,
  ENGAGEMENT_TYPES,
  OPTIONAL_FIELD_KEYS,
  SCOPE_GUIDANCE,
  completeness,
  type Completeness,
  type OptionalFieldKey,
  type RequiredField,
} from "@/lib/services/scope-sheet";
import type { ServiceEditorState } from "@/lib/services/service";
import type { saveServiceField, setStatus } from "./actions";

/**
 * Board `3g-s` — the scope sheet, as a form.
 *
 * Twelve fields, six required, and the six are what make two firms comparable.
 * The sidebar's `n of 6` is **computed from the record** and there is no box to
 * tick: the number leaves this screen — it is a column on `3f-s`, a gap report,
 * and the intended replacement for `12c`'s spec-completeness term, which a
 * services business can never earn — and a seller-settable flag would be worth
 * nothing to any of the three.
 *
 * Autosave is 800ms idle per field, the same contract as `2c-s` and `2d-s`, and
 * it patches only what changed. The enums save on change rather than on a
 * timer, because a select is complete the moment it is chosen and a timer there
 * is only a window in which the seller can lose the click.
 */

const AUTOSAVE_MS = 800;

const ENGAGEMENT_LABEL: Record<string, string> = {
  ongoing_contract: t("engagement.ongoing_contract"),
  one_off_job: t("engagement.one_off_job"),
  call_off: t("engagement.call_off"),
};

const DELIVERED_LABEL: Record<string, string> = {
  remote: t("delivered.remote"),
  at_our_office: t("delivered.at_our_office"),
  on_site: t("delivered.on_site"),
};

const OPTIONAL_LABEL: Record<OptionalFieldKey, string> = {
  regulator: t("service_editor.optional.regulator"),
  requires_from_client: t("service_editor.optional.requires_from_client"),
  sectors: t("service_editor.optional.sectors"),
  languages: t("service_editor.optional.languages"),
};

const REQUIRED_LABEL: Record<RequiredField, string> = {
  name: t("service_editor.name"),
  engagementType: t("service_editor.engagement"),
  feeBasis: t("service_editor.fee_basis"),
  turnaround: t("service_editor.turnaround"),
  deliveredWhere: t("service_editor.delivered_where"),
  deliverable: t("service_editor.deliverable"),
};

type Draft = {
  name: string;
  engagementType: string;
  feeBasis: string;
  turnaround: string;
  deliveredWhere: string;
  deliverable: string;
  scope: string;
  excluded: string;
  indicativeFee: string;
} & Record<OptionalFieldKey, string>;

export function ServiceForm({
  state,
  publicHref,
  actions,
}: {
  state: ServiceEditorState;
  publicHref: string;
  actions: { save: typeof saveServiceField; setStatus: typeof setStatus };
}) {
  const router = useRouter();

  const [draft, setDraft] = useState<Draft>({
    name: state.name,
    engagementType: state.engagementType ?? "",
    feeBasis: state.feeBasis ?? "",
    turnaround: state.turnaround ?? "",
    deliveredWhere: state.deliveredWhere ?? "",
    deliverable: state.deliverable ?? "",
    scope: state.scope ?? "",
    excluded: state.excluded ?? "",
    indicativeFee: state.indicativeFee ?? "",
    ...(Object.fromEntries(
      OPTIONAL_FIELD_KEYS.map((key) => [key, state.optional[key]]),
    ) as Record<OptionalFieldKey, string>),
  });
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date>(state.savedAt);
  const [status, setLiveStatus] = useState(state.status);
  const [busy, setBusy] = useState(false);

  /*
     Derived, not stored — and that is the rule this screen is about.

     The same pure function the server runs, over the draft the seller is
     looking at, so the sidebar moves as they type rather than after the round
     trip. Holding it in state and writing it from an effect would be a second
     copy of a number whose whole point is that there is no writable path to it,
     and the lint rule that refuses a synchronous `setState` inside an effect is
     right for the same reason it was right on `2c-s`.
  */
  const score: Completeness = completeness({
    name: draft.name || null,
    engagementType: (draft.engagementType || null) as never,
    feeBasis: draft.feeBasis || null,
    turnaround: draft.turnaround || null,
    deliveredWhere: (draft.deliveredWhere || null) as never,
    deliverable: draft.deliverable || null,
  });

  const send = useCallback(
    (field: keyof Draft, value: string) => {
      const form = new FormData();
      form.set("id", state.id);
      form.set("field", field);
      form.set("value", value);
      void actions.save(form).then((result) => {
        if (result.ok) {
          setError(null);
          setSavedAt(new Date(result.savedAt));
          return;
        }
        setError(
          result.reason === "name_required"
            ? t("service_editor.name_required")
            : t("services.error.save_failed"),
        );
      });
    },
    [actions, state.id],
  );

  /** Debounced, for the fields that arrive one character at a time. */
  const typed = useDebouncedSave(send);

  const set = (field: keyof Draft, value: string, immediate = false) => {
    setDraft((current) => ({ ...current, [field]: value }));
    if (immediate) send(field, value);
    else typed(field, value);
  };

  const togglePublish = () => {
    if (busy) return;
    setBusy(true);
    const next = status === "live" ? "draft" : "live";
    const form = new FormData();
    form.set("id", state.id);
    form.set("status", next);
    void actions.setStatus(form).then((result) => {
      setBusy(false);
      if (!result.ok) {
        setError(t("services.error.save_failed"));
        return;
      }
      setLiveStatus(next);
      router.refresh();
    });
  };

  const optionalFilled = OPTIONAL_FIELD_KEYS.filter((key) => draft[key].trim() !== "").length;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <div className="min-w-0 flex-1 flex flex-col gap-6">
        {error && (
          <Alert tone="bad" live="assertive" fix={t("services.error.save_failed")}>
            {error}
          </Alert>
        )}

        {/* ── The six ─────────────────────────────────────────────────── */}
        <Card>
          <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("service_editor.required_group")}
          </h2>

          <div className="mt-4 flex flex-col gap-4">
            <div>
              <Label htmlFor="svc-name" hint={t("service_editor.name_hint")}>
                {t("service_editor.name")}
              </Label>
              <Input
                id="svc-name"
                value={draft.name}
                onChange={(event) => set("name", event.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="svc-engagement">{t("service_editor.engagement")}</Label>
                {/* An explicit placeholder. A Select without one posts its
                    first option on the first save, which is the editor
                    inventing an answer the seller never gave — board 3g's own
                    scar, and the reason `placeholder` exists on the primitive. */}
                <Select
                  id="svc-engagement"
                  value={draft.engagementType}
                  placeholder={t("service_editor.choose")}
                  options={ENGAGEMENT_TYPES.map((value) => ({
                    value,
                    label: ENGAGEMENT_LABEL[value]!,
                  }))}
                  onChange={(event) => set("engagementType", event.target.value, true)}
                />
              </div>

              <div>
                <Label
                  htmlFor="svc-fee-basis"
                  hint={t("service_editor.fee_basis_hint", { family: state.family.name })}
                >
                  {t("service_editor.fee_basis")}
                </Label>
                {/*
                   The family's own list — `3g-s` B2, and the single most
                   important control on this screen. Never a global enum: the FM
                   family offers per sq ft / yr and an audit family does not,
                   and one list was wrong for every family at once.

                   The stale value is appended when this family does not offer
                   it, so the seller can see what the record still says before
                   replacing it rather than the control reading empty over a
                   value that is there.
                */}
                <Select
                  id="svc-fee-basis"
                  value={draft.feeBasis}
                  invalid={state.feeBasisStale}
                  placeholder={t("service_editor.choose")}
                  options={[
                    ...state.family.feeBases.map((basis) => ({
                      value: basis.key,
                      label: basis.label,
                    })),
                    ...(state.feeBasisStale && state.feeBasis
                      ? [{ value: state.feeBasis, label: state.feeBasis }]
                      : []),
                  ]}
                  onChange={(event) => set("feeBasis", event.target.value, true)}
                />
                {state.feeBasisStale && (
                  <p className="mt-1 text-caption text-warn-ink">
                    {t("service_editor.fee_basis_stale", { family: state.family.name })}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="svc-turnaround" hint={t("service_editor.turnaround_hint")}>
                  {t("service_editor.turnaround")}
                </Label>
                <Input
                  id="svc-turnaround"
                  value={draft.turnaround}
                  onChange={(event) => set("turnaround", event.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="svc-delivered">{t("service_editor.delivered_where")}</Label>
                <Select
                  id="svc-delivered"
                  value={draft.deliveredWhere}
                  placeholder={t("service_editor.choose")}
                  options={DELIVERED_WHERE.map((value) => ({
                    value,
                    label: DELIVERED_LABEL[value]!,
                  }))}
                  onChange={(event) => set("deliveredWhere", event.target.value, true)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="svc-deliverable" hint={t("service_editor.deliverable_hint")}>
                {t("service_editor.deliverable")}
              </Label>
              <Input
                id="svc-deliverable"
                value={draft.deliverable}
                onChange={(event) => set("deliverable", event.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* ── Scope and excluded ──────────────────────────────────────── */}
        <Card>
          <div className="flex flex-col gap-4">
            <div>
              <Label htmlFor="svc-scope" hint={t("service_editor.scope_hint")}>
                {t("service_editor.scope")}
              </Label>
              <Textarea
                id="svc-scope"
                rows={6}
                value={draft.scope}
                onChange={(event) => set("scope", event.target.value)}
              />
              {/* Guidance, not a cap — `3g-s` Q3. Firms that write more are not
                  the problem, and a hard limit would cut a sentence mid-word. */}
              <p className="mt-1 text-caption text-muted">
                {t("service_editor.scope_long", {
                  count: formatCount(draft.scope.trim().length),
                  max: formatCount(SCOPE_GUIDANCE),
                })}
              </p>
            </div>

            <div>
              <Label htmlFor="svc-excluded" hint={t("service_editor.excluded_hint")}>
                {t("service_editor.excluded")}
              </Label>
              <Textarea
                id="svc-excluded"
                rows={5}
                value={draft.excluded}
                onChange={(event) => set("excluded", event.target.value)}
              />
            </div>
          </div>
        </Card>

        {/* ── The optional half ───────────────────────────────────────── */}
        <Card>
          <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("service_editor.optional_group", {
              filled: formatCount(optionalFilled),
              total: formatCount(OPTIONAL_FIELD_KEYS.length),
            })}
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {OPTIONAL_FIELD_KEYS.map((key) => {
              const row = state.family.rows.find((entry) => entry.key === key);
              return (
                <div key={key}>
                  <Label
                    htmlFor={`svc-${key}`}
                    /* Which answers buyers filter on, said to the person
                       filling them in. The family owns the flag — `1g-s` B5 —
                       so the editor and the facets cannot drift. */
                    {...(row?.filterable ? { hint: t("service_editor.filterable") } : {})}
                  >
                    {row?.label ?? OPTIONAL_LABEL[key]}
                  </Label>
                  <Input
                    id={`svc-${key}`}
                    value={draft[key]}
                    onChange={(event) => set(key, event.target.value)}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ── The rail ────────────────────────────────────────────────────── */}
      <aside className="w-full shrink-0 lg:w-[19rem] flex flex-col gap-4">
        <Card>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-body-sm font-medium text-ink">
              {t("service_editor.sheet_title")}
            </h2>
            <span
              className={cn(
                "font-mono text-caption tabular-nums",
                score.filled < score.total ? "text-warn-ink" : "text-moss-deep",
              )}
            >
              {t("service_editor.sheet_count", {
                filled: formatCount(score.filled),
                total: formatCount(score.total),
              })}
            </span>
          </div>

          <ul className="mt-3 flex list-none flex-col gap-1.5 p-0">
            {(Object.keys(REQUIRED_LABEL) as RequiredField[]).map((field) => {
              const done = !score.missing.includes(field);
              return (
                <li key={field} className="flex items-center gap-2 text-caption">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-pill text-[0.6rem]",
                      done ? "bg-moss text-on-ink" : "border border-line-strong text-faint",
                    )}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span className={done ? "text-body" : "text-muted"}>
                    {REQUIRED_LABEL[field]}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="mt-3 text-caption text-faint">{t("service_editor.sheet_measured")}</p>
        </Card>

        {/* The private field, and the panel says so where the seller fills it
            in rather than in a tooltip they will not open. */}
        <Card>
          <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("service_editor.fee_title")}
          </h2>
          <div className="mt-3">
            <Label htmlFor="svc-indicative">{t("service_editor.fee_label")}</Label>
            <Input
              id="svc-indicative"
              value={draft.indicativeFee}
              onChange={(event) => set("indicativeFee", event.target.value)}
            />
          </div>
          <p className="mt-2 text-caption text-muted">{t("service_editor.fee_body")}</p>
        </Card>

        <Card>
          <div className="flex flex-col gap-2">
            <Button block disabled={busy} onClick={togglePublish}>
              {status === "live" ? t("service_editor.unpublish") : t("service_editor.publish")}
            </Button>
            {/*
               Publishing at any completeness — `3g-s` B4. The sentence states
               the current count plainly rather than warning: the missing fields
               cost enquiries, not the listing, and dressing that up as a warning
               is the completeness gate arriving as copy.
            */}
            {status !== "live" && score.filled < score.total && (
              <p className="text-caption text-muted">
                {t("service_editor.publish_at", {
                  filled: formatCount(score.filled),
                  total: formatCount(score.total),
                })}
              </p>
            )}
            {status === "live" && (
              <a
                href={publicHref}
                className="rounded-tag text-center text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("service_editor.view_public")}
              </a>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="font-mono text-eyebrow uppercase tracking-wide text-muted">
            {t("service_editor.log_title")}
          </h2>
          {state.revisions.length === 0 ? (
            <p className="mt-2 text-caption text-muted">{t("service_editor.log_empty")}</p>
          ) : (
            <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
              {state.revisions.map((entry, index) => (
                <li key={`${entry.field}-${index}`} className="text-caption text-muted">
                  {t("service_editor.log_line", {
                    what: describe(entry),
                    when: formatRelative(entry.at),
                    actor: entry.actor,
                  })}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <p aria-live="polite" className="text-caption text-faint">
          {t("onboarding.saved_at", { when: formatRelative(savedAt) })}
        </p>
      </aside>
    </div>
  );
}

/**
 * What the log line says happened, in the seller's vocabulary.
 *
 * Board `3g-s` B9 asks for the old value as well as the new, and the old value
 * is the half support needs: "when did their turnaround change" is only
 * answerable beside what it changed from. Truncated, because a scope block is
 * four lines and a sidebar is nineteen rem.
 */
function describe(entry: { field: string; before: string | null; after: string | null }): string {
  if (entry.field === "created") return t("service_editor.log_created");
  if (entry.field === "status") {
    return entry.after === "live"
      ? t("service_editor.log_status_live")
      : t("service_editor.log_status_draft");
  }

  const field = fieldLabel(entry.field);
  if (entry.after === null) return t("service_editor.log_cleared", { field });
  if (entry.before === null) return t("service_editor.log_set", { field });
  return t("service_editor.log_from", { field, before: shorten(entry.before) });
}

function fieldLabel(field: string): string {
  const required = REQUIRED_LABEL[field as RequiredField];
  if (required) return required;
  const optional = OPTIONAL_LABEL[field as OptionalFieldKey];
  if (optional) return optional;
  if (field === "scope") return t("service_editor.scope");
  if (field === "excluded") return t("service_editor.excluded");
  if (field === "indicativeFee") return t("service_editor.fee_label");
  return field;
}

function shorten(value: string): string {
  return value.length > 40 ? `${value.slice(0, 39)}…` : value;
}

/**
 * 800ms idle, per field — the `2c-s` contract.
 *
 * Keyed by field so two fields edited in quick succession both save: a single
 * timer would let the second edit cancel the first and the seller would lose a
 * value they watched themselves type.
 */
function useDebouncedSave(send: (field: keyof Draft, value: string) => void) {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    };
  }, []);

  return useCallback(
    (field: keyof Draft, value: string) => {
      const held = timers.current.get(field);
      if (held) clearTimeout(held);
      timers.current.set(
        field,
        setTimeout(() => {
          timers.current.delete(field);
          send(field, value);
        }, AUTOSAVE_MS),
      );
    },
    [send],
  );
}
