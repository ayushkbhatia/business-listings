import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonClassName } from "@/components/primitives";
import { Alert, StatusBadge } from "@/components/display";
import { CompletenessMeter } from "@/components/domain";
import { PageEvent } from "@/components/telemetry";
import { conciergeOfferFor } from "@/lib/catalogue-import/service";
import {
  CATALOGUE_ACCEPT,
  CONCIERGE_PRODUCT_LIMIT,
  MAX_CATALOGUE_BYTES,
} from "@/lib/catalogue-import/pricing";
import { setupHubState, type SetupHubState } from "@/lib/setup/service";
import type { SetupTaskId, SetupTaskRow } from "@/lib/setup/tasks";
import { cn } from "@/lib/cn";
import { formatCount, formatDate } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage, type SellerSeat } from "../_shell";
import { ConciergeCard, type ConciergeStatus } from "./ConciergeCard";
import {
  recordCatalogueFile,
  sendCatalogue,
  signCatalogueUpload,
  withdrawCatalogue,
} from "./concierge-actions";
import { TaskCard } from "./TaskCard";

/**
 * Board 8a — the setup hub.
 *
 * The screen a seller lands on after the onboarding funnel. The listing is
 * already live and indexed by then; everything here is optional and improves
 * performance rather than unlocking it. It exists as a hub rather than a sixth
 * wizard step because the four tasks are independent, take wildly unequal
 * effort, and are abandoned at different rates — a linear step 6 would have
 * blocked go-live on the slowest of them.
 *
 * ## Nothing on this page is a constant
 *
 * The heading counts the cards that are actually open and adds up their own
 * estimates, so it cannot say "four things" over three. The percentage chip on
 * each card is that seller's own remaining points on the matching lever, from
 * `strengthItems` — a seller with three photographs is offered fewer points
 * than one with none, which is both true and the only version that stays true.
 * The threshold sentence is the measured cohort lift where the cohorts are big
 * enough to have one and the mechanism where they are not, never one standing
 * in for the other. The three figures in the rail are three queries.
 *
 * ## Why it has no nav row
 *
 * It is a temporary surface. A permanent sidebar entry for it would still be
 * there a year later reading "nothing left". It is reached from the banner on
 * the overview and from the strength figure in the sidebar footer, and both of
 * those disappear at a hundred per cent — as does this route, which redirects
 * once the last task lands.
 */
export const metadata = { title: "Finish setting up" };
export const dynamic = "force-dynamic";

/**
 * Where each task goes.
 *
 * Three of the four point at the general-purpose screen rather than at a
 * guided one, because boards 8b, 8c and 8d have not been built. That is the
 * honest link: `/dashboard/setup/photos` is in docs/routes.md and 404s, and a
 * hub whose first card is a dead link is worse than one that sends a seller to
 * the media library. The guided routes replace these entries when they land.
 */
const HREF: Record<SetupTaskId, string> = {
  photos: "/dashboard/media",
  products: "/dashboard/products",
  team: "/dashboard/team",
  visit: "/dashboard/setup/visit",
};

/**
 * The two that carry a filled control.
 *
 * Board 8a orders the four by weight times impact rather than by score:
 * photographs and a catalogue move enquiry volume, and the two trust tasks
 * follow. Four identical primary buttons would say the four are
 * interchangeable, which is what the ordering exists to deny.
 */
const LEADS: readonly SetupTaskId[] = ["photos", "products"];

/** Which button verb each task takes. Board 8a words all four differently. */
const CTA: Record<SetupTaskId, MessageKey> = {
  photos: "setup.cta.start",
  products: "setup.cta.start",
  team: "setup.cta.invite",
  visit: "setup.cta.book",
};

/**
 * The seats this hub is for.
 *
 * Board 8a: owner and manager. A sales or finance seat is sent to the leads
 * inbox instead — not because the page would break, but because none of the
 * four tasks is theirs to do and a screen that asks somebody to do work they
 * cannot do is a screen that teaches them to ignore it.
 */
