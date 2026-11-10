import Link from "next/link";
import { Alert, type AlertTone } from "@/components/display";
import { cn } from "@/lib/cn";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { FILS_PER_AED } from "@/lib/billing/proration";
import { railLines, type StepTone } from "@/lib/billing/rail-copy";
import type { FailedPayment, RecoveredPayment } from "@/lib/billing/summary";

/**
 * Board 3m's failed-payment banner, with the sequence rail — task T9.2, prompt
 * P-05, spec S3.
 *
 * The staff side has rendered these five steps at `/admin/dunning` since board
 * 12e; the seller whose card failed saw one sentence and an instruction to reply
 * to an email nothing sent. The rail is the same `dunningRail` the console
 * reads, so the two cannot disagree about what was sent.
 *
 * ## One banner, whatever else is true
 *
 * A seller who cancels while past due gets one banner carrying both facts (P-06:
 * *"not two banners with two dates"*). The date is the same either way — T9.1
 * dates a past-due cancellation from the drop — so the only thing the
 * cancellation changes is which steps will still run.
 *
 * The drop is a plan change. Never a suspension, an unpublishing or a removal:
 * the listing stays live, the reviews stay and the badge stays, and the banner
 * says so in the dropped state where a seller most needs to hear it.
 */

const STEP_TEXT: Record<StepTone, string> = {
  ok: "text-ok-ink",
  warn: "text-warn-ink",
  bad: "text-bad-ink",
  neutral: "text-body",
};

function aed(fils: number): string {
  // The page's own form — `AED 366.45`, currency and fils. Criterion 3.
  return formatAED(fils / FILS_PER_AED, { style: "exact" });
}

export function FailedPaymentBanner({ failed }: { failed: FailedPayment }) {
  const dropped = failed.stage === "dropped";
  const cancelled = failed.cancelledAt !== null;
  const final = failed.stage === "final";

  const tone: AlertTone = dropped ? "neutral" : failed.stage === "retry" || cancelled ? "warn" : "bad";
  const title = dropped
    ? t("billing.failed.title_dropped", { when: formatDate(failed.dropsOn) })
    : cancelled
      ? t("billing.failed.title_cancelled", { failed: formatDate(failed.failedOn), when: formatDate(failed.dropsOn) })
      : final
        ? t("billing.failed.title_final", { when: formatDate(failed.dropsOn) })
        : failed.amountFils !== null
          ? t("billing.failed.title", { amount: aed(failed.amountFils), when: formatDate(failed.failedOn) })
          : t("billing.failed.title_unknown", { when: formatDate(failed.failedOn) });

  /*
     The email to reply to, only where one arrived — a sent row on the email
     channel. Otherwise the fix names the constraint and nothing else.
  */
  const emailed = failed.rail.steps
    .flatMap((step) => step.deliveries)
    .find((delivery) => delivery.channel === "email" && delivery.status === "sent");
  const fix = dropped
    ? t("billing.failed.dropped_fix")
    : cancelled
      ? t("billing.failed.cancelled_fix")
      : emailed
        ? t("billing.failed.fix_reply", { when: formatDate(emailed.sentAt ?? emailed.createdAt) })
        : t("billing.failed.fix");

  const lines = railLines(failed.rail, { gatewayLive: failed.gatewayLive, cancelled });

  return (
    <Alert
      tone={tone}
      title={title}
      fix={fix}
      action={
        dropped ? (
          <Link href="/dashboard/billing/change" className="underline underline-offset-2">
            {t("billing.failed.change_plan")}
          </Link>
        ) : undefined
      }
    >
      {dropped ? (
        <p>{t("billing.failed.dropped_body")}</p>
      ) : (
        <p>{failed.reason ? t("billing.failed.reason", { reason: failed.reason }) : t("billing.failed.no_reason")}</p>
      )}

      <h3 className="mt-3 font-mono text-eyebrow uppercase text-muted">{t("billing.rail.title")}</h3>
      <ol className="mt-1.5 flex flex-col gap-1.5">
        {lines.map((line, index) => {
          const step = failed.rail.steps[index]!;
          const done = step.state === "done";
          return (
            <li key={line.key} className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
              <span className={cn("font-mono text-caption", done ? "text-ink" : "text-muted")}>{line.label}</span>
              <span className={cn("text-body-sm", STEP_TEXT[line.tone])}>
                {line.text}
                {line.needsChannel ? (
                  <>
                    {" "}
                    <Link href="/dashboard/settings?tab=channels" className="underline underline-offset-2">
                      {t("billing.rail.fix_channel")}
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>

      {/*
         Verbatim, and always before the drop. Criterion 12 is a promise about
         what does not happen during the grace, and a promise the seller cannot
         see the end of is not one they can act on.
      */}
      {!dropped ? <p className="mt-3">{t("billing.failed.grace", { deadline: formatDate(failed.dropsOn) })}</p> : null}
    </Alert>
  );
}

export function RecoveredPaymentBanner({ recovered }: { recovered: RecoveredPayment }) {
  return (
    <Alert tone="ok" title={t("billing.recovered.title", { when: formatDate(recovered.paidOn) })}>
      <p>{t("billing.recovered.body", { amount: aed(recovered.amountFils) })}</p>
    </Alert>
  );
}
