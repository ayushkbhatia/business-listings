"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Tag } from "@/components/display";
import { Button, Input, Label, Select, Textarea } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";
import { BLANK_FIELDS, TRAVELLING_FIELDS } from "@/lib/services/scope-template";
import type {
  CloneResult,
  DeleteResult,
  OfferResult,
  SaveResult,
} from "./actions";

/**
 * Board `3h-s` — one template, its services, and the changes waiting on them.
 *
 * ## The edit and the offers are the same screen, deliberately
 *
 * B4's rule is easy to state and easy to forget: *a template edit produces an
 * offer per service, never a write-through*. Putting the offers under the form
 * that produces them makes the rule visible at the moment it matters — a seller
 * who changes the fee basis sees three rows appear saying which services would
 * take it, and nothing has changed until they press one.
 *
 * The alternative — a separate "pending changes" screen — is where the rule
 * goes to be missed.
 */

export interface OfferView {
  field: string;
  before: string | null;
  after: string;
  /** Already resolved to words: enum keys never reach a seller raw. */
  beforeLabel: string | null;
  afterLabel: string;
}

export interface ServiceOffersView {
  serviceId: string;
  serviceName: string;
  live: boolean;
  offers: OfferView[];
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface TemplateWorkspaceProps {
  id: string;
  name: string;
  values: Record<string, string>;
  /** Resolved labels for the five, for the read-only view. */
  labels: Record<string, string | null>;
  usedBy: number;
  perService: readonly ServiceOffersView[];
  /** The chosen family's own fee bases — `3g-s` B2, never a global list. */
  feeBases: readonly FieldOption[];
  engagementTypes: readonly FieldOption[];
  deliveredWhere: readonly FieldOption[];
  cloneFills: number;
  cloneTotal: number;
  save: (formData: FormData) => Promise<SaveResult>;
  remove: (formData: FormData) => Promise<DeleteResult>;
  clone: (formData: FormData) => Promise<CloneResult>;
  accept: (formData: FormData) => Promise<OfferResult>;
  decline: (formData: FormData) => Promise<OfferResult>;
}

interface Failure {
  error: string;
  fix: string;
}

const FIELD_LABEL: Record<string, string> = {
  engagementType: t("scope_template.field.engagementType"),
  feeBasis: t("scope_template.field.feeBasis"),
  deliveredWhere: t("scope_template.field.deliveredWhere"),
  deliverable: t("scope_template.field.deliverable"),
  regulator: t("scope_template.field.regulator"),
  name: t("scope_template.field.name"),
  scope: t("scope_template.field.scope"),
  excluded: t("scope_template.field.excluded"),
  turnaround: t("scope_template.field.turnaround"),
};

export function TemplateWorkspace({
  id,
  name,
  values,
  labels,
  usedBy,
  perService,
  feeBases,
  engagementTypes,
  deliveredWhere,
  cloneFills,
  cloneTotal,
  save,
  remove,
  clone,
  accept,
  decline,
}: TemplateWorkspaceProps) {
  const router = useRouter();
  const ids = useId();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const waiting = perService.reduce((sum, row) => sum + row.offers.length, 0);

  function run<T extends { ok: boolean }>(
    call: () => Promise<T>,
    onDone: (result: Extract<T, { ok: true }>) => void,
  ): void {
    setFailure(null);
    setNote(null);
    startTransition(async () => {
      const result = await call();
      if (!result.ok) {
        setFailure(result as unknown as Failure);
        return;
      }
      onDone(result as Extract<T, { ok: true }>);
      router.refresh();
    });
  }

  function onSave(formData: FormData): void {
    formData.set("id", id);
    run(
      () => save(formData),
      () => {
        setEditing(false);
        setNote(t("scope_template.saved"));
      },
    );
  }

  function onClone(formData: FormData): void {
    formData.set("id", id);
    run(
      () => clone(formData),
      (done) =>
        setNote(
          t("scope_template.cloned", {
            filled: formatCount(done.filled),
            total: formatCount(cloneTotal),
          }),
        ),
    );
  }

  function onOffer(serviceId: string, field: string, take: boolean): void {
    const form = new FormData();
    form.set("serviceId", serviceId);
    form.set("field", field);
    run(
      () => (take ? accept(form) : decline(form)),
      () => setNote(take ? null : t("scope_template.declined")),
    );
  }

  function onDelete(): void {
    const form = new FormData();
    form.set("id", id);
    run(
      () => remove(form),
      () => router.push("/dashboard/scope-templates"),
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {editing ? (
        <form
          action={onSave}
          className="flex flex-col gap-4 rounded-card border border-line-strong bg-card px-5 py-4"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${ids}-name`}>{t("scope_template.name")}</Label>
            <Input id={`${ids}-name`} name="name" defaultValue={name} />
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <Field id={`${ids}-engagement`} field="engagementType">
              <Select
                id={`${ids}-engagement`}
                name="engagementType"
                defaultValue={values.engagementType ?? ""}
                options={engagementTypes}
                placeholder={t("scope_template.unset")}
              />
            </Field>
            <Field id={`${ids}-fee`} field="feeBasis">
              <Select
                id={`${ids}-fee`}
                name="feeBasis"
                defaultValue={values.feeBasis ?? ""}
                options={feeBases}
                placeholder={t("scope_template.unset")}
              />
            </Field>
            <Field id={`${ids}-where`} field="deliveredWhere">
              <Select
                id={`${ids}-where`}
                name="deliveredWhere"
                defaultValue={values.deliveredWhere ?? ""}
                options={deliveredWhere}
                placeholder={t("scope_template.unset")}
              />
            </Field>
            <Field id={`${ids}-regulator`} field="regulator">
              <Input
                id={`${ids}-regulator`}
                name="regulator"
                defaultValue={values.regulator ?? ""}
              />
            </Field>
          </div>

          <Field id={`${ids}-deliverable`} field="deliverable">
            <Textarea
              id={`${ids}-deliverable`}
              name="deliverable"
              rows={2}
              defaultValue={values.deliverable ?? ""}
            />
          </Field>

          {/*
             Said where a seller would otherwise look for the missing fields.
             There is no control for scope, exclusions, the service name or the
             turnaround, and the reason is the board's own sentence.
          */}
          <p className="max-w-prose text-caption text-muted">
            {t("scope_template.never_templated")}
          </p>
          <p className="max-w-prose text-caption text-muted">
            {t("scope_template.turnaround_why")}
          </p>

          <div className="flex items-center gap-3">
            <Button type="submit" size="md" disabled={pending}>
              {pending ? t("scope_template.saving") : t("scope_template.save")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setEditing(false)}
              disabled={pending}
            >
              {t("scope_template.cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="rounded-card border border-line-strong bg-card px-5 py-4">
          {/*
             `h2`, not `h3`. `SellerPage` owns the `h1`, and these are the first
             level of content under it — axe's `heading-order` catches the jump,
             and a screen reader's heading list is how a seller skips to the
             part they came for.
          */}
          <h2 className="font-mono text-eyebrow uppercase text-faint">
            {t("scope_template.prefilled")}
          </h2>
          <dl className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {TRAVELLING_FIELDS.map((field) => (
              <Row key={field} label={FIELD_LABEL[field]!} value={labels[field] ?? null} />
            ))}
          </dl>

          <h2 className="mt-5 font-mono text-eyebrow uppercase text-faint">
            {t("scope_template.blank")}
          </h2>
          {/*
             Rendered, not omitted. § Interface honesty: the seller sees which
             four a service still owes, and a template that simply did not
             mention them would read as a template that forgot.
          */}
          <dl className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {BLANK_FIELDS.map((field) => (
              <Row key={field} label={FIELD_LABEL[field]!} value={null} dash />
            ))}
          </dl>

          <p className="mt-4 max-w-prose text-caption text-muted">
            {t("scope_template.never_templated")}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="md" onClick={() => setEditing(true)}>
              {t("scope_template.edit")}
            </Button>
            <Button variant="ghost" size="md" onClick={() => setConfirming(true)}>
              {t("scope_template.delete")}
            </Button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="rounded-card border border-warn-line bg-warn-surface px-5 py-4">
          <p className="text-body-sm font-medium text-warn-ink">
            {t("scope_template.delete_confirm", { name })}
          </p>
          {/*
             Names what actually happens — B7. "Your services break" would be
             false: they keep every value they hold and lose only the link.
          */}
          <p className="mt-2 max-w-prose text-caption text-body">
            {usedBy === 0
              ? t("scope_template.delete_body_none")
              : t("scope_template.delete_body", {
                  count: usedBy,
                  formatted: formatCount(usedBy),
                })}
          </p>
          <div className="mt-3 flex items-center gap-3">
            <Button variant="danger" size="sm" onClick={onDelete} disabled={pending}>
              {t("scope_template.delete_go")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              {t("scope_template.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* ── The rule, stated where the edit happens ─────────────────────── */}
      <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
        <p className="text-body-sm font-medium text-ink">
          {t("scope_template.no_writethrough_title")}
        </p>
        <p className="mt-2 max-w-prose text-caption text-body">
          {t("scope_template.no_writethrough_body")}
        </p>
      </div>

      {/* ── What is waiting ────────────────────────────────────────────── */}
      <section aria-labelledby={`${ids}-offers`}>
        <h2 id={`${ids}-offers`} className="text-body-sm font-medium text-ink">
          {t("scope_template.offers_title")}
        </h2>

        {perService.length === 0 ? (
          <p className="mt-2 text-caption text-muted">{t("scope_template.used_by_none")}</p>
        ) : waiting === 0 ? (
          <p className="mt-2 text-caption text-muted">{t("scope_template.offers_none")}</p>
        ) : (
          <ul className="mt-2.5 flex list-none flex-col gap-2.5">
            {perService
              .filter((row) => row.offers.length > 0)
              .map((row) => (
                <li
                  key={row.serviceId}
                  className="rounded-card border border-line-strong bg-card px-4 py-3.5"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="text-body-sm font-medium text-ink">{row.serviceName}</p>
                    {!row.live && <Tag size="sm">{t("scope_template.service_draft")}</Tag>}
                  </div>
                  <ul className="mt-2 flex list-none flex-col gap-2">
                    {row.offers.map((offer) => (
                      <li
                        key={offer.field}
                        className="flex flex-wrap items-center justify-between gap-3"
                      >
                        <span className="text-caption text-body">
                          {offer.beforeLabel === null
                            ? t("scope_template.offer_from_nothing", {
                                field: FIELD_LABEL[offer.field] ?? offer.field,
                                after: offer.afterLabel,
                              })
                            : t("scope_template.offer_row", {
                                field: FIELD_LABEL[offer.field] ?? offer.field,
                                before: offer.beforeLabel,
                                after: offer.afterLabel,
                              })}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => onOffer(row.serviceId, offer.field, true)}
                          >
                            {t("scope_template.accept")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => onOffer(row.serviceId, offer.field, false)}
                          >
                            {t("scope_template.decline")}
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* ── A service from this template ───────────────────────────────── */}
      <section aria-labelledby={`${ids}-clone`} className="rounded-card border border-line bg-card px-5 py-4">
        <h2 id={`${ids}-clone`} className="text-body-sm font-medium text-ink">
          {t("scope_template.clone_title")}
        </h2>
        <p className="mt-1.5 max-w-prose text-caption text-body">
          {t("scope_template.clone_hint", {
            filled: formatCount(cloneFills),
            total: formatCount(cloneTotal),
            named: formatCount(cloneFills + 1),
          })}
        </p>
        <form action={onClone} className="mt-3 flex flex-wrap items-center gap-2.5">
          <span className="min-w-0 flex-1">
            <Input
              name="name"
              aria-label={t("scope_template.field.name")}
              placeholder={t("scope_template.field.name")}
            />
          </span>
          <Button type="submit" variant="secondary" size="md" disabled={pending}>
            {t("scope_template.clone")}
          </Button>
        </form>
      </section>

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
    </div>
  );
}

function Field({
  id,
  field,
  children,
}: {
  id: string;
  field: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{FIELD_LABEL[field]!}</Label>
      {children}
    </div>
  );
}

function Row({ label, value, dash = false }: { label: string; value: string | null; dash?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[9rem] shrink-0 font-mono text-eyebrow uppercase text-faint">{label}</dt>
      <dd className={cn("text-caption", value === null ? "text-faint" : "text-body")}>
        {value ?? (dash ? t("scope_template.dash") : t("scope_template.unset"))}
      </dd>
    </div>
  );
}