function mayFinishSetup(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupPage() {
  const seat = await requireSellerSeat();
  if (!mayFinishSetup(seat)) redirect("/dashboard/leads");

  const [state, badges, concierge] = await Promise.all([
    setupHubState(seat.businessId),
    getNavBadges(seat.businessId),
    conciergeOfferFor(seat.businessId),
  ]);
  if (!state) redirect("/dashboard");

  /*
     Not live yet, which means the funnel was abandoned before `goLive`.

     Board 8a's precondition names `pending_review` and a redirect to the
     ownership step. Neither exists here: this schema has no `pending_review`
     state, and `publishedAt` is the only fact about whether a listing is on the
     directory. The step that actually unblocks publishing is locations —
     `goLive` refuses without one — so that is where an unpublished seller is
     sent, rather than to a verification screen that would not move them on.
  */
  if (!state.live) redirect("/onboarding/locations");

  /*
     Everything done. The route stops existing rather than rendering a page
     congratulating somebody for reading it, and the flash carries the number
     so the overview says what changed.
  */
  if (state.openCount === 0) {
    redirect(`/dashboard?notice=setup_complete&strength=${state.strength}`);
  }

  const open = state.tasks.filter((task) => !task.done);
  const done = state.tasks.filter((task) => task.done);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/setup"
      setup={{
        strength: state.strength,
        openCount: state.openCount,
        openPoints: open.reduce((total, task) => total + task.points, 0),
      }}
      title={t("setup.title")}
      meta={
        <StatusBadge tone="ok" shape="chip" size="sm">
          {t("setup.live_pill")}
        </StatusBadge>
      }
      actions={<span className="text-caption text-muted">{t("setup.leave_note")}</span>}
    >
      {/*
        Two events, one mount. The pair is the whole point: opening the hub and
        leaving it without starting anything is the drop-off board 8a asks to be
        measured, and the score at that moment is the number worth watching.
      */}
      <PageEvent
        name="setup_hub_viewed"
        props={{ score: state.strength, tasksRemaining: state.openCount }}
        hiddenName="setup_hub_abandoned"
        hiddenProps={{ score: state.strength, tasksRemaining: state.openCount }}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          {state.suspended && <SuspendedNotice />}

          <div>
            <h2 className="font-serif text-h1-serif tracking-tight text-ink">
              {t("setup.hero", {
                count: state.openCount,
                formatted: formatCount(state.openCount),
                minutes: formatCount(state.openMinutes),
              })}
            </h2>
            <p className="mt-2 max-w-prose text-body-sm text-muted">{t("setup.hero_body")}</p>
          </div>

          <Strength state={state} />

          <ul className="flex list-none flex-col gap-3">
            {open.map((task) => (
              <TaskCard key={task.id} {...cardProps(task, state)} />
            ))}
          </ul>

          {done.length > 0 && <DoneSummary tasks={done} />}

          <Levers state={state} />
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[326px]">
          <AlreadyHappening state={state} />

          {concierge.offered && concierge.planName && (
            <ConciergeCard
              planName={concierge.planName}
              free={concierge.feeAed === 0}
              feeFormatted={formatCount(concierge.feeAed)}
              productLimitFormatted={formatCount(
                Math.min(concierge.productLimit, CONCIERGE_PRODUCT_LIMIT),
              )}
              megabytes={formatCount(Math.round(MAX_CATALOGUE_BYTES / (1024 * 1024)))}
              accept={CATALOGUE_ACCEPT}
              request={conciergeRequestView(concierge.request, concierge.open)}
              signAction={signCatalogueUpload}
              recordAction={recordCatalogueFile}
              sendAction={sendCatalogue}
              cancelAction={withdrawCatalogue}
            />
          )}

          <Reminder state={state} />
        </aside>
      </div>
    </SellerPage>
  );
}

/* ── The meter, and the one sentence that may be a measurement ───────────── */

function Strength({ state }: { state: SetupHubState }) {
  /*
     Measured or mechanism, never one as a placeholder for the other. This is
     the rule board 2c set and `lib/metrics/enquiry-lift.ts` enforces: the
     multiple is null until forty listings sit either side of the threshold, and
     until then the callout describes how the filters behave — which is true on
     day one and claims nothing the data cannot support.
  */
  const targetLabel = state.lift
    ? t("setup.lift_measured", {
        threshold: String(state.threshold),
        multiple: String(state.lift.multiple),
      })
    : t("setup.lift_mechanism", { threshold: String(state.threshold) });

  return (
    <div className="rounded-card border border-line-strong bg-card px-5 py-4">
      <CompletenessMeter
        filled={state.strength}
        total={100}
        valueLabel={`${formatCount(state.strength)}%`}
        label={t("setup.strength")}
        size="lg"
        emphasis
        startLabel={t("setup.now")}
        target={state.threshold}
        targetLabel={targetLabel}
      />
    </div>
  );
}

/* ── The four cards ──────────────────────────────────────────────────────── */

