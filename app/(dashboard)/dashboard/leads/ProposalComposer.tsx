"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert } from "@/components/display/Alert";
import {
  Button,
  FieldError,
  Input,
  Label,
  Select,
  Textarea,
  buttonClassName,
} from "@/components/primitives";
import { formatCount, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import {
  PROPOSAL_LINE_MAX,
  PROPOSAL_TEXT_MAX,
  type ProposalField,
  type ProposalInput,
  type ProposalRefusal,
} from "@/lib/quote/proposal";
import { proposalRefusalWords } from "@/lib/quote/proposal-words";
import { PROPOSAL_PAYMENT_TERMS } from "@/lib/quote/terms";
import { saveProposalDraftAction, sendProposalAction } from "./actions";

/**
 * Board `3j-s` — the proposal composer.
 *
 * Three cards and a send bar, as drawn: *Your fee*, *Scope of this engagement*,
 * *Excluded*. What the goods composer has and this one must not — a lines
 * table, a quantity, a unit price — is absent rather than hidden (B2).
 *
 * ## The basis is a card, not a control
 *
 * B1: *render it read-only, not disabled — a disabled control invites a support
 * request.* It is a definition list, because it is a fact about the service
 * rather than a field on the proposal, and the only way to change it is the
 * link to the scope sheet that says so.
 *
 * ## Switching service
 *
 * A firm with two services in the trade picks which one it is proposing from,
 * and the basis follows. The four text fields re-seed from the new sheet only
 * where the seller has not edited them: typed words for this buyer are never
 * overwritten by a click on a select.
 *
 * ## Autosave
 *
 * 800ms idle, the `3g-s` contract. Skipped while a send is in flight, so a draft
 * cannot land on the row that send is promoting — the same guard the goods
 * composer carries, and the database refuses an edit to a sent proposal anyway.
 */

const AUTOSAVE_MS = 800;

export const PROPOSAL_VALIDITY_CHOICES = [7, 10, 14, 21, 30, 45, 60] as const;

/** One of the seller's scope sheets, as the composer offers it. */
export interface ProposalServiceOption {
  id: string;
  name: string;
  draft: boolean;
  basis: "ok" | "no_basis" | "stale_basis";
  feeBasisLabel: string | null;
  /** `/dashboard/services/:id` — where the basis is changed. */
  editHref: string;
  /**
   * The sheet's turnaround and the family's word for it. Sent with the proposal
   * as it stands, and shown here read-only for the reason the basis is: the
   * buyer compares it, and it is changed on the sheet.
   */
  turnaround: { label: string; value: string | null };
  seed: { scope: string; deliverable: string; deliveredWhere: string; exclusions: string };
}

export interface ProposalComposerProps {
  enquiryId: string;
  services: readonly ProposalServiceOption[];
  initial: ProposalInput;
  /** When a restored draft was last saved. Null when nothing was restored. */
  restoredAt: number | null;
  /** The revision this send will be. Above one, the first stays in the thread as sent. */
  revision: number;
  /** Other recipients of this enquiry. */
  others: number;
  /** Set when the first reply fell due and none has been sent. */
  lateSince: number | null;
}

type TextField = "scope" | "deliverable" | "deliveredWhere" | "exclusions";

/** Which posted value each refusal is about, so editing it clears the mark. */
const FIELD_KEY: Record<ProposalField, keyof ProposalInput> = {
  service: "serviceId",
  fee: "fee",
  mobilisation: "mobilisation",
  term: "termMonths",
  scope: "scope",
  deliverable: "deliverable",
  deliveredWhere: "deliveredWhere",
  exclusions: "exclusions",
};

export function ProposalComposer({
  enquiryId,
  services,
  initial,
  restoredAt,
  revision,
  others,
  lateSince,
}: ProposalComposerProps) {
  const router = useRouter();
  const [value, setValue] = useState<ProposalInput>(initial);
  const [edited, setEdited] = useState<Set<TextField>>(() => new Set());
  const [refusals, setRefusals] = useState<ProposalRefusal[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Whether the error is the send's list of marked fields, which clears as they are fixed. */
  const [errorIsFields, setErrorIsFields] = useState(false);
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(restoredAt);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingRef = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const ids = {
    service: useId(),
    fee: useId(),
    term: useId(),
    mobilisation: useId(),
    validity: useId(),
    payment: useId(),
    scope: useId(),
    deliverable: useId(),
    deliveredWhere: useId(),
    exclusions: useId(),
    basis: useId(),
  };

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const service = services.find((row) => row.id === value.serviceId) ?? null;
  const blocked = service === null || service.basis !== "ok";
  const errorFor = (field: ProposalField) => {
    const refusal = refusals.find((row) => row.field === field);
    return refusal ? proposalRefusalWords(refusal) : undefined;
  };

  function save(next: ProposalInput) {
    setSaving(true);
    void saveProposalDraftAction({ enquiryId, ...next }).then((result) => {
      setSaving(false);
      if (result.ok && result.savedAt) setSavedAt(result.savedAt);
      else if (!result.ok && result.error) {
        setError(result.error);
        setErrorIsFields(false);
      }
    });
  }

  function change(patch: Partial<ProposalInput>, field?: TextField) {
    const next = { ...value, ...patch };
    setValue(next);
    if (field) setEdited((held) => new Set(held).add(field));
    // A field the seller is fixing stops shouting at them as soon as they touch it.
    if (refusals.length > 0) {
      const touched = new Set(Object.keys(patch));
      const left = refusals.filter((row) => !touched.has(FIELD_KEY[row.field]));
      setRefusals(left);
      // Every marked field fixed: the notice about them has nothing left to say.
      if (left.length === 0 && errorIsFields) setError(null);
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!sendingRef.current) save(next);
    }, AUTOSAVE_MS);
  }

  function pickService(id: string) {
    const picked = services.find((row) => row.id === id);
    if (!picked) return;
    const reseed: Partial<ProposalInput> = { serviceId: picked.id };
    for (const field of ["scope", "deliverable", "deliveredWhere", "exclusions"] as const) {
      if (!edited.has(field)) reseed[field] = picked.seed[field];
    }
    change(reseed);
  }

  function send() {
    setError(null);
    setRefusals([]);
    setSending(true);
    sendingRef.current = true;
    if (timer.current) clearTimeout(timer.current);

    void sendProposalAction({ enquiryId, ...value }).then((result) => {
      setSending(false);
      sendingRef.current = false;
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error);
      setRefusals(result.refusals ?? []);
      setErrorIsFields((result.refusals ?? []).length > 0);
      // A failed send is the one assertive announcement; focus follows it.
      requestAnimationFrame(() => errorRef.current?.focus());
    });
  }

  function saveNow() {
    if (timer.current) clearTimeout(timer.current);
    save(value);
  }

  return (
    /*
       A group rather than a <form>. Enter in the fee field must not send a
       proposal a buyer is about to hold — sending is the one deliberate act on
       this screen, and implicit submission makes it an accident of a keystroke.
       It also keeps an unnamed `form` landmark per composer off a page that
       renders several.

       Laid out by its own width, not the viewport's: it sits in a column whose
       width depends on the sidebar, the split and the gallery.
    */
    <div className="@container space-y-[var(--gutter)]">
      {revision > 1 ? (
        <Alert tone="neutral">{t("proposal.revision_note", { revision })}</Alert>
      ) : null}

      {/* ── Your fee ─────────────────────────────────────────────────────── */}
      <div className="rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${ids.fee}-title`} className="text-h3 text-ink">
            {t("proposal.fee_title")}
          </h3>
          <span className="font-mono text-eyebrow uppercase text-muted">{t("proposal.private")}</span>
        </div>
        <p className="mt-1 max-w-[var(--measure-prose)] text-body-sm text-muted">{t("proposal.fee_help")}</p>

        {services.length > 1 ? (
          <div className="mt-4 max-w-md space-y-1">
            <Label htmlFor={ids.service} hint={t("proposal.service_hint")}>
              {t("proposal.service_label")}
            </Label>
            <Select
              id={ids.service}
              value={value.serviceId ?? ""}
              placeholder={t("proposal.service_placeholder")}
              invalid={errorFor("service") !== undefined}
              aria-describedby={`${ids.service}-error`}
              options={services.map((row) => ({
                value: row.id,
                label: row.draft ? t("proposal.service_option_draft", { name: row.name }) : row.name,
              }))}
              onChange={(event) => pickService(event.target.value)}
            />
            <FieldError id={`${ids.service}-error`} reserveSpace={false}>
              {service === null ? errorFor("service") : undefined}
            </FieldError>
          </div>
        ) : service ? (
          <p className="mt-3 text-caption text-muted">
            {t("proposal.service_single", { name: service.name })}
          </p>
        ) : null}

        {service && service.basis !== "ok" ? (
          <div className="mt-4">
            <Alert
              tone="warn"
              title={service.basis === "no_basis" ? t("proposal.blocked_no_basis_title") : t("proposal.blocked_stale_title")}
              action={
                <Link href={service.editHref} className={buttonClassName({ size: "sm", variant: "secondary" })}>
                  {t("proposal.blocked_action")}
                </Link>
              }
            >
              {service.basis === "no_basis"
                ? t("proposal.blocked_no_basis", { name: service.name })
                : t("proposal.blocked_stale", { name: service.name })}
            </Alert>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 @md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
          <dl aria-labelledby={ids.basis} className="rounded-ctl border border-line bg-paper-sunk px-3 py-2.5">
            <dt id={ids.basis} className="font-mono text-eyebrow uppercase text-muted">
              {t("proposal.basis_label")}
            </dt>
            <dd className={service?.feeBasisLabel ? "mt-0.5 text-body text-ink" : "mt-0.5 text-body text-muted"}>
              {service?.feeBasisLabel ?? t("proposal.basis_none")}
            </dd>
          </dl>
          <div className="space-y-1">
            <Label htmlFor={ids.fee} requirement="required" requirementLabel={t("field.required")}>
              {t("proposal.fee_label")}
            </Label>
            <Input
              id={ids.fee}
              inputMode="decimal"
              autoComplete="off"
              mono
              size="lg"
              value={value.fee}
              disabled={blocked}
              invalid={errorFor("fee") !== undefined}
              aria-describedby={`${ids.fee}-note ${ids.fee}-error`}
              leadingIcon={<span className="font-mono text-eyebrow text-muted">{t("proposal.currency")}</span>}
              onChange={(event) => change({ fee: event.target.value })}
            />
            <p id={`${ids.fee}-note`} className="text-caption text-muted">
              {service?.feeBasisLabel
                ? t("proposal.fee_note", { basis: service.feeBasisLabel })
                : t("proposal.fee_note_no_basis")}
            </p>
            <FieldError id={`${ids.fee}-error`} reserveSpace={false}>
              {errorFor("fee")}
            </FieldError>
          </div>
        </div>

        <div className="mt-4 grid gap-3 @lg:grid-cols-2 @4xl:grid-cols-4">
          <div className="space-y-1">
            <Label htmlFor={ids.term} requirement="optional" requirementLabel={t("field.optional")}>
              {t("proposal.term_label")}
            </Label>
            <Input
              id={ids.term}
              inputMode="numeric"
              autoComplete="off"
              suffix={t("proposal.term_suffix")}
              value={value.termMonths}
              invalid={errorFor("term") !== undefined}
              aria-describedby={`${ids.term}-error`}
              onChange={(event) => change({ termMonths: event.target.value })}
            />
            <FieldError id={`${ids.term}-error`} reserveSpace={false}>
              {errorFor("term")}
            </FieldError>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.mobilisation} requirement="optional" requirementLabel={t("field.optional")}>
              {t("proposal.mobilisation_label")}
            </Label>
            <Input
              id={ids.mobilisation}
              inputMode="decimal"
              autoComplete="off"
              mono
              suffix={t("proposal.mobilisation_suffix")}
              leadingIcon={<span className="font-mono text-eyebrow text-muted">{t("proposal.currency")}</span>}
              value={value.mobilisation}
              invalid={errorFor("mobilisation") !== undefined}
              aria-describedby={`${ids.mobilisation}-error`}
              onChange={(event) => change({ mobilisation: event.target.value })}
            />
            <FieldError id={`${ids.mobilisation}-error`} reserveSpace={false}>
              {errorFor("mobilisation")}
            </FieldError>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.validity}>{t("proposal.validity_label")}</Label>
            <Select
              id={ids.validity}
              value={String(value.validityDays)}
              options={PROPOSAL_VALIDITY_CHOICES.map((days) => ({
                value: String(days),
                label: t("quote.validity_days", { count: days }),
              }))}
              onChange={(event) => change({ validityDays: Number(event.target.value) })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.payment} requirement="optional" requirementLabel={t("field.optional")}>
              {t("proposal.payment_label")}
            </Label>
            {/*
               *Not stated* first and selectable, as on the goods composer: a
               select without it posts its first option, and the buyer's record
               would then say they agreed to pay in advance.
            */}
            <Select
              id={ids.payment}
              value={value.paymentTerms}
              options={[
                { value: "", label: t("proposal.not_stated") },
                ...PROPOSAL_PAYMENT_TERMS.map((terms) => ({ value: terms, label: t(`terms.${terms}` as "terms.net_30") })),
              ]}
              onChange={(event) => change({ paymentTerms: event.target.value })}
            />
          </div>
        </div>
        <p className="mt-2 text-caption text-muted">{t("proposal.terms_help")}</p>
      </div>

      {/* ── Scope ────────────────────────────────────────────────────────── */}
      <div className="rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${ids.scope}-title`} className="text-h3 text-ink">
            {t("proposal.scope_title")}
          </h3>
          <span className="text-caption text-muted">{t("proposal.from_sheet_edit")}</span>
        </div>
        {service ? (
          <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 text-caption">
            <dt className="text-muted">{service.turnaround.label}</dt>
            <dd className={service.turnaround.value ? "text-ink" : "text-muted"}>
              {service.turnaround.value ?? t("proposal.turnaround_none")}
            </dd>
            <dd className="text-muted">{t("proposal.turnaround_note")}</dd>
          </dl>
        ) : null}
        <div className="mt-3 space-y-1">
          <Label htmlFor={ids.scope} requirement="required" requirementLabel={t("field.required")}>
            {t("proposal.scope_label")}
          </Label>
          <Textarea
            id={ids.scope}
            rows={4}
            limit={PROPOSAL_TEXT_MAX}
            counterLabel={(used, limit) => t("field.counter", { used, limit })}
            value={value.scope}
            invalid={errorFor("scope") !== undefined}
            aria-describedby={`${ids.scope}-error`}
            onChange={(event) => change({ scope: event.target.value }, "scope")}
          />
          <FieldError id={`${ids.scope}-error`} reserveSpace={false}>
            {errorFor("scope")}
          </FieldError>
        </div>
        <div className="mt-3 grid gap-3 @md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor={ids.deliverable} requirement="optional" requirementLabel={t("field.optional")}>
              {t("proposal.deliverable_label")}
            </Label>
            <Input
              id={ids.deliverable}
              value={value.deliverable}
              invalid={errorFor("deliverable") !== undefined}
              aria-describedby={`${ids.deliverable}-error`}
              maxLength={PROPOSAL_LINE_MAX + 50}
              onChange={(event) => change({ deliverable: event.target.value }, "deliverable")}
            />
            <FieldError id={`${ids.deliverable}-error`} reserveSpace={false}>
              {errorFor("deliverable")}
            </FieldError>
          </div>
          <div className="space-y-1">
            <Label htmlFor={ids.deliveredWhere} requirement="optional" requirementLabel={t("field.optional")}>
              {t("proposal.delivered_where_label")}
            </Label>
            <Input
              id={ids.deliveredWhere}
              value={value.deliveredWhere}
              invalid={errorFor("deliveredWhere") !== undefined}
              aria-describedby={`${ids.deliveredWhere}-error`}
              maxLength={PROPOSAL_LINE_MAX + 50}
              onChange={(event) => change({ deliveredWhere: event.target.value }, "deliveredWhere")}
            />
            <FieldError id={`${ids.deliveredWhere}-error`} reserveSpace={false}>
              {errorFor("deliveredWhere")}
            </FieldError>
          </div>
        </div>
      </div>

      {/* ── Excluded ─────────────────────────────────────────────────────── */}
      <div className="rounded-card border border-warn-line bg-warn-surface p-5"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id={`${ids.exclusions}-title`} className="text-h3 text-warn-ink">
            {t("proposal.exclusions_title")}
          </h3>
          <span className="text-caption text-warn-ink">{t("proposal.from_sheet_carried")}</span>
        </div>
        <div className="mt-3 space-y-1">
          <label htmlFor={ids.exclusions} className="sr-only">
            {t("proposal.exclusions_title")}
          </label>
          {/*
             No counter here: it would sit on the warn surface in a colour that
             fails the contrast floor there, and 4,000 characters of exclusions is
             a ceiling nobody writing a list reaches. The send refuses past it.
          */}
          <Textarea
            id={ids.exclusions}
            rows={3}
            placeholder={t("proposal.exclusions_placeholder")}
            value={value.exclusions}
            invalid={errorFor("exclusions") !== undefined}
            aria-describedby={`${ids.exclusions}-note ${ids.exclusions}-error`}
            onChange={(event) => change({ exclusions: event.target.value }, "exclusions")}
          />
          <FieldError id={`${ids.exclusions}-error`} reserveSpace={false}>
            {errorFor("exclusions")}
          </FieldError>
        </div>
        <p id={`${ids.exclusions}-note`} className="mt-2 text-caption text-warn-ink">
          {t("proposal.exclusions_travel")}
        </p>
      </div>

      {/* ── Send ─────────────────────────────────────────────────────────── */}
      {error ? (
        <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
          <Alert tone="bad" live="assertive" fix={errorIsFields ? t("proposal.fix_marked") : t("proposal.fix_retry")}>
            {error}
          </Alert>
        </div>
      ) : null}

      {lateSince !== null ? (
        <p className="text-caption text-muted">
          {t("proposal.late", { when: formatRelative(new Date(lateSince)) })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" loading={sending} disabled={blocked} onClick={send}>
          {revision > 1 ? t("proposal.send_revision", { revision }) : t("proposal.send")}
        </Button>
        <Button type="button" variant="secondary" size="lg" disabled={sending || saving} onClick={saveNow}>
          {t("proposal.save_draft")}
        </Button>
        <p className="min-w-0 flex-1 text-caption text-muted">
          {others > 0
            ? t("proposal.others_note", { count: others, formatted: formatCount(others) })
            : t("proposal.only_you_note")}
        </p>
      </div>
      <p aria-live="polite" className="text-caption text-muted">
        {saving
          ? t("lead.draft_saving")
          : savedAt
            ? t("proposal.draft_saved", { when: formatRelative(new Date(savedAt)) })
            : ""}
      </p>
    </div>
  );
}
