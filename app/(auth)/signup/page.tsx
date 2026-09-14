import Link from "next/link";
import { asAudience } from "@/app/(public)/_entry/audience";
import { isSafeNext } from "@/lib/auth/next-path";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { SignUpForm } from "../_components/SignUpForm";
import { initialSignUpState } from "../_components/signup-state";

/**
 * Board 7a, state two: one account, two roles, either addable later.
 *
 * The intent is captured, not the role. `seller_owner` is scoped to a business
 * and there is no business until the claim flow attaches one, so granting it
 * here would grant it over nothing — the choice decides where the account lands.
 *
 * `?as=` preselects a card, for somebody arriving from `/for-buyers` or
 * `/list-your-business`. It is a default, not a decision: the other card is one
 * click away. `?error=` is how "use email instead" on `/verify` reports a
 * refusal back here, since that action runs outside this form.
 */
export const metadata = { title: t("auth.signup.title") };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const intent = asAudience(one("as")) === "supplier" ? "listing" : "buying";
  const next = one("next");

  return (
    <AuthCard
      wide
      eyebrow={t("auth.signup.eyebrow")}
      title={t("auth.signup.title")}
      lede={t("auth.signup.lede")}
      footer={
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-x-1.5 text-body">
            {t("auth.signup.have_account")}
            <Link
              href={next && isSafeNext(next) ? `/signin?next=${encodeURIComponent(next)}` : "/signin"}
              className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signup.signin")}
            </Link>
          </p>
          <p className="text-caption text-body">{t("auth.signup.no_account_needed")}</p>
        </div>
      }
    >
      <SignUpForm
        initial={initialSignUpState({ intent, error: one("error") ?? null })}
        next={next && isSafeNext(next) ? next : null}
      />
    </AuthCard>
  );
}
