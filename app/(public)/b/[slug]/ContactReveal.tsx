"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { Button, FieldError, IconButton, Input } from "@/components/primitives";
import { Check, Close } from "@/components/primitives/icons";
import { cn } from "@/lib/cn";
import { RevealContext, type RevealApi } from "@/components/storefront/MaskedNumber";
import { t } from "@/lib/i18n";
import {
  LEAD_PROBLEM_KEY,
  readLeadFields,
  type LandlineNumber,
  type LeadFieldsInput,
  type LeadProblems,
} from "@/lib/contact/lead-form";
import {
  recordWhatsAppAction,
  revealedStateAction,
  revealLandlineAction,
  submitLandlineLeadAction,
  type RevealActionResult,
} from "./actions";

/**
 * Board `1d` amendment — the landline, masked, then asked for, then revealed,
 * in place on the storefront rather than on a page of its own (the deleted
 * `13a`).
 *
 * ```
 * MASKED    [Request a quote] [WhatsApp] [04 88• ••••] [♡]
 * FORM      a dialog over the storefront, three fields, Show the number
 * REVEALED  [Request a quote] [WhatsApp] [Call 04 883 4120] [♡] + the note
 * ```
 *
 * One provider for a listing, because the chip, the note under the identity
 * block, the phone-width bar and the branches tab's numbers are one state: a
 * buyer who reveals on one of them has revealed on all of them, for the session.
 *
 * ## What is and is not in the page (`B2`)
 *
 * The masked text (`04 88• ••••`) is computed by the server and is all a
 * visitor who has not asked is sent. The numbers arrive in a server action's
 * reply, or — for a buyer who already revealed in this session — in the render
 * the server did for them alone. A number hidden with CSS would not be masked.
 *
 * ## Only the landline masks (`B4`)
 *
 * WhatsApp is a `wa.me` link that opens the chat. It is never wired to this
 * gate; opening it is recorded and nothing else.
 */

function useReveal(): RevealApi {
  const api = useContext(RevealContext);
  if (!api) throw new Error("ContactReveal: a contact control rendered outside its provider");
  return api;
}

export interface LeadPrefillProps {
  name: string;
  email: string;
  mobile: string;
}

export interface ContactRevealProps {
  businessId: string;
  supplierName: string;
  /**
   * `B10` — no lead from this visitor or account on this listing yet.
   *
   * `false` also where the route could not ask — a cached page — in which case
   * a click tries the reveal first and the server answers whether the form is
   * needed, with what it opens with.
   */
  formRequired: boolean;
  /** `B12` — what the form opens with. */
  prefill: LeadPrefillProps | null;
  /** Revealed earlier in this session: the numbers, rendered for this buyer alone. */
  initial: { numbers: Record<string, LandlineNumber>; headLocationId: string | null } | null;
  /** `contact.reveal_note`, the paired string's half for this business. */
  note: string;
  /** The privacy policy, linked from the form. */
  privacyHref: string;
  /**
   * For a route cached across readers, which cannot render one buyer's revealed
   * state: ask once after load, and only where the browser holds a session.
   */
  resolveOnMount?: boolean;
  children: React.ReactNode;
}

const SESSION_COOKIE_PRESENT = /(?:^|;\s*)bl_rsid=/;

