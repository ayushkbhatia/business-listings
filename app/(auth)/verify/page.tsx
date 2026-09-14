import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { Button } from "@/components/primitives";
import { t } from "@/lib/i18n";
import { checkThrottle } from "@/lib/auth/attempts";
import { OTP_EXPIRY_MINUTES, OTP_LENGTH } from "@/lib/auth/constants";
import { isSafeNext } from "@/lib/auth/next-path";
import { maskIdentifier, normaliseIdentifier } from "@/lib/auth/identity";
import { retryAfterSeconds } from "@/lib/auth/throttle";
import { AuthCard } from "../_components/AuthCard";
import { AuthFailure } from "../_components/failures";
import { OtpField } from "../_components/OtpField";
import { ResendButton } from "../_components/ResendButton";
import { resendAction, useEmailInsteadAction, verifyAction } from "../actions";

/**
 * Board 7a, state three — the code, and mobile as the primary identity.
 *
 * Six boxes, a ten-minute expiry, a 24-second resend lock, and "use email
 * instead" as the secondary (`B4`). The resend lock is read from the server
 * rather than started at zero in the browser, so reloading does not offer a
 * fresh send; the same policy refuses it either way, and this stops the button
 * lying about it.
 *
 * **The carrier named is the one used.** The board reads "sent by SMS". Codes
 * to a mobile go out on WhatsApp (docs/auth-whatsapp-otp.md), and when mobiles
 * cannot be reached a sign-up's code goes to the email — so the sentence under
 * the heading says which actually happened rather than what was drawn.
 *
 * **A wrong code states the attempts left**, and the fifth is the lockout rather
 * than a screen reading "0 attempts left" above a form that still takes one.
 * An expired code and a wrong one are the same answer (see `verifyCode`), and a
 * redirect clears the digits either way.
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

  const identifier = normaliseIdentifier(one("to") ?? "");

  /*
     Which door they came through. `/signin` is the default; `/signup`,
     `/for-buyers`, `/list-your-business`, `/staff` and `/reset` send people
     here too, and "start again" should start again there. Validated as a
     same-origin path, the same as `next` — it is attacker-controlled and decides
     nothing but which page a link points at.
  */
  const fromParam = one("from");
  const purpose = one("purpose") === "reset" ? "reset" : "signin";
  const from = fromParam && isSafeNext(fromParam) ? fromParam : purpose === "reset" ? "/reset" : "/signin";
  const next = one("next");
  const safeNext = next && isSafeNext(next) ? next : null;

  if (!identifier) {
    return (
      <AuthCard eyebrow={t("auth.verify.eyebrow")} title={t("auth.verify.title")}>
        <Alert
          tone="warn"
          action={
            <Link
              href={from}
              className="rounded-tag text-body-sm font-medium text-warn-ink underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.signin.title")}
            </Link>
          }
        >
          {t("auth.verify.no_identifier")}
        </Alert>
      </AuthCard>
    );
  }

  // Masked here from the identifier itself, never trusted from the query
  // string: a crafted `masked=` would put somebody else's number on the one
  // screen whose subject is proving who you are — the board's own correction.
  const masked = maskIdentifier(identifier);
  const channel = identifier.kind === "phone" ? "sms" : "email";
  const fellBack = one("fell") === "1" && channel === "email";

  // Both throttles, read here rather than inferred from the query string. A
  // lockout in the URL is a past event; these are the current ones, so the
  // form is disabled exactly while it would be refused.
  const [resendGate, verifyGate] = await Promise.all([
    checkThrottle(identifier.value, "otp_request"),
    checkThrottle(identifier.value, "otp_verify"),
  ]);
  const cooldown = resendGate.allowed ? 0 : retryAfterSeconds(resendGate);
  const lockedOut = !verifyGate.allowed;

  // "Use email instead" — for a sign-up this browser just sent it resends to
  // the email on that form; otherwise it returns to a form that takes one.
  const offerEmail = channel === "sms";

  const hidden = (
    <>
      <input type="hidden" name="identifier" value={identifier.value} />
      {safeNext ? <input type="hidden" name="next" value={safeNext} /> : null}
      {fromParam ? <input type="hidden" name="from" value={from} /> : null}
      <input type="hidden" name="purpose" value={purpose} />
    </>
  );

  return (
    <AuthCard
      eyebrow={t("auth.verify.eyebrow")}
      title={t("auth.verify.title")}
      lede={
        channel === "sms"
          ? t("auth.verify.sent_sms", { masked, minutes: OTP_EXPIRY_MINUTES })
          : t("auth.verify.sent_email", { masked, minutes: OTP_EXPIRY_MINUTES })
      }
      footer={
        <p className="flex flex-wrap items-center gap-x-1.5 text-body">
          {channel === "sms" ? t("auth.verify.wrong_number") : t("auth.verify.wrong_email")}
          <Link
            href={from}
            className="rounded-tag font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
          >
            {t("auth.verify.start_again")}
          </Link>
        </p>
      }
    >
      <div className="space-y-5">
        {fellBack ? (
          <Alert tone="info" live="polite">
            {t("auth.verify.fell_back")}
          </Alert>
        ) : null}

        <AuthFailure
          error={lockedOut ? "too_many_attempts" : one("error")}
          retry={lockedOut ? String(retryAfterSeconds(verifyGate)) : one("retry")}
          limit={one("limit")}
          left={one("left")}
          restartHref={from}
        />

        {/*
          One form, three submit buttons, one row — as drawn. Resend and "use
          email instead" post the same hidden fields to their own actions through
          `formAction`, and skip validation because they need no code.
        */}
        <form action={verifyAction} className="space-y-5">
          {hidden}
          <OtpField
            label={t("auth.verify.code")}
            length={OTP_LENGTH}
            autoFocus={!lockedOut}
            disabled={lockedOut}
            invalid={one("error") === "code_incorrect"}
            {...(lockedOut ? { hint: t("auth.locked.help") } : {})}
          />
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Button type="submit" disabled={lockedOut}>
              {t("auth.verify.submit")}
            </Button>
            <ResendButton initialSeconds={cooldown}>
              <Button type="submit" variant="ghost" size="sm" formAction={resendAction} formNoValidate>
                {t("auth.verify.resend")}
              </Button>
            </ResendButton>
            {offerEmail ? (
              <Button type="submit" variant="ghost" size="sm" formAction={useEmailInsteadAction} formNoValidate>
                {t("auth.verify.use_email")}
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </AuthCard>
  );
}
