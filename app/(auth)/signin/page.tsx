import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { Button, Input } from "@/components/primitives";
import { checkThrottle } from "@/lib/auth/attempts";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { isSafeNext } from "@/lib/auth/next-path";
import { retryAfterSeconds } from "@/lib/auth/throttle";
import { t } from "@/lib/i18n";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { passwordSignInAction, signInAction } from "../actions";

/**
 * Board 7a, state one — sign in.
 *
 * **Password first, as drawn.** The board argues for OTP-first and renders
 * password-first, and leaves it as drawn until the SMS cost per sign-in and UAE
 * carrier deliverability are known (Q1). The code is the button directly
 * underneath, on the same form and the same identifier, so an account with no
 * password (`B3`) is one click from signing in and never sees a dead end.
 *
 * **One form, two submit buttons.** "Sign in" posts the password; "Send me a
 * one-time code" posts the same identifier to the code action through
 * `formAction`. The password field is not `required` for that reason, and the
 * server says so when it is empty.
 *
 * **A password lockout leaves the code open** (`B5`). While the password door is
 * shut the password field is disabled, the notice says fifteen minutes or a code,
 * and the code button becomes the primary action — the backend counts the two
 * separately, so the offer is one it honours.
 */
export const metadata = { title: t("auth.signin.title") };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const next = one("next");
  const safeNext = next && isSafeNext(next) ? next : null;

  /*
     The lock is read from the record, not the query string. A lockout in the
     URL is a past event: reloaded after fifteen minutes it would still disable
     a password field the server now accepts, and a fresh visit to `/signin`
     after five wrong passwords would offer a field that is going to refuse.
  */
  const typed = one("to") ? normaliseIdentifier(one("to") ?? "") : null;
  const gate = typed ? await checkThrottle(typed.value, "password_verify") : { allowed: true as const };
  const locked = !gate.allowed;
  const urlError = one("error");
  const error = locked ? "password_locked" : urlError === "password_locked" ? undefined : urlError;
  const retry = locked ? String(retryAfterSeconds(gate)) : one("retry");
  const passwordSaved = one("notice") === "password_saved";
  const wantsEmail = one("use") === "email";

  return (
    <AuthCard
      eyebrow={t("auth.signin.eyebrow")}
      title={t("auth.signin.heading")}
      footer={
        <p className="flex flex-wrap items-center gap-x-1.5 text-body">
          {t("auth.signin.no_account")}
          <Link
            href="/signup?as=supplier"
            className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.signin.list_free")}
          </Link>
        </p>
      }
    >
      <form action={passwordSignInAction} className="space-y-4">
        {passwordSaved ? (
          <Alert tone="ok" live="polite">
            {t("auth.signin.password_saved")}
          </Alert>
        ) : null}

        <AuthFailure
          error={error}
          retry={retry}
          limit={one("limit")}
          left={one("left")}
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
            inputMode={wantsEmail ? "email" : "text"}
            autoComplete="username"
            required
            autoFocus
            defaultValue={wantsEmail ? "" : (one("to") ?? "")}
            aria-describedby="identifier-hint"
            invalid={error === "invalid_identifier"}
          />
          <p id="identifier-hint" className="mt-1.5 text-caption text-body">
            {wantsEmail ? t("auth.signin.identifier_hint_email") : t("auth.signin.identifier_hint")}
          </p>
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="block text-body-sm text-ink">
              {t("auth.signin.password")}
            </label>
            <Link
              href="/reset"
              className="rounded-tag text-body-sm text-body underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signin.forgot")}
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            disabled={locked}
            invalid={error === "password_incorrect" || error === "password_required"}
          />
        </div>

        {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}

        <Button type="submit" block variant={locked ? "secondary" : "primary"} disabled={locked}>
          {t("auth.signin.submit_password")}
        </Button>

        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="font-mono text-eyebrow uppercase text-muted">{t("auth.signin.or")}</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <Button type="submit" block variant={locked ? "primary" : "secondary"} formAction={signInAction} formNoValidate>
          {t("auth.signin.submit_code")}
        </Button>
      </form>
    </AuthCard>
  );
}
