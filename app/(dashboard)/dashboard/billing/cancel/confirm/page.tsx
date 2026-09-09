import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, StepHeader } from "@/components/structure";
import { mayChangePlan } from "@/lib/auth/guards";
import {
  CANCEL_REASONS,
  CLOSING_REASON,
  MAX_NOTE_LENGTH,
  REASON_NEEDING_A_NOTE,
  cancellationView,
} from "@/lib/billing/cancellation";
import { whatChanges } from "@/lib/billing/cancel-table";
import { FILS_PER_AED } from "@/lib/billing/proration";
import { formatAED, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../../_shell";
import { CANCEL_STEPS } from "../steps";
import { ReasonForm } from "./ReasonForm";

/**
 * Board 11j — step 2, reason and confirm.
 *
 * ## A route, not a modal
 *
 * A seller who arrives from an email, or who goes back to re-read the
 * consequence table, needs somewhere to land and something to return to. The
 * one back label is `← What changes`, in the header and in the step chain — the
 * board had two labels for one destination.
 *
 * ## The rail restates step 1 rather than deriving its own version
 *
 * `whatChanges` filters the same rows the table rendered. The board headed
 * these `WHAT YOU CONFIRMED` above four things the seller had only read; they
 * are headed with the date now, and they are literally the same rows — two
 * surfaces computing one number twice is the defect the joint handoff exists to
 * stop.
 */
export const metadata = { title: t("cancel.title") };
export const dynamic = "force-dynamic";

/** `1,783.95` with the currency and the fils, as `3m` renders every total. */
function aed(fils: number): string {
  return formatAED(fils / FILS_PER_AED, { style: "exact" });
}

export default async function CancelConfirmPage() {
  const seat = await requireSellerSeat();
  if (!mayChangePlan(seat.actor)) notFound();

  const [view, badges] = await Promise.all([
    cancellationView(seat.actor, seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  if (!view) redirect("/dashboard/billing");
  /*
     A trial has no reason to give and nothing to confirm.

     Step 1 is where the sentence lives — the trial ends on its own date and
     nothing is charged — so this route sends the seller back to read it rather
     than asking them why they are cancelling something that is already ending.
  */
  if (view.kind === "trial") redirect("/dashboard/billing/cancel");
  // Criterion 10. Once it is scheduled, this route stops being reachable and
  // the banner on billing is where the seller acts from.
  if (view.scheduled) redirect("/dashboard/billing");

  const freeStartsOn = formatDate(view.freeStartsOn);
  const paidTo = formatDate(view.paidTo);
  const placement = view.rows.find((row) => row.key === "sponsored" && row.mark === "ends");

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("cancel.title")}
      breadcrumb={
        <Link
          href="/dashboard/billing/cancel"
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("cancel.back.changes")}
        </Link>
      }
      actions={
        <StepHeader steps={CANCEL_STEPS()} current={1} label={t("cancel.steps_label")} variant="inline" />
      }
    >
      <ReasonForm
        options={CANCEL_REASONS.map((value) => ({
          value,
          label: t(`cancel.reason.${value}` as "cancel.reason.too_expensive"),
          /*
             Two options carry a line, and both say what the *option* does
             rather than what the seller means by it. Stated inline so it is
             read before the choice, not discovered on submit.
          */
          ...(value === CLOSING_REASON
            ? { note: t("cancel.reason.business_closing_note") }
            : value === REASON_NEEDING_A_NOTE
              ? { note: t("cancel.reason.something_else_note") }
              : {}),
        }))}
        closingValue={CLOSING_REASON}
        noteRequiredValue={REASON_NEEDING_A_NOTE}
        maxNoteLength={MAX_NOTE_LENGTH}
        labels={{
          legend: t("cancel.reason.legend"),
          required: t("cancel.reason.required"),
          hint: t("cancel.reason.hint"),
          noteLabel: t("cancel.note.label", { plan: view.planName }),
          noteOptional: t("cancel.note.optional"),
          noteRequired: t("cancel.note.required"),
          notePlaceholder: t("cancel.note.placeholder"),
          noteRequiredHint: t("cancel.note.required_hint"),
          noteCounter: t("cancel.note.counter", { used: "{used}", limit: "{limit}" }),
          keepPlan: t("cancel.keep_plan", { plan: view.planName }),
          confirm: t("cancel.confirm", { when: freeStartsOn }),
          confirmClosing: t("cancel.confirm_closing"),
          closingBlocked: t("cancel.closing_blocked"),
          resumeNote: t("cancel.resume_note", { plan: view.planName, when: paidTo }),
          errorNoReason: t("cancel.error.no_reason"),
          errorNoteRequired: t("cancel.error.note_required"),
        }}
        rail={
          <>
            <Card surface="card" padded>
              <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
                {t("cancel.happens_eyebrow", { when: freeStartsOn })}
              </p>
              <ul className="mt-2.5 flex flex-col gap-2">
                {whatChanges(view.rows).map((row) => (
                  <li
                    key={row.key}
                    className="flex items-start gap-2 text-caption leading-relaxed text-body-ink"
                  >
                    <span
                      aria-hidden="true"
                      className={row.mark === "ends" ? "mt-px shrink-0 text-bad-ink" : "mt-px shrink-0 text-warn-ink"}
                    >
                      {row.mark === "ends" ? "✕" : "▪"}
                    </span>
                    <span>
                      <span className="text-ink">{row.area}</span>
                      {" — "}
                      {row.freeLead ? `${row.freeLead} · ${row.free}` : row.free}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard/billing/cancel"
                className="mt-3 inline-block rounded-tag border-t border-line pt-3 text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("cancel.back.changes")}
              </Link>
            </Card>

            <Card surface="card" padded>
              <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
                {t("cancel.dates_eyebrow")}
              </p>
              <p className="mt-2.5 text-caption leading-relaxed text-body-ink">
                {t("cancel.dates.period", { plan: view.planName, paidTo, freeFrom: freeStartsOn })}
              </p>
              <p className="mt-2 text-caption leading-relaxed text-body-ink">
                {/*
                   What the next invoice would have been, incl. VAT, from the
                   same arithmetic `3m`'s `THIS PERIOD` panel does. Two screens
                   naming one figure differently is the defect the `3m`/`11f`
                   pair was drawn to fix.
                */}
                {t("cancel.dates.invoice", {
                  amount: aed(view.nextInvoiceFils),
                  when: freeStartsOn,
                })}
              </p>
              {/*
                 The placement runs on its own term and outlasts the
                 subscription. Q1 is still open — which governs when the
                 subscription ends underneath it — so this states the booking's
                 own date and claims nothing about the collision.
              */}
              {placement?.free && (
                <p className="mt-2 text-caption leading-relaxed text-body-ink">{placement.free}</p>
              )}
            </Card>

          </>
        }
        railBelow={
          <Card surface="card" padded>
            <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
              {t("cancel.get_eyebrow")}
            </p>
            <p className="mt-2.5 text-caption leading-relaxed text-body-ink">
              {view.billingEmail
                ? t("cancel.get.email", { email: view.billingEmail })
                : t("cancel.if_confirm.email_none")}
            </p>
            <p className="mt-2 text-caption leading-relaxed text-body-ink">
              {t("cancel.get.banner", { plan: view.planName })}
            </p>
          </Card>
        }
      />
    </SellerPage>
  );
}
