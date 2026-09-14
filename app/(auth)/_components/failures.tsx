import Link from "next/link";
import { Alert } from "@/components/display/Alert";
import { formatDuration } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { passwordProblem } from "./password-copy";

/**
 * The failure states board 7a draws, rendered from a query string.
 *
 * Shared because every auth screen can reach them: a link expires wherever it
 * was sent from, a lockout follows the identifier rather than the page, and a
 * suspended account is suspended on every one of them.
 *
 * The tones are the board's, not a severity ladder: an expired link is `bad`,
 * a lockout is `warn` because it offers a way through, and a suspension is
 * `neutral` — it is a decision a person made, and the screen's job is to point
 * at the reason, not to alarm.
 *
 * Every notice carries its fix (design-system §05.1, component 65). Where the
 * fix is a control that already sits on the form below — the code button under
 * a password lockout — it is named in the sentence rather than drawn twice.
 */

export interface FailureParams {
  error?: string | undefined;
  retry?: string | undefined;
  /** "0" when the limit hit was the mail provider's, not ours. */
  limit?: string | undefined;
  /** Attempts left after a wrong code or password. */
  left?: string | undefined;
  /** A refused password: which rule, and how long it was. */
  problem?: string | undefined;
  length?: string | undefined;
  /** Where "request another" goes back to. */
  restartHref: string;
  /** True for a lockout on asking for codes rather than on getting them wrong. */
  onRequest?: boolean;
}

/** A labelled lead-in, the way the board sets it: bold phrase, then the sentence. */
function Lead({ title, body }: { title: string; body: string }) {
  return (
    <>
      <span className="font-medium">{title}</span> {body}
    </>
  );
}

export function AuthFailure(params: FailureParams): React.ReactElement | null {
  const { error } = params;
  if (!error) return null;
  const left = Number(params.left);

  switch (error) {
    case "link_expired":
      return (
        <Alert
          tone="bad"
          live="assertive"
          action={
            <Link
              href={params.restartHref}
              className="rounded-tag text-body-sm font-medium text-bad-ink underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.expired.action")}
            </Link>
          }
        >
          <Lead title={t("auth.expired.title")} body={t("auth.expired.body")} />
        </Alert>
      );

    case "password_locked":
      return (
        <Alert tone="warn" live="assertive" fix={t("auth.locked.password_fix", { duration: waitFor(params.retry) })}>
          <Lead title={t("auth.locked.title")} body={t("auth.locked.password_body")} />
        </Alert>
      );

    case "too_many_attempts":
      return (
        <Alert tone="warn" live="assertive" fix={t("auth.locked.fix", { duration: waitFor(params.retry) })}>
          <Lead
            title={t("auth.locked.title")}
            body={
              // limit=0 means the ceiling was the mail provider's rather than
              // ours, so quoting "5 codes" would be quoting the wrong number.
              params.limit === "0"
                ? t("auth.locked.body_upstream")
                : params.onRequest
                  ? t("auth.locked.body_requests", { limit: 5 })
                  : t("auth.locked.body")
            }
          />
        </Alert>
      );

    case "cooldown":
      return (
        <Alert tone="info" live="polite">
          <Lead title={t("auth.cooldown.title")} body={t("auth.cooldown.body", { duration: waitFor(params.retry) })} />
        </Alert>
      );

    case "suspended":
      /*
         Board 7a `B7` and criterion 7: says a reason was emailed, and never
         shows it. There is no date either — the date adds nothing the email
         does not say, and it is one more fact about the account for whoever is
         holding the phone.
      */
      return (
        <Alert
          tone="neutral"
          live="assertive"
          action={
            <a
              href={`mailto:${t("auth.support_address")}`}
              className="rounded-tag text-body-sm font-medium text-prose underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.suspended.action")}
            </a>
          }
        >
          <Lead title={t("auth.suspended.title")} body={t("auth.suspended.body")} />
        </Alert>
      );

    case "code_incorrect":
      return (
        <Alert tone="bad" live="assertive" fix={t("auth.error.code_incorrect_fix")}>
          {Number.isFinite(left) && params.left !== undefined
            ? t("auth.error.code_incorrect_left", { count: left })
            : t("auth.error.code_incorrect")}
        </Alert>
      );

    case "password_incorrect":
      return (
        <Alert tone="bad" live="assertive" fix={t("auth.error.password_incorrect_fix")}>
          {Number.isFinite(left) && params.left !== undefined
            ? t("auth.error.password_incorrect_left", { count: left })
            : t("auth.error.password_incorrect")}
        </Alert>
      );

    case "password_rejected":
      return (
        <Alert tone="bad" live="assertive" fix={t("auth.password.fix")}>
          {passwordProblem(params.problem, Number(params.length ?? 0))}
        </Alert>
      );

    case "sms_unavailable":
      return (
        <Alert tone="warn" live="assertive" fix={t("auth.error.sms_unavailable_fix")}>
          {t("auth.error.sms_unavailable")}
        </Alert>
      );

    default: {
      const plain = PLAIN[error as PlainError];
      if (!plain) return null;
      return (
        <Alert tone="bad" live="assertive" fix={t(plain[1])}>
          {t(plain[0])}
        </Alert>
      );
    }
  }
}

/** Refusals that are one sentence and one fix, with nothing to interpolate. */
type PlainError =
  | "invalid_identifier"
  | "invalid_phone"
  | "invalid_email"
  | "name_required"
  | "terms_required"
  | "password_required"
  | "email_taken"
  | "phone_taken"
  | "delivery_failed"
  | "identifier_taken"
  | "unavailable";

const PLAIN: Record<PlainError, readonly [MessageKey, MessageKey]> = {
  invalid_identifier: ["auth.error.invalid_identifier", "auth.error.invalid_identifier_fix"],
  invalid_phone: ["auth.error.invalid_phone", "auth.error.invalid_phone_fix"],
  invalid_email: ["auth.error.invalid_email", "auth.error.invalid_email_fix"],
  name_required: ["auth.error.name_required", "auth.error.name_required_fix"],
  terms_required: ["auth.error.terms_required", "auth.error.terms_required_fix"],
  password_required: ["auth.error.password_required", "auth.error.password_required_fix"],
  email_taken: ["auth.error.email_taken", "auth.error.email_taken_fix"],
  phone_taken: ["auth.error.phone_taken", "auth.error.phone_taken_fix"],
  delivery_failed: ["auth.error.delivery_failed", "auth.error.delivery_failed_fix"],
  identifier_taken: ["auth.error.identifier_taken", "auth.error.identifier_taken_fix"],
  unavailable: ["auth.error.unavailable", "auth.error.unavailable_fix"],
};

/** "45 s" · "2 min". The same duration ladder the rest of the product uses. */
function waitFor(retry: string | undefined): string {
  const seconds = Number(retry);
  return formatDuration(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000);
}
