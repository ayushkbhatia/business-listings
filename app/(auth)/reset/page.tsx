import Link from "next/link";
import { cookies } from "next/headers";
import { Alert } from "@/components/display/Alert";
import { Button, Input } from "@/components/primitives";
import { readResetGrant, RESET_COOKIE } from "@/lib/auth/reset";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { NewPasswordField } from "../_components/NewPasswordField";
import { requestResetAction, setPasswordAction } from "../actions";

/**
 * Board 7a, state four — reset, and the failure states it carries.
 *
 * Two stages on one route:
 *
 *   - **Ask.** Mobile or email. A mobile gets a code (`B2`: recovery works from
 *     the mobile alone), an email gets a link that lasts an hour and works once
 *     (`B6`). Neutral either way about whether an account exists.
 *   - **Set a new password.** Reached only with a grant in this browser's
 *     cookie, set by the emailed link or by a verified code. No grant, no field:
 *     the page says the link expired and offers another, rather than drawing a
 *     password field that is going to refuse.
 *
 * The three failures the board draws land here as well as on sign-in — link
 * expired, too many attempts, suspended — because this is where the link was
 * going, and a locked-out or suspended person is likeliest to try here next.
 */
export const metadata = { title: t("auth.reset.title") };
export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);
  const error = one("error");

  if (one("stage") === "set") {
    const grant = await readResetGrant((await cookies()).get(RESET_COOKIE)?.value);

    if (!grant) {
      return (
        <AuthCard eyebrow={t("auth.reset.eyebrow")} title={t("auth.reset.title")}>
          <AuthFailure error="link_expired" restartHref="/reset" />
        </AuthCard>
      );
    }

    return (
      <AuthCard
        eyebrow={t("auth.reset.eyebrow")}
        title={t("auth.reset.set_title")}
        {...(grant.masked ? { lede: t("auth.reset.set_for", { masked: grant.masked }) } : {})}
      >
        <form action={setPasswordAction} className="space-y-4">
          <AuthFailure
            error={error}
            problem={one("problem")}
            length={one("length")}
            restartHref="/reset"
          />
          <NewPasswordField identifiers={grant.identifiers} invalid={error === "password_rejected"} autoFocus />
          <Button type="submit" block>
            {t("auth.reset.save")}
          </Button>
        </form>
      </AuthCard>
    );
  }

  const sent = one("sent");
  const wantsEmail = one("use") === "email";

  return (
    <AuthCard
      eyebrow={t("auth.reset.eyebrow")}
      title={t("auth.reset.title")}
      lede={t("auth.reset.lede")}
      footer={
        <Link
          href="/signin"
          className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("auth.reset.back")}
        </Link>
      }
    >
      <div className="space-y-4">
        <AuthFailure
          error={error}
          retry={one("retry")}
          limit={one("limit")}
          restartHref="/reset"
          onRequest
        />

        {sent ? (
          <Alert tone="info" live="polite" title={t("auth.reset.sent_title")}>
            {t("auth.reset.sent_body", { masked: sent })}
          </Alert>
        ) : null}

        <form action={requestResetAction} className="space-y-4">
          <div>
            <label htmlFor="identifier" className="mb-1.5 block text-body-sm text-ink">
              {t("auth.reset.identifier")}
            </label>
            <Input
              id="identifier"
              name="identifier"
              type="text"
              inputMode={wantsEmail ? "email" : "text"}
              autoComplete="username"
              required
              autoFocus
              defaultValue={wantsEmail ? "" : (one("to") ?? "")}
              aria-describedby="reset-identifier-hint"
              invalid={error === "invalid_identifier"}
            />
            <p id="reset-identifier-hint" className="mt-1.5 text-caption text-body">
              {wantsEmail ? t("auth.reset.identifier_hint_email") : t("auth.reset.identifier_hint")}
            </p>
          </div>
          <Button type="submit" block>
            {t("auth.reset.submit")}
          </Button>
        </form>
      </div>
    </AuthCard>
  );
}
