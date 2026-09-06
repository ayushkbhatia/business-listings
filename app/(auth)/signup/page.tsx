import Link from "next/link";
import { Button, Checkbox, Input } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { asAudience } from "@/app/(public)/_entry/audience";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { signUpAction } from "../actions";

/**
 * Board 7a, state two: one account, two roles, either addable later.
 *
 * The intent is captured, not the role. `seller_owner` is scoped to a business
 * and there is no business until the claim flow in handoff 3 attaches one, so
 * granting it here would grant it over nothing.
 *
 * `?as=` preselects which box is ticked, for somebody arriving from
 * `/for-buyers` or `/list-your-business`. It is a default, not a decision:
 * both boxes remain, either can be unticked, and the form still refuses to
 * submit with neither. Landing a supplier on a form pre-ticked "buying" is the
 * kind of small wrongness that makes a person distrust the rest of the page.
 */
export const metadata = { title: t("auth.signup.title") };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const audience = asAudience(one("as"));
  const buying = audience === null || audience === "buyer";
  const listing = audience === "supplier";

  return (
    <AuthCard
      title={t("auth.signup.title")}
      lede={t("auth.signup.lede")}
      footer={
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-x-2 text-muted">
            {t("auth.signup.have_account")}
            <Link
              href="/signin"
              className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signup.signin")}
            </Link>
          </p>
          <p className="text-caption text-muted">{t("auth.signup.no_account_needed")}</p>
        </div>
      }
    >
      <form action={signUpAction} className="space-y-4">
        <AuthFailure
          {...{ error: one("error"), retry: one("retry"), since: one("since"), limit: one("limit") }}
          restartHref="/signup"
          onRequest
        />

        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-body-sm text-ink">
            {t("auth.signup.name")}
          </label>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            autoFocus
            aria-describedby="name-hint"
            invalid={one("error") === "name_required"}
          />
          <p id="name-hint" className="mt-1.5 text-caption text-muted">
            {t("auth.signup.name_hint")}
          </p>
        </div>

        <div>
          <label htmlFor="identifier" className="mb-1.5 block text-body-sm text-ink">
            {t("auth.signup.identifier")}
          </label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            inputMode="tel"
            autoComplete="username"
            required
            defaultValue={one("to") ?? ""}
            aria-describedby="signup-identifier-hint"
            invalid={one("error") === "invalid_identifier"}
          />
          <p id="signup-identifier-hint" className="mt-1.5 text-caption text-muted">
            {t("auth.signup.identifier_hint")}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1.5 text-body-sm text-ink">{t("auth.signup.intent")}</legend>
          <div className="space-y-2">
            <Checkbox name="wantsToBuy" defaultChecked={buying} label={t("auth.signup.buying")} />
            <Checkbox name="wantsToList" defaultChecked={listing} label={t("auth.signup.listing")} />
          </div>
          <p className="mt-1.5 text-caption text-muted">{t("auth.signup.intent_hint")}</p>
        </fieldset>

        {/*
          No `from` here, deliberately. A signup refusal has to land back on a
          signup form — the entry pages carry a sign-in form, and returning
          somebody there after a failed signup would silently change what they
          were doing. The entry pages link in with `?as=` only.
        */}
        {one("next") ? <input type="hidden" name="next" value={one("next")} /> : null}

        <Button type="submit" block>
          {t("auth.signup.submit")}
        </Button>

        <p className="text-caption text-muted">{t("auth.legal")}</p>
      </form>
    </AuthCard>
  );
}
