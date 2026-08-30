import Link from "next/link";
import { AuthNotice } from "./AuthNotice";
import { formatDate, formatDuration } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The three failure states board 7a draws, rendered from a query string.
 *
 * They are shared because all four screens can reach all three: a link expires
 * wherever it was sent from, a lockout follows the number rather than the page,
 * and a suspended account is suspended on every one of them.
 */
export type AuthErrorCode =
  | "invalid_identifier"
  | "code_incorrect"
  | "delivery_failed"
  | "identifier_taken"
  | "unavailable"
  | "link_expired"
  | "too_many_attempts"
  | "cooldown"
  | "suspended"
  | "name_required"
  | "intent_required"
  | "too_short";

export interface FailureParams {
  error?: string;
  retry?: string;
  since?: string;
  length?: string;
  /** "0" when the limit hit was the mail provider's, not ours. */
  limit?: string;
  /** Where "send a new link" should go back to. */
  restartHref: string;
  /** True for a lockout on asking for codes rather than on getting them wrong. */
  onRequest?: boolean;
}

/** Null for the codes that belong beside a field rather than above the form. */
export function AuthFailure(params: FailureParams): React.ReactElement | null {
  const { error } = params;
  if (!error) return null;

  switch (error) {
    case "link_expired":
      return (
        <AuthNotice
          live
          tone="warn"
          title={t("auth.expired.title")}
          body={t("auth.expired.body", { minutes: 60 })}
          action={
            <Link
              href={params.restartHref}
              className="rounded-tag underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.expired.action")}
            </Link>
          }
        />
      );

    case "too_many_attempts":
      return (
        <AuthNotice
          live
          tone="bad"
          title={t("auth.locked.title")}
          body={
            // limit=0 means the ceiling was the mail provider's rather than
            // ours, so quoting "5 codes" would be quoting the wrong number.
            params.limit === "0"
              ? t("auth.locked.body_upstream", { duration: waitFor(params.retry) })
              : params.onRequest
                ? t("auth.locked.body_requests", { limit: 5, duration: waitFor(params.retry) })
                : t("auth.locked.body", { duration: waitFor(params.retry) })
          }
        />
      );

    case "cooldown":
      return (
        <AuthNotice
          live
          tone="info"
          title={t("auth.cooldown.title")}
          body={t("auth.cooldown.body", { duration: waitFor(params.retry) })}
        />
      );

    case "suspended":
      return (
        <AuthNotice
          live
          tone="bad"
          title={t("auth.suspended.title")}
          body={t("auth.suspended.body", {
            date: params.since ? formatDate(params.since) : formatDate(new Date()),
          })}
          action={
            <a
              href="mailto:review@businesslistings.ae"
              className="rounded-tag underline underline-offset-2 focus-visible:shadow-focus focus-visible:outline-none"
            >
              {t("auth.suspended.action")}
            </a>
          }
        />
      );

    case "code_incorrect":
      return <AuthNotice live title={t("auth.error.code_incorrect")} />;
    case "invalid_identifier":
      return <AuthNotice live title={t("auth.error.invalid_identifier")} />;
    case "delivery_failed":
      return <AuthNotice live title={t("auth.error.delivery_failed")} />;
    case "name_required":
      return <AuthNotice live title={t("auth.error.name_required")} />;
    case "intent_required":
      return <AuthNotice live title={t("auth.signup.intent_required")} />;
    case "too_short":
      return (
        <AuthNotice live title={t("auth.reset.too_short", { count: Number(params.length ?? 0) })} />
      );
    case "identifier_taken":
      /*
         Verified, and still no seat. The identifier belongs to a profile row
         with a different id — every seeded staff seat and seller owner is one,
         because the seed mints their ids itself. Says so plainly rather than
         reaching the browser as a 500, which is what it used to do.
      */
      return <AuthNotice live title={t("auth.error.identifier_taken")} />;
    case "unavailable":
      return <AuthNotice live title={t("auth.error.unavailable")} />;
    default:
      return null;
  }
}

/** "45 s" · "2 min". The same duration ladder the rest of the product uses. */
function waitFor(retry: string | undefined): string {
  const seconds = Number(retry);
  return formatDuration(Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000);
}
