import Link from "next/link";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { checkThrottle } from "@/lib/auth/attempts";
import { isSafeNext } from "@/lib/auth/flow";
import { normaliseIdentifier } from "@/lib/auth/identity";
import { retryAfterSeconds } from "@/lib/auth/throttle";
import { AuthCard } from "../_components/AuthCard";
import { AuthNotice } from "../_components/AuthNotice";
import { AuthFailure } from "../_components/failures";
import { OTP_EXPIRY_MINUTES, OTP_LENGTH } from "@/lib/auth/constants";
import { OtpField } from "../_components/OtpField";
import { ResendButton } from "../_components/ResendButton";
import { resendAction, verifyAction } from "../actions";

/**
 * Board 7a, state three.
 *
 * The resend cooldown is read from the server rather than started at zero in
 * the browser, so reloading the page does not offer a fresh send. The same
 * policy refuses it either way; this only stops the button lying about it.
 */
export const metadata = { title: t("auth.verify.title") };
export const dynamic = "force-dynamic";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const one = (key: string) => (typeof params[key] === "string" ? params[key] : undefined);

  const to = one("to") ?? "";
  const identifier = normaliseIdentifier(to);

  /*
     Which door they came through. `/signin` is the default and always was;
     `/for-buyers`, `/list-your-business` and `/staff` post here too, and
     sending a supplier back to the plain sign-in page to start again drops
     them out of the flow they were reading. Validated as a same-origin path,
     the same as `next` — it is attacker-controlled and decides nothing but
     which page a link points at.
  */
  const fromParam = one("from");
  const from = fromParam && isSafeNext(fromParam) ? fromParam : "/signin";

  if (!identifier) {
    return (
      <AuthCard title={t("auth.verify.title")}>
        <AuthNotice
          tone="warn"
          title={t("auth.verify.no_identifier")}
          action={
            <Link
              href={from}
              className="rounded-tag underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signin.title")}
            </Link>
          }
        />
      </AuthCard>
    );
  }

  const masked = one("masked") ?? "";

  // Both throttles, read here rather than inferred from the query string. A
  // lockout in the URL is a past event; these are the current ones, so the
  // form is disabled exactly while it would be refused.
  const [resendGate, verifyGate] = await Promise.all([
    checkThrottle(identifier.value, "otp_request"),
    checkThrottle(identifier.value, "otp_verify"),
  ]);
  const cooldown = resendGate.allowed ? 0 : retryAfterSeconds(resendGate);
  const lockedOut = !verifyGate.allowed;

  return (
    <AuthCard
      title={t("auth.verify.title")}
      lede={
        masked
          ? t("auth.verify.sent_to", { masked, minutes: OTP_EXPIRY_MINUTES })
          : undefined
      }
      footer={
        <p className="flex flex-wrap items-center gap-x-2 text-muted">
          {t("auth.verify.wrong_number")}
          <Link
            href={from}
            className="rounded-tag text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.verify.start_again")}
          </Link>
        </p>
      }
    >
      <div className="space-y-4">
        <AuthFailure
          {...{
            error: lockedOut ? "too_many_attempts" : one("error"),
            retry: lockedOut ? String(retryAfterSeconds(verifyGate)) : one("retry"),
            since: one("since"),
            limit: one("limit"),
          }}
          restartHref={from}
        />

        <form action={verifyAction} className="space-y-4">
          <input type="hidden" name="identifier" value={identifier.value} />
          {one("next") ? <input type="hidden" name="next" value={one("next")} /> : null}
          {fromParam ? <input type="hidden" name="from" value={fromParam} /> : null}

          <OtpField
            autoFocus={!lockedOut}
            disabled={lockedOut}
            label={t("auth.verify.code")}
            hint={lockedOut ? t("auth.locked.help") : t("auth.verify.code_hint", { length: OTP_LENGTH })}
            invalid={one("error") === "code_incorrect"}
          />

          <Button type="submit" block disabled={lockedOut}>
            {t("auth.verify.submit")}
          </Button>
        </form>

        <form action={resendAction}>
          <input type="hidden" name="identifier" value={identifier.value} />
          {one("next") ? <input type="hidden" name="next" value={one("next")} /> : null}
          {fromParam ? <input type="hidden" name="from" value={fromParam} /> : null}
          <ResendButton initialSeconds={cooldown} />
        </form>
      </div>
    </AuthCard>
  );
}
