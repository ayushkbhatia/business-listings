import { redirect } from "next/navigation";
import { ProgressBar, StatusBadge } from "@/components/display";
import { PageEvent } from "@/components/telemetry";
import { recordEvent } from "@/lib/telemetry/record";
import { markDoneSeen, readBaseline } from "@/lib/setup/baseline";
import { setupCompletion, type RankingFactor } from "@/lib/setup/complete";
import { setupHubState } from "@/lib/setup/service";
import { SETUP_TASKS } from "@/lib/setup/tasks";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { t, type MessageKey } from "@/lib/i18n";
import { requireSellerSeat, type SellerSeat } from "../../_shell";
import { Exits } from "./Exits";

/**
 * Board 8e — the terminal state of the first run.
 *
 * It has no inputs, no writes and no state of its own, so nearly all of its
 * specification is about **when it is allowed to appear** and **what each figure
 * is actually reading**. Both are below; the rendering is the easy half.
 *
 * ## The once-only rule is the whole board
 *
 * §1: the seller reaches this screen exactly once, on the transition. A
 * completion screen that can be revisited is not a completion screen, it is a
 * stale dashboard — and the amber card on it promises exactly that, so the
 * promise has to be true before the card can be drawn.
 *
 * `SetupBaseline.doneSeenAt` is the marker, and `markDoneSeen` flips it with an
 * `updateMany` filtered on null so two tabs cannot both count as the first view.
 * Everything after that render is a redirect.
 *
 * ## Why the hub sends people here rather than the task screens
 *
 * The transition is "the last task closed", and no task screen knows whether it
 * was the last one — 8d's send does not know whether photographs are done. The
 * hub knows, because computing that is what it is for. So every task exits to
 * the hub as it always did, and the hub forwards on the one render that finds
 * nothing open.
 *
 * ## What this screen must not claim
 *
 * §4: a full green meter with nothing beside it reads as "you now rank first".
 * It does not mean that, and a seller who believes it will be angry in a week.
 * The second card names the six ranking factors from the same config search
 * ranks by, marks the two this session moved, and stops there — the full
 * explanation belongs on the pricing and verification pages.
 */
export const metadata = { title: t("setup_done.meta_title") };
export const dynamic = "force-dynamic";

/** §1: owner and manager, consistent with the rest of `/dashboard/setup/*`. */
function maySeeSetup(seat: SellerSeat): boolean {
  return seat.actor.roles.some((role) => role === "seller_owner" || role === "seller_manager");
}