function cardProps(task: SetupTaskRow, state: SetupHubState) {
  const chipIsPoints = task.points > 0;

  return {
    title: t(`setup.card.${task.id}` as never),
    body: taskBody(task, state),
    chip: chipIsPoints
      ? t("setup.chip_points", { points: formatCount(task.points) })
      : task.id === "team"
        ? t("setup.tag.speed")
        : t("setup.tag.trust"),
    ...(chipIsPoints
      ? { chipTitle: t("setup.chip_title", { points: formatCount(task.points) }) }
      : {}),
    chipIsPoints,
    estimate: t("setup.estimate", { n: formatCount(task.minutes) }),
    ...(task.progress.target > 1
      ? {
          progress: t("setup.progress", {
            got: formatCount(task.progress.got),
            target: formatCount(task.progress.target),
          }),
        }
      : {}),
    lead: LEADS.includes(task.id),
    cta: t(CTA[task.id]),
    href: HREF[task.id],
    disabled: state.suspended,
  };
}

/**
 * The visit card's body carries its own price line; the other three do not.
 *
 * Board 8a is explicit that the card is never hidden on a plan that does not
 * include a visit — it is the strongest upgrade argument in the product — so
 * the difference is a sentence and a destination rather than a missing row.
 */
function taskBody(task: SetupTaskRow, state: SetupHubState): string {
  const body = t(`setup.card.${task.id}_body` as never);
  if (task.id !== "visit" || !state.plan) return body;

  return state.plan.siteVisitIncluded
    ? `${body} ${t("setup.card.visit_included", { plan: state.plan.name })}`
    : `${body} ${t("setup.card.visit_priced", {
        fee: formatCount(state.siteVisitFeeAed),
        plan: state.plan.name,
      })}`;
}

/* ── What is already finished stays on the page ──────────────────────────── */

function DoneSummary({ tasks }: { tasks: SetupTaskRow[] }) {
  /*
     Completed tasks are never removed. Sellers look for evidence that the work
     they did was recorded, and a card that vanishes on success reads as work
     that was not.
  */
  const list = tasks.map((task) => t(`setup.card.${task.id}` as never)).join(", ");

  return (
    <div className="flex flex-wrap items-center gap-3.5 rounded-card border border-line bg-paper-sunk px-5 py-4">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-pill bg-ok text-eyebrow text-on-ink"
      >
        ✓
      </span>
      <span className="min-w-0 flex-1 text-body-sm text-muted line-through">
        {t("setup.done_list", { list })}
      </span>
      <Link href="/dashboard/listing" className={buttonClassName({ variant: "link", size: "sm" })}>
        {t("setup.cta.review")}
      </Link>
    </div>
  );
}

/* ── The half of the meter the four cards do not cover ───────────────────── */

