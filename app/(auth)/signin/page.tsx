import Link from "next/link";
import { Button, Input } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { signInAction } from "../actions";

/** Board 7a, state one. */
export const metadata = { title: t("auth.signin.title") };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  return (
    <AuthCard
      title={t("auth.signin.title")}
      lede={t("auth.signin.lede")}
      footer={
        <p className="flex flex-wrap items-center gap-x-2 text-muted">
          {t("auth.signin.no_account")}
          <Link
            href="/signup"
            className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.signin.create")}
          </Link>
        </p>
      }
    >
      <form action={signInAction} className="space-y-4">
        <AuthFailure
          {...{ error: one("error"), retry: one("retry"), since: one("since"), limit: one("limit") }}
          restartHref="/signin"
          onRequest
        />

        <div>
          <label htmlFor="identifier" className="mb-1.5 block text-body-sm text-ink">
            {t("auth.signin.identifier")}
          </label>
          <Input
            id="identifier"
            name="identifier"
            type="text"
            inputMode="tel"
            autoComplete="username"
            required
            autoFocus
            defaultValue={one("to") ?? ""}
            aria-describedby="identifier-hint"
            invalid={one("error") === "invalid_identifier"}
          />
          <p id="identifier-hint" className="mt-1.5 text-caption text-muted">
            {t("auth.signin.identifier_hint")}
          </p>
        </div>

        {one("next") ? <input type="hidden" name="next" value={one("next")} /> : null}

        <Button type="submit" block>
          {t("auth.signin.submit")}
        </Button>

        <p className="text-caption text-muted">
          <Link
            href="/reset"
            className="rounded-tag underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.signin.password_instead")}
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
