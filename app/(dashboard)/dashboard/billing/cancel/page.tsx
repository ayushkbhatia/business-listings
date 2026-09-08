import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Card } from "@/components/structure";
import { StepHeader } from "@/components/structure";
import { mayChangePlan } from "@/lib/auth/guards";
import { cancellationView } from "@/lib/billing/cancellation";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../../_shell";
import { ConsequenceTable } from "./ConsequenceTable";
import { CANCEL_STEPS } from "./steps";

/**
 * Board 11h — step 1, what changes.
 *
 * ## The consequence table is the screen
 *
 * The seller is told what changes **before** being asked to confirm, and asked
 * for a reason only after. That order is the flow's second rule and it follows
 * from the first: the reason never gates the information.
 *
 * ## Everything is dated, and nothing happens today
 *
 * The paid period runs to its end and is neither shortened nor paid back, and
 * every date on this screen and the next comes from one value —
 * `view.freeStartsOn`, the renewal moment. Criterion 1: there is no hardcoded
 * date and no second date to keep in step.
 *
 * ## No interactivity, so no client component
 *
 * Both buttons are links. `Keep Pro` goes back to billing and `Continue to
 * cancel` goes to step 2, which is a route rather than a modal precisely so a
 * seller can leave and come back — from an email, or from re-reading this
 * table — and still have somewhere to land.
 */
export const metadata = { title: t("cancel.title") };
export const dynamic = "force-dynamic";

