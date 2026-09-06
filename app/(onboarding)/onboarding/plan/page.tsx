import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { PlanCard } from "@/components/domain";
import { StatusBadge } from "@/components/display";
import { buttonClassName } from "@/components/primitives";
import { Check } from "@/components/primitives/icons";
import { featuresOf, priceLabelOf, summaryOf } from "@/lib/billing/plan-features";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { planStepStateFor, type PlanStepState } from "@/lib/onboarding/plan-step";
import { joinClauses, type Clause } from "@/lib/onboarding/recommendation";
import type { Task } from "@/lib/onboarding/service";
import { siteUrl } from "@/lib/site";
import { OnboardingHeader, OnboardingColumn } from "../_chrome";
import { requireClaimant } from "../_shell";
import { finishOnboarding } from "../actions";
import { beginProTrial } from "./actions";
import { LiveRail } from "./LiveRail";
import { TrialButton } from "./TrialButton";

/**
 * Board 2e — pick a plan, then the first-run checklist.
 *
 * The listing is already live when this loads. `2d` published it, the header
 * says so, and the rail carries the URL as proof. That ordering is the design:
 * publishing is not gated on payment, so this page cannot use the leverage of a
 * withheld listing and has to argue on merit. Everything defensive about the
 * copy follows — no countdown, no expiring offer, and no "complete your
 * listing" nag against a listing that is complete.
 *
 * Two jobs in order. The plan decision is why the page exists; the checklist is
 * what decides whether the seller ever gets value, and a seller who picks Free
 * and finishes four tasks is worth more than one who picks Pro and abandons.
 */