export default async function SetupDonePage() {
  const seat = await requireSellerSeat();
  if (!maySeeSetup(seat)) redirect("/dashboard/leads");

  const state = await setupHubState(seat.businessId);
  if (!state) redirect("/dashboard");

  /*
     Suspended, and this is the redirect §5 puts above every other one.

     A completion screen over a listing nobody can see is a lie in the plainest
     sense: the whole page says the storefront is working, and it is hidden.
     Checked before the precondition, because a suspended seller with a task
     still open should land on the suspension notice rather than being bounced
     to a hub that will tell them to carry on working.
  */
  if (state.suspended) {
    await sentAway(seat, "suspended");
    redirect("/dashboard/verification");
  }

  // Never a partial version of this screen. §5.
  if (state.openCount > 0) {
    await sentAway(seat, "tasks_open");
    redirect("/dashboard/setup");
  }

  /*
     The once-only gate, read before it is flipped.

     `markDoneSeen` returns whether this call was the one that marked it, which
     is the same question as "is this the first render" — so the read and the
     write are one statement and there is no window between them for a second
     tab to slip through.
  */
  const baseline = await readBaseline(seat.businessId);
  const alreadySeen = baseline?.doneSeenAt !== null && baseline?.doneSeenAt !== undefined;
  if (alreadySeen) {
    await sentAway(seat, "already_seen");
    redirect(`/dashboard?notice=setup_complete&strength=${state.strength}`);
  }

  const completion = await setupCompletion(seat.businessId, state.strength);
  if (!completion) redirect("/dashboard");

  const first = await markDoneSeen(seat.businessId);
  if (!first) {
    // Somebody else marked it between the read above and this write — a second
    // tab, or a prefetch racing a navigation. They get the screen; this one
    // gets the dashboard, which is what a second view is supposed to get.
    await sentAway(seat, "already_seen");
    redirect(`/dashboard?notice=setup_complete&strength=${state.strength}`);
  }

  /*
     The state fact, written once, where the transition is known.

     `setup_completed` is server-emitted for the reason every other state event
     is: a browser saying the work is finished is the browser's word for it.
     §7's number worth watching rides on it — hours from first hub view to
     completion — and the completion *order* deliberately does not, because
     `setup_task_completed` already writes one row per task with its own
     timestamp and a second copy of that fact is a second thing to get wrong.
  */
  await recordEvent({
    name: "setup_completed",
    businessId: seat.businessId,
    actorId: seat.actor.id,
    props: {
      ...(completion.hoursToComplete === null ? {} : { hours: completion.hoursToComplete }),
      ...(completion.score === null ? {} : { score: completion.score }),
    },
  });

  const score = completion.score;
  const storefront = `/b/${completion.slug}`;

  return (
    <div data-density="comfortable" className="flex min-h-dvh flex-col bg-paper">
      <PageEvent name="setup_done_viewed" props={{ score }} />

      {/*
        No back affordance, deliberately — §1. There is no open task behind this
        screen, and a "← Setup" link would point at a route that now redirects
        straight back here or to the dashboard.
      */}
      <header className="flex flex-none flex-wrap items-center gap-4 border-b border-line bg-card px-6 py-3">
        <h1 className="text-h3 font-medium text-ink">{t("setup_done.eyebrow")}</h1>

        <span aria-hidden="true" className="ms-2 flex items-center gap-1.5">
          {SETUP_TASKS.map((task) => (
            <span key={task} className="h-1.5 w-[22px] rounded-pill bg-moss" />
          ))}
        </span>

        <p className="text-caption text-muted">
          {t("setup_done.progress", {
            count: SETUP_TASKS.length,
            formatted: formatCount(SETUP_TASKS.length),
            total: formatCount(SETUP_TASKS.length),
          })}
        </p>

        <div className="ms-auto">
          <Exits
            compact
            dashboardLabel={t("setup_done.to_dashboard")}
            storefrontLabel={t("setup_done.to_storefront")}
            storefrontHref={storefront}
          />
        </div>
      </header>

      <main className="flex-1 px-8 py-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
          <div className="flex min-w-0 flex-1 flex-col gap-5">
            <div>
              <StatusBadge tone="ok" shape="chip" size="sm">
                {t("setup_done.pill")}
              </StatusBadge>
              <h2 className="mt-3 font-serif text-h1-serif tracking-tight text-ink">
                {t("setup_done.title")}
              </h2>
              <p className="mt-3 max-w-prose text-body-sm text-body">{t("setup_done.intro")}</p>
            </div>

            <div className="rounded-card border border-line bg-card px-5 py-4">
              <ProgressBar
                value={score}
                label={t("setup_done.strength")}
                size="lg"
                emphasis
                tone="ok"
                valueLabel={`${formatCount(score)}%`}
              />
              {/*
                Each half of this sentence is separately earned. §2: a missing
                baseline drops the rise rather than guessing where the seller
                started, and §5: a score short of a hundred drops the "every
                task complete" clause rather than printing 100 over 96.
              */}
              {subtitleFor(completion.baselineScore, completion.fullScore) && (
                <p className="mt-2 text-caption text-muted">
                  {subtitleFor(completion.baselineScore, completion.fullScore)}
                </p>
              )}
            </div>

            <ul className="flex list-none flex-col gap-2.5">
              {completion.ticks.map((tick) => (
                <li key={tick.key} className="flex items-center gap-2.5">
                  <span
                    aria-hidden="true"
                    className="flex size-5 flex-none items-center justify-center rounded-pill bg-ok-line text-caption text-on-ink"
                  >
                    ✓
                  </span>
                  <span className="text-body-sm text-ink">
                    {t(tickKey(tick.key, tick.cover), {
                      count: tick.count,
                      formatted: formatCount(tick.count),
                    })}
                  </span>
                </li>
              ))}
            </ul>

            {/*
              Hidden entirely when the delta is unavailable — §6 is explicit
              that a total must not stand in for a comparison, and §5 that "0
              spec filters" is not a thing to render.

              The search-volume half of the sentence the board draws — "412
              searches last month" — is not here. `SearchQueryLog` records the
              text a buyer typed and how many results came back; it carries no
              facet dimension, so there is no honest way to say how many people
              searched *that combination*. Dropping the clause and keeping the
              gain follows §2's own rule for a missing sub-figure.
            */}
            {completion.specFilterGain !== null && (
              <p className="rounded-card bg-fill px-5 py-4 text-body-sm text-body">
                {t("setup_done.filters", {
                  count: completion.specFilterGain,
                  formatted: formatCount(completion.specFilterGain),
                })}
              </p>
            )}

            <Exits
              dashboardLabel={t("setup_done.to_dashboard")}
              storefrontLabel={t("setup_done.to_storefront")}
              storefrontHref={storefront}
            />
          </div>

          <aside className="flex w-full shrink-0 flex-col gap-3.5 lg:w-[420px]">
            <div className="rounded-card border border-line bg-card px-5 py-4">
              <p className="font-mono text-eyebrow uppercase text-muted">
                {t("setup_done.changes_eyebrow")}
              </p>
              <ul className="mt-3 flex list-none flex-col divide-y divide-line">
                {(
                  [
                    "setup_done.changes_products",
                    "setup_done.changes_routing",
                    "setup_done.changes_reply",
                  ] as const
                ).map((key, index) => (
                  <li
                    key={key}
                    className={cn("text-body-sm text-body", index === 0 ? "pb-3" : "py-3 last:pb-0")}
                  >
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>

            <RankingCard factors={completion.factors} />

            <div className="rounded-card border border-warn-line bg-warn-wash px-5 py-4">
              <p className="font-mono text-eyebrow uppercase text-warn-ink">
                {t("setup_done.once_eyebrow")}
              </p>
              <p className="mt-2 text-body-sm text-warn-ink">{t("setup_done.once_body")}</p>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

/* ── The card that stops "100%" reading as "first" ───────────────────────── */

/**
 * §4, and the reason the board keeps this screen at all.
 *
 * Six bars and one sentence. The weights come from `liveWeights()` — the same
 * config search ranks by — so a staff member retuning ranking in admin moves
 * this card with it rather than leaving it stating last quarter's numbers.
 */
function RankingCard({ factors }: { factors: readonly RankingFactor[] }) {
  const total = factors.reduce((sum, factor) => sum + factor.weight, 0);

  return (
    <div className="rounded-card border border-line bg-paper-sunk px-5 py-4">
      <p className="text-body-sm font-medium text-ink">{t("setup_done.rank_title")}</p>
      <p className="mt-2 text-body-sm text-body">
        {t("setup_done.rank_body", {
          count: factors.length,
          formatted: formatCount(factors.length),
        })}
      </p>

      <ul className="mt-3 flex list-none flex-col gap-1.5">
        {factors.map((factor) => (
          <li key={factor.key} className="flex items-center gap-3">
            <span
              className={cn(
                "w-[130px] flex-none text-caption",
                factor.moved || factor.open ? "font-medium text-ink" : "text-body",
              )}
            >
              {t(`setup_done.rank.${factor.key}` as MessageKey)}
            </span>
            {/*
              Decorative. The weight is printed beside it as a number, so a
              reader gets the fact once in words and once as a picture — a bar
              carrying its own label would be the same number twice.
            */}
            <span aria-hidden="true" className="h-1.5 flex-1 rounded-pill bg-track">
              <span
                className={cn("block h-full rounded-pill", factor.moved ? "bg-moss" : "bg-line-strong")}
                style={{ width: `${Math.round((factor.weight / Math.max(1, total)) * 100)}%` }}
              />
            </span>
            <span className="w-8 flex-none text-end font-mono text-caption tabular-nums text-muted">
              {formatCount(factor.weight)}
            </span>
            {/*
              Named rather than left to the colour. §09.2: never a symbol or a
              tone carrying meaning on its own, and "marked" is exactly the kind
              of thing a screen reader has no way to see.
            */}
            {(factor.moved || factor.open) && (
              <span className="sr-only">
                {factor.moved ? t("setup_done.rank_moved") : t("setup_done.rank_open")}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-caption text-muted">{t("setup_done.rank_note")}</p>
    </div>
  );
}

/* ── The two conditional clauses ─────────────────────────────────────────── */

function subtitleFor(baseline: number | null, fullScore: boolean): string | null {
  if (baseline !== null && fullScore) {
    return t("setup_done.strength_rose", { from: formatCount(baseline) });
  }
  if (baseline !== null) return t("setup_done.strength_rose_partial", { from: formatCount(baseline) });
  if (fullScore) return t("setup_done.strength_complete");
  return null;
}

/** The photo line names the cover separately, because a cover is not a photo count. */
function tickKey(key: "photos" | "products" | "team", cover: boolean | undefined): MessageKey {
  if (key !== "photos") return `setup_done.tick.${key}` as MessageKey;
  return (cover ? "setup_done.tick.photos" : "setup_done.tick.photos_no_cover") as MessageKey;
}

/**
 * Record why somebody was turned away, then let the caller redirect.
 *
 * Server-emitted because the route knows the reason and no browser does. A
 * rising `already_seen` is the signal that something is linking here — an
 * email, a bookmark, a stale tab — which §1 says must not exist, so it is worth
 * being able to see.
 */
async function sentAway(seat: SellerSeat, reason: string): Promise<void> {
  await recordEvent({
    name: "setup_done_redirected",
    businessId: seat.businessId,
    actorId: seat.actor.id,
    props: { reason },
  });
}