export function ContactReveal({
  businessId,
  supplierName,
  formRequired,
  prefill,
  initial,
  note,
  privacyHref,
  resolveOnMount = false,
  children,
}: ContactRevealProps) {
  const [revealed, setRevealed] = useState(initial);
  const [prefillState, setPrefill] = useState(prefill);
  const [needsForm, setNeedsForm] = useState(formRequired);
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusId = useId();
  const focusAfterReveal = useRef(false);
  const whatsAppSent = useRef(false);

  const accept = useCallback((result: Extract<RevealActionResult, { ok: true }>) => {
    setRevealed({ numbers: result.numbers, headLocationId: result.headLocationId });
    setNeedsForm(false);
    focusAfterReveal.current = true;
  }, []);

  useEffect(() => {
    if (!resolveOnMount || initial || !SESSION_COOKIE_PRESENT.test(document.cookie)) return;
    let live = true;
    void revealedStateAction({ businessId }).then((state) => {
      if (live && state) setRevealed(state);
    });
    return () => {
      live = false;
    };
  }, [resolveOnMount, initial, businessId]);

  // Once the dialog has closed on a reveal, focus lands on the number it revealed
  // rather than on the page's body, where the replaced button left it.
  useEffect(() => {
    if (!focusAfterReveal.current || open || !revealed) return;
    focusAfterReveal.current = false;
    document.getElementById(focusId)?.focus();
  }, [revealed, open, focusId]);

  const request = useCallback(
    (from: HTMLElement | null) => {
      if (revealed) return;
      returnFocus.current = from;
      setFailure(null);
      if (needsForm) {
        setOpen(true);
        return;
      }
      startTransition(async () => {
        const result = await revealLandlineAction({ businessId, referrer: document.referrer || null });
        if (result.ok) accept(result);
        else if (result.reason === "form_required") {
          if (result.prefill) setPrefill(result.prefill);
          setNeedsForm(true);
          setOpen(true);
        } else {
          setFailure(failureWords(result));
          setOpen(true);
        }
      });
    },
    [revealed, needsForm, businessId, accept],
  );

  const api = useMemo<RevealApi>(
    () => ({
      numbers: revealed?.numbers ?? null,
      headLocationId: revealed?.headLocationId ?? null,
      pending,
      request,
      focusId,
      note,
      whatsAppOpened: () => {
        // Once per page: with no session cookie, nothing on the server deduplicates it.
        if (whatsAppSent.current) return;
        whatsAppSent.current = true;
        void recordWhatsAppAction({ businessId, referrer: document.referrer || null });
      },
    }),
    [revealed, pending, request, focusId, note, businessId],
  );

  return (
    <RevealContext.Provider value={api}>
      {children}
      <LeadGateDialog
        open={open}
        onDismiss={() => {
          // `B11`: a closed dialog writes nothing. What was typed stays, in
          // case the buyer opens it again.
          setOpen(false);
          returnFocus.current?.focus();
        }}
        supplierName={supplierName}
        prefill={prefillState}
        privacyHref={privacyHref}
        failure={failure}
        formless={!needsForm}
        onSubmit={async (fields) => {
          const result = await submitLandlineLeadAction({
            businessId,
            ...fields,
            referrer: document.referrer || null,
          });
          if (result.ok) {
            accept(result);
            setOpen(false);
            return null;
          }
          if (result.reason === "invalid") return { problems: result.problems, failure: null };
          return { problems: {}, failure: failureWords(result) };
        }}
      />
    </RevealContext.Provider>
  );
}

function failureWords(result: Exclude<RevealActionResult, { ok: true }>): string {
  switch (result.reason) {
    case "rate_limited":
      return t("contact.error.rate_limited", { minutes: Math.max(1, Math.ceil(result.retryAfterS / 60)) });
    case "no_landline":
      return t("contact.error.no_landline");
    default:
      return t("contact.error.unavailable");
  }
}

/* ── The chips ───────────────────────────────────────────────────────────── */

export interface ContactActionsProps {
  /** The masked head-office landline, from `maskPhone` on the server. Null: no landline, no chip. */
  masked: string | null;
  /** `https://wa.me/…`, or null where the seller published no WhatsApp. */
  whatsAppHref: string | null;
  /** The composer's trigger, rendered by the server page. */
  enquire: React.ReactNode;
  /** The save control. Row layout only. */
  saveAction?: React.ReactNode;
  /** `row` in board 1d's identity block, `bar` pinned to the bottom below `md`. */
  layout: "row" | "bar";
}

/**
 * The action row, in the order board 1d sets: the quote first because it is
 * what the page is for, then WhatsApp, the landline and save.
 *
 * The same controls twice at opposite breakpoints, hidden with `display` by the
 * caller, so exactly one set is in the accessibility tree at any width. Only the
 * row carries the focus id — a hidden element cannot take focus.
 */
