import Link from "next/link";
import { Button, Input } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { AuthNotice } from "../_components/AuthNotice";
import { AuthFailure } from "../_components/failures";
import { requestResetAction, setPasswordAction } from "../actions";

/**
 * Board 7a, state four, in three stages.
 *
 * Ask for a link · the link arrived and this is the new password · done. The
 * expired-link failure lands here too, because that is where the link was
 * going, and it is the state the step 2 checkpoint asks to see.
 *
 * A password is the second way in, not the first. Signing in with a code needs
 * none at all, and the copy says so rather than implying everyone needs one.
 */
export const metadata = { title: t("auth.reset.title") };

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  if (one("done")) {
    return (
      <AuthCard title={t("auth.reset.done_title")} lede={t("auth.reset.done_body")}>
        <Link
          href="/signin"
          className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("auth.reset.back")}
        </Link>
      </AuthCard>
    );
  }

  if (one("stage") === "set") {
    return (
      <AuthCard title={t("auth.reset.title")}>
        <form action={setPasswordAction} className="space-y-4">
          <AuthFailure
            {...{ error: one("error"), length: one("length") }}
            restartHref="/reset"
          />
          <div>
            <label htmlFor="password" className="mb-1.5 block text-body-sm text-ink">
              {t("auth.reset.new_password")}
            </label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              autoFocus
              aria-describedby="password-hint"
              invalid={one("error") === "too_short"}
            />
            <p id="password-hint" className="mt-1.5 text-caption text-muted">
              {t("auth.reset.new_password_hint")}
            </p>
          </div>
          <Button type="submit" block>
            {t("auth.reset.save")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  const sent = one("sent");

  return (
    <AuthCard
      title={t("auth.reset.title")}
      lede={t("auth.reset.lede")}
      footer={
        <Link
          href="/signin"
          className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("auth.reset.back")}
        </Link>
      }
    >
      <div className="space-y-4">
        <AuthFailure
          {...{ error: one("error"), retry: one("retry"), limit: one("limit") }}
          restartHref="/reset"
          onRequest
        />

        {sent ? (
          <AuthNotice
            live
            tone="info"
            title={t("auth.reset.sent_title")}
            body={t("auth.reset.sent_body", { masked: sent })}
          />
        ) : null}

        <form action={requestResetAction} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="mb-1.5 block text-body-sm text-ink">
              {t("auth.reset.email")}
            </label>
            <Input
              id="identifier"
              name="identifier"
              type="email"
              autoComplete="email"
              required
              autoFocus
              invalid={one("error") === "invalid_identifier"}
            />
          </div>
          <Button type="submit" block>
            {t("auth.reset.submit")}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
