"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import { Button, Checkbox, Input } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { signUpAction } from "../actions";
import { AuthFailure } from "./failures";
import type { SignUpFormState } from "./signup-state";

/**
 * Board 7a, state two — one account, two roles.
 *
 * **Which door, not which product** (`B1`). The two cards are a radio pair and
 * the choice decides where the account lands: buying goes to the buyer account,
 * listing to the claim flow. Both land on the same account, and the other role
 * is added later without a second login — the lede says so, because a supplier
 * who buys valves should not wonder whether they need another account to do it.
 *
 * **Mobile beside full name, not below email.** Mobile is the primary identity,
 * with `+971` already in the field. Work email is collected too (Q5); when the
 * platform cannot deliver a code to mobiles, the code goes there instead and the
 * verify screen says so.
 *
 * **Terms are a box, and the box is a record** (`B10`). Ticking it stores the
 * terms and privacy versions on the page today and the moment the form was sent.
 *
 * `useActionState`, so a refusal keeps what was typed without putting a name, a
 * mobile and an email into a URL. `key` remounts the fields on each answer so
 * their defaults are the values the server read back.
 */
export function SignUpForm({
  initial,
  next,
  autoFocus = true,
}: {
  initial: SignUpFormState;
  next: string | null;
  /** Off in the gallery, where several forms share one page. */
  autoFocus?: boolean;
}) {
  const [state, action, pending] = useActionState(signUpAction, initial);
  // Ids from React rather than literals, so two of these on one page — the
  // gallery draws the empty and refused states side by side — never share one.
  const uid = useId();
  const ids = { fullName: `${uid}-name`, phone: `${uid}-phone`, email: `${uid}-email` };
  const { values } = state;
  const error = state.error ?? undefined;

  return (
    <form action={action} className="space-y-5" noValidate>
      <AuthFailure
        error={error}
        retry={state.retry === null ? undefined : String(state.retry)}
        limit={state.limit === null ? undefined : String(state.limit)}
        restartHref="/signup"
        onRequest
      />

      <fieldset key={`intent-${JSON.stringify(state)}`} className="min-w-0 border-0 p-0">
        <legend className="sr-only">{t("auth.signup.intent")}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <IntentCard
            value="buying"
            title={t("auth.signup.buying")}
            description={t("auth.signup.buying_hint")}
            defaultChecked={values.intent === "buying"}
          />
          <IntentCard
            value="listing"
            title={t("auth.signup.listing")}
            description={t("auth.signup.listing_hint")}
            defaultChecked={values.intent === "listing"}
          />
        </div>
      </fieldset>

      <div key={`fields-${JSON.stringify(state)}`} className="space-y-4 sm:max-w-[26rem]">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id={ids.fullName} label={t("auth.signup.name")}>
            <Input
              id={ids.fullName}
              name="fullName"
              autoComplete="name"
              required
              autoFocus={autoFocus}
              defaultValue={values.fullName}
              invalid={error === "name_required"}
            />
          </Field>
          <Field id={ids.phone} label={t("auth.signup.mobile")}>
            <Input
              id={ids.phone}
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              defaultValue={values.phone}
              invalid={error === "invalid_phone" || error === "phone_taken"}
            />
          </Field>
        </div>

        <Field id={ids.email} label={t("auth.signup.email")}>
          <Input
            id={ids.email}
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={values.email}
            invalid={error === "invalid_email" || error === "email_taken"}
          />
        </Field>

        <Checkbox
          name="terms"
          defaultChecked={state.termsAccepted}
          invalid={error === "terms_required"}
          label={<TermsLabel />}
        />

        {next ? <input type="hidden" name="next" value={next} /> : null}

        <Button type="submit" block loading={pending} disabled={pending}>
          {t("auth.signup.submit")}
        </Button>

        {error === "email_taken" || error === "phone_taken" ? (
          <p className="text-body-sm text-body">
            <Link
              href="/signin"
              className="rounded-tag text-moss underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signup.signin")}
            </Link>
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-body-sm text-ink">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * A role card. Selection is a 1.5px moss border and a moss wash, never a shadow
 * (design-system §Interaction rules) — drawn from `:has(:checked)`, so the card
 * follows the native radio with no state of its own and works before hydration.
 */
function IntentCard({
  value,
  title,
  description,
  defaultChecked,
}: {
  value: "buying" | "listing";
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-card border-[1.5px] border-line bg-card p-4",
        "transition-colors duration-120 ease-out hover:border-moss-muted",
        "focus-within:shadow-focus has-[:checked]:border-moss has-[:checked]:bg-moss-wash",
      )}
    >
      <input
        type="radio"
        name="intent"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 size-4 shrink-0 accent-[var(--moss)] focus-visible:outline-none"
      />
      <span className="flex flex-col gap-1">
        <span className="text-body text-ink">{title}</span>
        <span className="text-caption text-body">{description}</span>
      </span>
    </label>
  );
}

/** "I accept the terms and the privacy policy", with both documents linked. */
function TermsLabel() {
  const MARK = "\u0001";
  const sentence = t("auth.signup.terms_label", { terms: `${MARK}terms${MARK}`, privacy: `${MARK}privacy${MARK}` });
  const link = (href: string, label: string) => (
    <Link
      key={href}
      href={href}
      target="_blank"
      rel="noopener"
      className="rounded-tag text-ink underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
    >
      {label}
    </Link>
  );
  return (
    <>
      {sentence.split(MARK).map((part, index) =>
        part === "terms"
          ? link("/terms", t("auth.signup.terms_link"))
          : part === "privacy"
            ? link("/privacy", t("auth.signup.privacy_link"))
            : <span key={index}>{part}</span>,
      )}
    </>
  );
}