function Levers({ state }: { state: SetupHubState }) {
  /*
     Not on board 8a's render, and here on purpose.

     The four cards are worth about half the meter between them. Without this
     list a seller can finish everything on offer, sit short of a hundred, and
     find nothing on the page naming the gap — the one state a completeness
     meter must never reach.

     So it is a footnote rather than a section: no panel, no column heads, and
     the type a step down from the cards above it. It answers a question the
     four cards raise; it is not a fifth thing to do.
  */
  return (
    <section aria-labelledby="setup-levers" className="mt-1">
      <h3 id="setup-levers" className="font-mono text-eyebrow uppercase text-faint">
        {t("setup.levers_title")}
      </h3>
      <table className="mt-2.5 w-full border-collapse">
        <caption className="sr-only">{t("setup.levers_body")}</caption>
        <tbody>
          {state.levers.map((lever) => (
            <tr key={lever.key}>
              <th scope="row" className="py-1 pe-3 text-start text-caption font-normal text-muted">
                {t(`setup.lever.${lever.key}` as never)}
              </th>
              <td className="w-px whitespace-nowrap py-1 text-end font-mono text-eyebrow tabular-nums text-faint">
                {t("setup.lever.earned", {
                  earned: formatCount(lever.earned),
                  total: formatCount(lever.total),
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ── The rail ────────────────────────────────────────────────────────────── */

function AlreadyHappening({ state }: { state: SetupHubState }) {
  const { viewsSinceLive, shortlists, openEnquiries } = state.rail;

  /*
     Three counts, and each says so plainly when it is zero rather than being
     dropped. The panel's job is to make four unpaid tasks feel worth doing, and
     a panel that hides its zeros is a panel a seller learns not to believe. A
     new listing with nothing on it is the launch state, so it is the one that
     had to read honest.
  */
  return (
    <div className="rounded-card border border-line bg-ink px-5 py-[18px] text-on-ink">
      <p className="font-mono text-eyebrow uppercase text-on-ink-faint">
        {t("setup.rail.eyebrow")}
      </p>

      <ul className="mt-3.5 flex list-none flex-col gap-3.5">
        <RailLine
          value={viewsSinceLive}
          some={t("setup.rail.views", { count: viewsSinceLive })}
          none={t("setup.rail.views_none")}
        />
        <RailLine
          value={shortlists}
          some={t("setup.rail.shortlists", { count: shortlists })}
          none={t("setup.rail.shortlists_none")}
        />
        {/*
          The last figure is the one with somebody waiting behind it, so it is
          the only one in moss. `moss-on-ink` is the single accent the palette
          permits on a dark surface.
        */}
        <RailLine
          value={openEnquiries}
          some={t("setup.rail.enquiries", { count: openEnquiries })}
          none={t("setup.rail.enquiries_none")}
          accent
        />
      </ul>

      {/* Only where there is something behind it. A CTA over a zero is a lie. */}
      {openEnquiries > 0 && (
        <Link
          href="/dashboard/leads"
          className="mt-4 flex h-9 items-center justify-center rounded-ctl bg-moss-on-ink text-body-sm font-medium text-moss-on-ink-text transition-colors duration-120 ease-out hover:bg-moss-on-ink-hover focus-visible:outline-none focus-visible:shadow-focus-on-ink"
        >
          {openEnquiries === 1 ? t("setup.rail.open_enquiry") : t("setup.rail.open_enquiries")}
        </Link>
      )}

      {state.publishedAt && (
        <p className="mt-3.5 text-caption text-on-ink-faint">
          {t("setup.rail.measuring_from", { date: formatDate(state.publishedAt) })}
        </p>
      )}
    </div>
  );
}

function RailLine({
  value,
  some,
  none,
  accent = false,
}: {
  value: number;
  some: string;
  none: string;
  /** The figure with somebody waiting behind it. One per panel. */
  accent?: boolean;
}) {
  if (value === 0) {
    return <li className="text-caption text-on-ink-muted">{none}</li>;
  }
  return (
    <li>
      <span
        className={cn(
          "block text-h1 tabular-nums tracking-tight",
          accent ? "text-moss-on-ink" : "text-on-ink",
        )}
      >
        {formatCount(value)}
      </span>
      <span className="mt-1 block text-caption text-on-ink-muted">{some}</span>
    </li>
  );
}

/* ── The one nudge ───────────────────────────────────────────────────────── */

function Reminder({ state }: { state: SetupHubState }) {
  /*
     The panel states the promise and `lib/setup/nudge-job.ts` keeps it: one
     WhatsApp at seventy-two hours if anything is still open, then nothing,
     ever. It is written here rather than left implicit because a seller who
     reads "we do not chase" and is then chased has learned something about the
     product that no other screen can unteach.
  */
  /*
     A queued-but-unsent nudge (`nudgeUsed` without `nudgeSentAt`) says nothing
     rather than promising a second one. There is exactly one, and a panel that
     re-promised it after it had been claimed would be wrong twice: once about
     the future and once about what already happened.
  */
  const body = state.nudgeSentAt
    ? t("setup.reminder.sent", { date: formatDate(state.nudgeSentAt) })
    : t("setup.reminder.body");

  return (
    <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
      <p className="text-body-sm font-medium text-ink">{t("setup.reminder.title")}</p>
      <p className="mt-2 text-caption text-body">{body}</p>
    </div>
  );
}

/* ── Suspended ───────────────────────────────────────────────────────────── */

function SuspendedNotice() {
  /*
     The hub does not help a seller improve a listing nobody can see. The cards
     stay on the page and stop being links: hiding them would lose the reason
     the seller came, and leaving them live would ask for work that reaches
     nobody.
  */
  return (
    <Alert
      tone="warn"
      title={t("setup.suspended_title")}
      live="polite"
      action={
        <Link
          href="/dashboard/verification"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("setup.suspended_link")}
        </Link>
      }
    >
      {t("setup.suspended_body")}
    </Alert>
  );
}

/* ── Concierge ───────────────────────────────────────────────────────────── */

function conciergeRequestView(
  request: Awaited<ReturnType<typeof conciergeOfferFor>>["request"],
  open: boolean,
) {
  if (!request) return null;
  if (!open && request.status !== "loaded") return null;

  return {
    id: request.id,
    status: request.status as ConciergeStatus,
    requestedOn: formatDate(request.requestedAt),
    dueOn: request.dueAt ? formatDate(request.dueAt) : "",
    loadedOn: request.loadedAt ? formatDate(request.loadedAt) : "",
    productsLoaded: request.productsLoaded ?? 0,
    productsLoadedFormatted: formatCount(request.productsLoaded ?? 0),
  };
}