export default async function CancelPage() {
  const seat = await requireSellerSeat();
  /*
     Owner only, by URL as well as by navigation.

     Criterion 9. The permission matrix gives *Change plan or cancel* to the
     owner alone, and `11f` fences the same capability the same way — a finance
     seat reads the invoices and does not decide what the business buys. A
     manager reaching this URL gets the same refusal `11f` gives: for them, this
     screen does not exist.
  */
  if (!mayChangePlan(seat.actor)) notFound();

  const [view, badges] = await Promise.all([
    cancellationView(seat.actor, seat.businessId),
    getNavBadges(seat.businessId),
  ]);

  // Already on Free, or the subscription has already ended. Criterion 9's
  // second half: the route is not reachable, and billing is where the state is.
  if (!view) redirect("/dashboard/billing");

  /*
     Already scheduled: the flow is over and the banner on `3m` is where the
     seller acts from now.

     Criterion 10 — *"after submitting, neither route is reachable, and
     returning to them lands on /dashboard/billing."* A second pass through a
     flow that has already run would offer to schedule a cancellation over one
     that exists, which the partial unique index would refuse anyway.
  */
  if (view.scheduled) redirect("/dashboard/billing");

  const freeStartsOn = formatDate(view.freeStartsOn);
  const paidTo = formatDate(view.paidTo);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/billing"
      eyebrow={t("billing.eyebrow")}
      title={t("cancel.title")}
      breadcrumb={
        <Link
          href="/dashboard/billing"
          className="rounded-tag text-caption font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("cancel.back.billing")}
        </Link>
      }
      actions={
        <StepHeader steps={CANCEL_STEPS()} current={0} label={t("cancel.steps_label")} variant="inline" />
      }
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_21.5rem]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <ConsequenceTable
            rows={view.rows}
            planName={view.planName}
            freeStartsOn={freeStartsOn}
          />

          {/*
             The choice, dated.

             The boards said *"you pick which"* three times and never presented a
             picker. It is resolved by scheduling it: the picker opens on
             confirming and closes on the last paid day, and it is `11f`'s own
             mechanism reached from the banner on billing. The second sentence is
             build note `B2` — what happens if the seller never opens it — which
             the boards never asked and which decides whether a paying customer's
             listing goes dark.
          */}
          {view.nothingReduced ? (
            <p className="max-w-prose text-caption leading-relaxed text-body-ink">
              {t("cancel.nothing_reduced")}
            </p>
          ) : (
            <p className="max-w-prose text-caption leading-relaxed text-body-ink">
              {t("cancel.picker_note", { when: paidTo })}{" "}
              <span className="text-muted">{t("cancel.picker_default")}</span>
            </p>
          )}

          <p className="max-w-prose text-caption leading-relaxed text-body-ink">
            {t("cancel.today_note", { plan: view.planName, paidTo })}
          </p>
        </div>

        <aside className="flex flex-col gap-3.5">
          <EvidencePanel
            planName={view.planName}
            last={view.enquiriesLastMonth}
            free={view.freeEnquiriesPerMonth}
          />

          <Card surface="card" padded>
            <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
              {t("cancel.keep_eyebrow")}
            </p>
            <ul className="mt-2.5 flex flex-col gap-2">
              {(["listing", "stored", "history"] as const).map((key) => (
                <li key={key} className="flex items-start gap-2 text-caption leading-relaxed text-body-ink">
                  <span aria-hidden="true" className="mt-px shrink-0 text-ok-ink">
                    ✓
                  </span>
                  {t(`cancel.keep.${key}` as "cancel.keep.listing")}
                </li>
              ))}
            </ul>
          </Card>

          <div className="flex flex-col gap-2.5">
            {/*
               Staying is the primary action and cancelling is the outlined one,
               with the destructive border. Same weighting on both steps — the
               nudge is the button hierarchy and nothing else: no discount, no
               pause, no "are you sure". Wave 4 ruled retention offers out.
            */}
            <Link href="/dashboard/billing" className={buttonClassName({ block: true })}>
              {t("cancel.keep_plan", { plan: view.planName })}
            </Link>
            <Link
              href="/dashboard/billing/cancel/confirm"
              className="inline-flex h-9 items-center justify-center rounded-ctl border border-bad-line bg-card px-3.5 text-caption font-medium text-bad-ink hover:bg-bad-surface focus-visible:shadow-focus-danger focus-visible:outline-none"
            >
              {t("cancel.continue")}
            </Link>
          </div>

          {/*
             The fork, stated and not linked.

             `11i` is not drawn and is blocked, and a live link to a route that
             does not exist is the defect corrected on `11d` and `11g`. The
             seller still needs the difference — cancelling leaves the listing in
             the directory, closing removes it — so it is said here and asked
             again on step 2, which is where the fork actually happens. Build
             note `B5`.
          */}
          <Card surface="paper" padded>
            <p className="text-caption font-medium text-ink">{t("cancel.closing_eyebrow")}</p>
            <p className="mt-2 text-caption leading-relaxed text-body-ink">
              {t("cancel.closing_body")}
            </p>
            <p className="mt-2 text-caption leading-relaxed text-muted">
              {t("cancel.closing_blocked")}
            </p>
          </Card>

          <Card surface="card" padded>
            <p className="font-mono text-eyebrow uppercase tracking-[0.11em] text-muted">
              {t("cancel.if_confirm_eyebrow")}
            </p>
            <p className="mt-2.5 text-caption leading-relaxed text-body-ink">
              {/*
                 Named before the decision rather than discovered after it. A
                 seller with no billing address set is told that too — the board
                 printed one address and assumed there always is one.
              */}
              {view.billingEmail
                ? t("cancel.if_confirm.email", { email: view.billingEmail })
                : t("cancel.if_confirm.email_none")}
            </p>
            <p className="mt-2 text-caption leading-relaxed text-body-ink">
              {t("cancel.if_confirm.banner", { when: paidTo, plan: view.planName })}
            </p>
          </Card>
        </aside>
      </div>
    </SellerPage>
  );
}

/**
 * The seller's own enquiry count against the Free allowance.
 *
 * **Not a retention offer.** Wave 4 ruled those out — no discount, no pause, no
 * counter-offer after the reason is recorded — and this is none of them: it is
 * the seller's own number from their own last month, dated and checkable in
 * their own inbox. The decision was to keep offers out of the interface, not to
 * stop telling somebody what the plan they are leaving actually did.
 *
 * It renders only where the comparison is real. A seller whose last month
 * produced fewer enquiries than Free allows is shown nothing, because the panel
 * would then be an argument for leaving.
 */
function EvidencePanel({
  planName,
  last,
  free,
}: {
  planName: string;
  last: number;
  free: number | null;
}) {
  if (free === null || last <= free) return null;

  return (
    <Card surface="paper" padded>
      <p className="text-caption leading-relaxed text-warn-ink">
        {t("cancel.evidence", {
          plan: planName,
          last: formatCount(last),
          free: formatCount(free),
        })}
      </p>
    </Card>
  );
}