export function ContactActions({ masked, whatsAppHref, enquire, saveAction, layout }: ContactActionsProps) {
  const reveal = useReveal();
  const head = reveal.numbers && reveal.headLocationId ? reveal.numbers[reveal.headLocationId] : null;

  const whatsapp = whatsAppHref ? (
    <a
      href={whatsAppHref}
      target="_blank"
      rel="noopener noreferrer"
      onClick={reveal.whatsAppOpened}
      className={cn(
        layout === "bar"
          ? "inline-flex h-11 w-full items-center justify-center rounded-ctl px-3 text-body"
          : "inline-flex h-9 items-center rounded-ctl px-3.5 text-body-sm",
        "border border-line-strong bg-card font-medium text-ink hover:bg-fill",
        "focus-visible:outline-none focus-visible:shadow-focus",
      )}
    >
      {t("storefront.whatsapp")}
    </a>
  ) : null;

  const landline =
    masked === null ? null : head ? (
      /*
         `B5` — a `tel:` link, not a copy button. It still reads as a number on
         a desktop, where nothing dials, and the green is the state changing
         rather than decoration: the same chip, answered.
      */
      <a
        id={layout === "row" ? reveal.focusId : undefined}
        href={`tel:${head.tel}`}
        aria-label={t("contact.reveal_cta", { number: head.display })}
        className={cn(
          layout === "bar"
            ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-ctl px-3 text-body"
            : "inline-flex h-9 items-center gap-2 rounded-ctl px-3.5 text-body-sm",
          "border border-moss bg-ok-wash font-medium text-ok-ink hover:bg-ok-surface",
          "focus-visible:outline-none focus-visible:shadow-focus",
        )}
      >
        {layout === "row" && <span aria-hidden>{t("contact.call")}</span>}
        <span aria-hidden className="font-mono font-normal tabular-nums text-ink">
          {head.display}
        </span>
      </a>
    ) : (
      <Button
        size={layout === "bar" ? "lg" : "md"}
        variant="secondary"
        block={layout === "bar"}
        loading={reveal.pending}
        aria-haspopup="dialog"
        // The row's visible text is the masked number, so its name carries it
        // (label in name); the bar's reads "Call" and keeps that as its name.
        aria-label={layout === "row" ? t("contact.masked_label", { masked }) : undefined}
        onClick={(event) => reveal.request(event.currentTarget)}
      >
        {layout === "bar" ? t("storefront.call") : <span className="font-mono tabular-nums">{masked}</span>}
      </Button>
    );

  if (layout === "bar") {
    return (
      <div data-action-bar="" className="fixed inset-x-0 bottom-0 z-40 flex gap-2 border-t border-line bg-card p-2 md:hidden">
        {whatsapp && <div className="flex-1">{whatsapp}</div>}
        {landline && <div className="flex-1">{landline}</div>}
        <div className="flex-1">{enquire}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {enquire}
      {whatsapp}
      {landline}
      {saveAction}
    </div>
  );
}

/**
 * The note under the identity block (`B8`).
 *
 * The buyer's half of `contact_reveal`: what was recorded, said plainly, which
 * is what keeps masking from reading as a growth trick. Not a toast — no close
 * button, no timer — and nothing of the seller's telemetry: no source, no
 * channel, no time.
 *
 * It first appears while the dialog is still over the page, so the tab row it
 * moves down moves behind the scrim, on the buyer's own submit.
 */
export function RevealNote() {
  const reveal = useReveal();
  if (!reveal.numbers) return null;
  return (
    <div className="mt-4 flex items-start gap-2.5 rounded-card border border-ok-line bg-ok-surface px-3.5 py-2.5">
      <span aria-hidden className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-ok text-on-ink">
        <Check size={10} />
      </span>
      <p className="text-body-sm text-ok-ink">{reveal.note}</p>
    </div>
  );
}

/**
 * The expanded branch card's *Call branch* action — the same gate as the
 * number beside it, drawn as the card's secondary action.
 */
export function BranchCall({
  locationId,
  label,
  className,
}: {
  locationId: string;
  label: string;
  className: string;
}) {
  const reveal = useReveal();
  const number = reveal.numbers?.[locationId];
  if (number) {
    return (
      <a href={`tel:${number.tel}`} className={className}>
        {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      disabled={reveal.pending}
      onClick={(event) => reveal.request(event.currentTarget)}
      className={className}
    >
      {label}
    </button>
  );
}

/* ── The form ────────────────────────────────────────────────────────────── */

type SubmitReply = { problems: LeadProblems; failure: string | null } | null;

interface LeadGateDialogProps {
  open: boolean;
  onDismiss: () => void;
  supplierName: string;
  prefill: LeadPrefillProps | null;
  privacyHref: string;
  /** A refusal that is not about a field — the number could not be fetched. */
  failure: string | null;
  /** Opened only to say something went wrong on a returning visitor's reveal. */
  formless: boolean;
  onSubmit: (fields: LeadFieldsInput) => Promise<SubmitReply>;
}

/**
 * The dialog (`B13`, `B14`, `B16`).
 *
 * A native `<dialog>` opened with `showModal()`: the platform draws it in the
 * top layer, centred in the **viewport** whatever the page's scroll, traps
 * focus, makes the storefront behind it inert and closes it on `Esc`. The
 * render drew it absolutely inside a 1534px board, which a page has no use for.
 *
 * The scrim and blur are the `::backdrop`, with a solid scrim where
 * `backdrop-filter` is unsupported, and the page's scroll is locked while it is
 * open — both in `app/globals.css`, under `.lead-gate`.
 */
function LeadGateDialog({ open, onDismiss, formless, failure, ...form }: LeadGateDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      /*
         `showModal` focuses the first focusable element, which is the close
         button. React's `autoFocus` ran before the dialog was open and so did
         nothing; the element the form marks is focused here instead.
      */
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="lead-gate m-auto w-[calc(100vw-2rem)] max-w-[28.25rem] rounded-panel border border-line bg-card p-0 text-body shadow-overlay"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onDismiss();
      }}
    >
      {open && (
        <LeadGateForm
          {...form}
          titleId={titleId}
          failure={failure}
          formless={formless}
          onDismiss={onDismiss}
        />
      )}
    </dialog>
  );
}