export const metadata: Metadata = {
  title: t("plan_step.meta_title"),
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

const TASK_HREF: Record<Task, string> = {
  photos: "/dashboard/media",
  products: "/dashboard/products",
  team: "/dashboard/team",
};

export default async function PlanStepPage() {
  const actor = await requireClaimant("plan");
  if (!actor.businessId) redirect("/onboarding/claim");

  const state = await planStepStateFor(actor.businessId);
  /*
     No state means the listing is not published, which means the locations step
     was skipped by a typed URL. Send them back rather than showing a plan for a
     listing nobody can see — criterion 1 is a precondition of this page, not a
     sentence on it.
  */
  if (!state) redirect("/onboarding/locations");

  const listingPath = `/b/${state.slug}`;
  const listingUrl = `${siteUrl()}${listingPath}`.replace(/^https?:\/\//, "");

  return (
    <>
      <OnboardingHeader
        step="plan"
        signedIn
        trailing={<span className="text-body-sm text-body">{t("plan_step.live_header")}</span>}
      />

      <OnboardingColumn wide>
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-8">
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">
              {t("plan_step.title")}
            </h1>
            <Recommendation state={state} />

            {state.alreadyPaid ? (
              /*
                 Criterion 21. Somebody who bought on `1l` before onboarding gets
                 one line, not three cards — showing a chooser to a person who has
                 already chosen asks them to make the decision twice.
              */
              <p className="mt-6 rounded-card border border-ok-line bg-ok-wash px-4 py-3 text-body-sm text-ok-ink">
                {t("plan_step.already_paid", { plan: state.alreadyPaid.planName })}
              </p>
            ) : (
              <Plans state={state} />
            )}

            {state.trial.active && state.trial.endsAt && (
              <p className="mt-4 text-body-sm text-body">
                {t("plan_step.trial_active", {
                  plan: state.pro?.planName ?? "Pro",
                  date: formatDate(state.trial.endsAt),
                })}
              </p>
            )}

            <Checklist state={state} />

            <form action={finishOnboarding} className="mt-6 flex justify-end">
              <button
                type="submit"
                className="rounded-tag text-body-sm text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t("plan_step.done")}
              </button>
            </form>
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[22rem]">
            <LiveRail url={listingUrl} href={listingPath} />
            {state.pro && !state.alreadyPaid && <ProRail state={state} />}

            {/*
              The most load-bearing sentence on the page for somebody who has
              just spent twenty minutes on data entry — and a commitment `11f`
              honours rather than a reassurance this page invented. Cancelling
              hides products and never deletes them, and there is no retention
              offer on the way out.
            */}
            <section className="rounded-card border border-line bg-paper-sunk p-4">
              <h2 className="text-body-sm font-medium text-ink">{t("plan_step.no_lockin")}</h2>
              <p className="mt-1.5 text-caption text-body">{t("plan_step.no_lockin_body")}</p>
            </section>
          </aside>
        </div>
      </OnboardingColumn>
    </>
  );
}

/**
 * The sub-line, from the seller's own rows, and the cohort clause after it.
 *
 * Criterion 9: a branch count that disagrees with `2d` fails the board, so
 * every clause is derived rather than written. Criterion 10: the cohort
 * sentence is a measured count or it is absent — never softened to "many".
 */
function Recommendation({ state }: { state: PlanStepState }) {
  const parts = state.clauses.map((clause) => clauseText(clause)).filter(Boolean);
  if (parts.length === 0 && !state.cohort) return null;

  return (
    <p className="mt-3 max-w-prose text-body-sm text-body">
      {parts.length > 0 &&
        t("plan_step.recommend_lead", {
          facts: joinClauses(parts, {
            join: t("plan_step.clause_join"),
            and: t("plan_step.clause_and"),
          }),
        })}
      {state.cohort && (
        <>
          {" "}
          {t("plan_step.cohort", {
            count: formatCount(state.cohort.count),
            total: formatCount(state.cohort.total),
            category: state.pro?.categoryName ?? "",
            plan: state.cohort.planName,
          })}
        </>
      )}
    </p>
  );
}

function clauseText(clause: Clause): string {
  if (clause.kind === "locations") {
    /*
       One type, not the list. A seller with six branches has six types, and
       "including a head office, workshop, warehouse, sales office, depot and
       trade counter" is a sentence that has stopped saying anything — it also
       collides with the conjunction joining the clauses around it. The first is
       the one the seller entered first, which on 2d is the branch the card list
       opens on.
    */
    const type = clause.types[0];
    if (!type) return "";
    const named = t(`locations.type.${type}` as never).toLowerCase();
    return clause.count === 1
      ? t("plan_step.clause.locations_one", { type: named })
      : t("plan_step.clause.locations", { count: formatCount(clause.count), type: named });
  }
  if (clause.kind === "categories") {
    return t("plan_step.clause.categories", {
      names: joinClauses(clause.names, {
        join: t("plan_step.clause_join"),
        and: t("plan_step.clause_and"),
      }),
    });
  }
  return t("plan_step.clause.catalogue");
}

/**
 * Three cards, and exactly one promoted — criterion 15.
 *
 * Every figure comes off the `Plan` row through `featuresOf`, which the pricing
 * page and the change screen also use. This is the fourth surface rendering the
 * same numbers, and a seller who reads one price here and another on `/pricing`
 * stops at that point.
 */
function Plans({ state }: { state: PlanStepState }) {
  return (
    <div className="mt-7 grid gap-4 lg:grid-cols-3">
      {state.plans.map((plan) => (
        <PlanCard
          key={plan.id}
          name={plan.name}
          headingLevel={2}
          monthlyPriceAed={plan.monthlyPriceAed}
          priceLabel={priceLabelOf(plan)}
          periodLabel={t("plan.period")}
          {...(summaryOf(plan.id) ? { summary: summaryOf(plan.id)! } : {})}
          features={featuresOf(plan)}
          recommended={plan.promoted}
          recommendedLabel={
            plan.offersTrial
              ? t("plan_step.trial_pill", { days: String(state.trialDays) })
              : t("plan.recommended")
          }
          current={plan.current}
          currentLabel={t("plan_step.current_plan")}
          action={<PlanAction plan={plan} state={state} />}
        />
      ))}
    </div>
  );
}

function PlanAction({
  plan,
  state,
}: {
  plan: PlanStepState["plans"][number];
  state: PlanStepState;
}) {
  // The plan they are on. Free is a product, so this is a statement rather than
  // a disabled control begging to be pressed.
  if (plan.current) {
    return (
      <form action={finishOnboarding}>
        <button
          type="submit"
          className={`${buttonClassName({ variant: "secondary", size: "md" })} w-full`}
        >
          {plan.id === "free" ? t("plan_step.stay_free") : t("plan_step.done")}
        </button>
      </form>
    );
  }

  /*
     Criterion 12 and 14. The trial is Pro's and takes no card, so it is the one
     control here that changes a plan without a quote. Once used, the pill and
     every word of trial language go — criterion 11 — and the CTA becomes
     "Start on Pro", which is a link to the same quote screen Basic uses.
  */
  if (plan.offersTrial) {
    return (
      <TrialButton
        label={t("plan_step.start_trial", { plan: plan.name })}
        note={t("plan_step.trial_note", { days: String(state.trialDays) })}
        action={beginProTrial}
      />
    );
  }

  /*
     Free, while a trial is running, is not a choice to make.

     The trial ends by dropping to Free on its own — the line under these cards
     says so — so a "Choose Free" button beside it offers the seller work the
     platform is already going to do, and links them at a proration screen with
     nothing to prorate. Saying nothing is the honest control here.
  */
  if (plan.id === "free" && state.trial.active) return null;

  const trialUsed = state.trial.used && plan.id === "pro";
  return (
    <Link
      href={`/dashboard/billing/change?to=${plan.id}`}
      className={`${buttonClassName({ variant: plan.promoted ? "primary" : "secondary", size: "md" })} w-full`}
    >
      {trialUsed
        ? t("plan_step.start_on", { plan: plan.name })
        : t("plan_step.choose", { plan: plan.name })}
    </Link>
  );
}

/**
 * The checklist — board 8a's rows, worded for the payoff.
 *
 * Criterion 16: the same `setupStateFor` the hub reads, so completing a task on
 * either surface updates both. Criterion 17: the count is the number of
 * incomplete tasks and the estimate is the sum of *their* minutes, neither a
 * constant. Criterion 18: when they are all done this is a done state and not a
 * row reading zero.
 *
 * The order is the board's and is deliberate — photos first because it is the
 * fastest and the most visible, the site visit last because it needs
 * scheduling. The first task has to be completable in two minutes.
 */
function Checklist({ state }: { state: PlanStepState }) {
  const remaining = state.setup.tasks.filter((task) => !task.done);
  const minutes = remaining.reduce((sum, task) => sum + task.minutes, 0);

  if (remaining.length === 0) {
    return (
      <section className="mt-7 rounded-card border border-line bg-card p-4">
        <h2 className="text-body-sm font-medium text-ink">{t("plan_step.checklist_done")}</h2>
        <p className="mt-1.5 max-w-prose text-body-sm text-muted">
          {t("plan_step.checklist_done_body")}
        </p>
      </section>
    );
  }

  return (
    <section className="mt-7 overflow-hidden rounded-card border border-line bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <h2 className="text-body-sm font-medium text-ink">
          {remaining.length === 1
            ? t("plan_step.checklist_one")
            : t("plan_step.checklist", { n: formatCount(remaining.length) })}
        </h2>
        <span className="font-mono text-eyebrow uppercase tracking-wide text-muted">
          {t("plan_step.checklist_est", { n: formatCount(minutes) })}
        </span>
      </div>

      <ul className="flex list-none flex-col divide-y divide-line p-0">
        {/*
          The row `2c` already finished, struck through and first. It is not one
          of the four — the count above says four things left, and a done row
          that changed the arithmetic would make the header wrong.
        */}
        <li className="flex items-center gap-3 px-4 py-3">
          <span className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-pill bg-ok text-on-ink">
            <Check size={11} />
          </span>
          <span className="text-body-sm text-muted line-through">{t("plan_step.task_profile")}</span>
        </li>

        {state.setup.tasks.map((task) => (
          <li key={task.task} className="flex flex-wrap items-center gap-3 px-4 py-3">
            {task.done ? (
              <span className="flex size-[1.125rem] shrink-0 items-center justify-center rounded-pill bg-ok text-on-ink">
                <Check size={11} />
              </span>
            ) : (
              <span
                aria-hidden="true"
                className="size-[1.125rem] shrink-0 rounded-pill border-[1.5px] border-line-strong"
              />
            )}

            <span
              className={
                task.done ? "text-body-sm text-muted line-through" : "text-body-sm text-ink"
              }
            >
              {t(`plan_step.task.${task.task}` as never, { n: formatCount(task.progress.target) })}
            </span>

            {task.done ? (
              <StatusBadge tone="ok" size="sm" shape="chip">
                {t("setup.done")}
              </StatusBadge>
            ) : (
              <Link
                href={TASK_HREF[task.task]}
                className="ms-auto rounded-tag text-body-sm font-medium text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
              >
                {t(`plan_step.cta.${task.task}` as never)}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What Pro changes, in three lines that are all checkable.
 *
 * Criterion 4 is the one this rail exists to satisfy. The render promised
 * *"You appear in the top slot"*, which Pro cannot deliver: the sponsored slot
 * is one per subcategory × emirate, bought separately on `11e`, with a waiting
 * list when it is taken. So the line names the two things Pro actually does —
 * the multiplier and the eligibility — and criterion 5 asks that the page never
 * imply plan is a large ranking factor, so the note under it says what plan is
 * worth out of the total.
 *
 * The other two lines are mechanical consequences rather than benefits
 * language: they describe `1e` and `3l`.
 */
function ProRail({ state }: { state: PlanStepState }) {
  const pro = state.pro!;
  const emirate = EMIRATES.find((row) => row.value === pro.emirateName)?.label ?? null;

  return (
    <section className="rounded-card border border-line bg-card p-4">
      <h2 className="font-mono text-eyebrow uppercase tracking-wide text-faint">
        {t("plan_step.pro_title", { plan: pro.planName })}
      </h2>

      <ul className="mt-3 flex list-none flex-col gap-2.5 p-0">
        <li className="text-body-sm text-body">
          {pro.categoryName &&
            (emirate
              ? t("plan_step.pro_ranking", {
                  category: pro.categoryName,
                  emirate,
                  multiplier: String(pro.multiplier),
                })
              : t("plan_step.pro_ranking_no_area", {
                  category: pro.categoryName,
                  multiplier: String(pro.multiplier),
                }))}
          <span className="mt-1 block text-caption text-muted">
            {t("plan_step.pro_weight_note", {
              points: formatCount(pro.weight.points),
              total: formatCount(pro.weight.total),
            })}
          </span>
        </li>
        <li className="text-body-sm text-body">{t("plan_step.pro_specs")}</li>
        <li className="text-body-sm text-body">{t("plan_step.pro_searches")}</li>
      </ul>
    </section>
  );
}