export interface LeadGateFormProps {
  titleId: string;
  supplierName: string;
  prefill: LeadPrefillProps | null;
  privacyHref: string;
  failure: string | null;
  formless?: boolean;
  onDismiss: () => void;
  onSubmit: (fields: LeadFieldsInput) => Promise<SubmitReply>;
  /** Off in the gallery, where a specimen taking focus would scroll the page to it. */
  focusOnOpen?: boolean;
  /** Gallery only: a name of its own, so four specimens are not four forms of one name. */
  formLabel?: string;
  /** Gallery only: the problems a submit returned, drawn without submitting. */
  initialProblems?: LeadProblems;
  initialValues?: LeadFieldsInput;
}

/**
 * The card inside the dialog. Exported so the gallery can draw it in a frame
 * without a modal over the gallery.
 */
export function LeadGateForm({
  titleId,
  supplierName,
  prefill,
  privacyHref,
  failure: initialFailure,
  formless = false,
  onDismiss,
  onSubmit,
  focusOnOpen = true,
  formLabel,
  initialProblems = {},
  initialValues,
}: LeadGateFormProps) {
  const [values, setValues] = useState<LeadFieldsInput>(
    initialValues ?? { name: prefill?.name ?? "", email: prefill?.email ?? "", mobile: prefill?.mobile ?? "" },
  );
  const [problems, setProblems] = useState<LeadProblems>(initialProblems);
  const [failure, setFailure] = useState<string | null>(initialFailure);
  const [submitted, setSubmitted] = useState(Object.keys(initialProblems).length > 0);
  const [pending, startTransition] = useTransition();
  const prefilled = Boolean(prefill?.name && prefill.email && prefill.mobile);
  const ids = { name: useId(), email: useId(), mobile: useId(), nameError: useId(), emailError: useId(), mobileError: useId() };

  // Inline, on submit; then kept current as the buyer corrects a field that failed.
  const update = (key: keyof LeadFieldsInput, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (submitted) {
      const read = readLeadFields(next);
      setProblems(read.ok ? {} : read.problems);
    }
  };

  const problem = (key: keyof LeadProblems) => {
    const code = problems[key];
    return code ? t(LEAD_PROBLEM_KEY[code]) : undefined;
  };

  return (
    <div className="px-6 pb-6 pt-6 sm:px-7">
      <div className="flex items-start gap-3.5">
        <h2 id={titleId} className="min-w-0 flex-1 font-serif text-h1 text-ink">
          {t("contact.form_title")}
        </h2>
        <IconButton size="sm" label={t("contact.form_close")} icon={<Close size={14} />} onClick={onDismiss} />
      </div>

      {formless ? (
        <p role="alert" className="mt-4 text-body-sm text-bad-ink">
          {failure}
        </p>
      ) : (
        <form
          noValidate
          {...(formLabel ? { "aria-label": formLabel } : { "aria-labelledby": titleId })}
          className="mt-5 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
            setFailure(null);
            const read = readLeadFields(values);
            if (!read.ok) {
              setProblems(read.problems);
              const first = (["name", "email", "mobile"] as const).find((key) => read.problems[key]);
              if (first) document.getElementById(ids[first])?.focus();
              return;
            }
            setProblems({});
            startTransition(async () => {
              const reply = await onSubmit(values);
              if (!reply) return;
              setProblems(reply.problems);
              setFailure(reply.failure);
            });
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.name} className="text-caption font-medium text-body">
              {t("contact.form_name")}
            </label>
            <Input
              id={ids.name}
              size="lg"
              // The first empty field takes focus on open; a prefilled form
              // puts it on the one tap that confirms it (`B12`).
              data-autofocus={focusOnOpen && !prefilled ? "" : undefined}
              autoComplete="name"
              placeholder={t("contact.form_name_placeholder")}
              value={values.name}
              invalid={Boolean(problems.name)}
              aria-describedby={ids.nameError}
              onChange={(event) => update("name", event.target.value)}
            />
            <FieldError id={ids.nameError} reserveSpace={false}>
              {problem("name")}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.email} className="text-caption font-medium text-body">
              {t("contact.form_email")}
            </label>
            <Input
              id={ids.email}
              size="lg"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              placeholder={t("contact.form_email_placeholder")}
              value={values.email}
              invalid={Boolean(problems.email)}
              aria-describedby={ids.emailError}
              onChange={(event) => update("email", event.target.value)}
            />
            <FieldError id={ids.emailError} reserveSpace={false}>
              {problem("email")}
            </FieldError>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={ids.mobile} className="text-caption font-medium text-body">
              {t("contact.form_mobile")}
            </label>
            {/*
               A fixed +971 beside the field, as drawn. The prefix is part of
               the label's meaning rather than the value, so it is outside the
               input and read out through the description.
            */}
            <div
              className={cn(
                "flex h-11 w-full items-center rounded-ctl border bg-card text-body",
                "transition-colors duration-120 ease-out",
                problems.mobile
                  ? "border-bad-line-strong focus-within:border-bad focus-within:shadow-focus-danger"
                  : "border-line-strong focus-within:border-moss focus-within:shadow-focus",
              )}
            >
              <span aria-hidden className="shrink-0 pl-3 pr-2.5 font-mono text-body-sm text-body">
                {t("contact.form_mobile_prefix")}
              </span>
              <span aria-hidden className="h-[1.125rem] w-px shrink-0 bg-line" />
              <input
                id={ids.mobile}
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                placeholder={t("contact.form_mobile_placeholder")}
                value={values.mobile}
                aria-invalid={Boolean(problems.mobile) || undefined}
                aria-describedby={ids.mobileError}
                onChange={(event) => update("mobile", event.target.value)}
                className="h-full min-w-0 flex-1 rounded-r-ctl bg-transparent px-3 text-ink placeholder:text-faint focus-visible:outline-none"
              />
            </div>
            <FieldError id={ids.mobileError} reserveSpace={false}>
              {problem("mobile")}
            </FieldError>
          </div>

          {failure && (
            <p role="alert" className="text-body-sm text-bad-ink">
              {failure}
            </p>
          )}

          <div className="mt-1">
            <Button
              type="submit"
              size="lg"
              block
              loading={pending}
              data-autofocus={focusOnOpen && prefilled ? "" : undefined}
            >
              {t("contact.form_submit")}
            </Button>
          </div>

          {/*
             `Q1`, answered: the supplier receives the three fields. The buyer
             is told so on the form, before the tap that sends them, because a
             lead the buyer did not know was going out is not one to hand over.
          */}
          <p className="text-caption text-muted">
            {t("contact.form_consent", { supplier: supplierName })}{" "}
            <a href={privacyHref} className="font-medium text-brand-ink underline-offset-2 hover:underline">
              {t("contact.form_privacy")}
            </a>
          </p>
        </form>
      )}
    </div>
  );
}
