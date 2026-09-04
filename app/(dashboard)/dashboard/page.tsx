import Link from "next/link";
import { buttonClassName } from "@/components/primitives";
import { Alert, PlanBadge, StatCard, type PlanTier } from "@/components/display";
import { CompletenessMeter, ResponseTime } from "@/components/domain";
import { Card, Panel } from "@/components/structure";
import { getOverview, usageOf, type Overview, type MissedEnquiryRow } from "@/lib/db/queries/overview";
import { cheapestPlanUnlocking, cheapestPlanWith, type PlanCaps } from "@/lib/plan/entitlements";
import { formatCount, formatDate, formatDuration, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import type { SetupChrome } from "@/lib/setup/service";
import { getNavBadges, getSetupProgress, requireSellerSeat, SellerPage } from "./_shell";

/**
 * Boards 3a and 11a — the seller's overview, on both plans.
 *
 * One page, not two. The Free board is not a degraded Pro board; it is the same
 * figures with a different argument laid over them. Splitting them into two
 * files is how the two screens start disagreeing about how many enquiries a
 * seller had this month.
 *
 * What differs is what the plan can answer for. On Free the missed-enquiry
 * panel is the page's argument and sits directly under the reply queue; on a
 * plan with no cap it cannot be reached, so it is not rendered at all. Locked
 * panels are dimmed and named, never hidden — a seller cannot want what they
 * cannot see.
 *
 * The page opens on what needs a reply. An SME owner opens this product to
 * answer someone, not to admire their numbers, so the charts are a link.
 */
export const metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; strength?: string }>;
}) {
  const seat = await requireSellerSeat();
  const [{ notice, strength }, overview, badges, setup] = await Promise.all([
    searchParams,
    getOverview(seat.businessId),
    getNavBadges(seat.businessId),
    getSetupProgress(seat.businessId),
  ]);
  if (!overview) return null;

  const enquiries = usageOf(overview, "enquiries");
  const planTier = tierOf(overview.plan.id);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      setup={setup}
      activeHref="/dashboard"
      eyebrow={t("overview.eyebrow")}
      title={seat.businessName}
      meta={<PlanBadge plan={planTier} label={overview.plan.name} size="sm" />}
    >
      <div className="flex flex-col gap-5">
        {/*
          Board 2a sends a seller here when they open the claim flow while
          already holding a claimed listing, and the redirect says why rather
          than bouncing them silently. A person who lands somewhere they did not
          ask for and is told nothing concludes the link was broken.
        */}
        {notice === "one_business" && (
          <Alert tone="info" live="polite">
            {t("claim.already_yours")}
          </Alert>
        )}

        {/*
          The flash the hub redirects with. It carries the figure rather than
          saying "all done", because the number is the thing the seller has
          been working on and "complete" on its own is a word about the product
          rather than about them.
        */}
        {notice === "setup_complete" && (
          <Alert tone="ok" live="polite">
            {t("setup.complete_flash", {
              strength: strength ?? String(overview.profileStrength ?? 100),
            })}
          </Alert>
        )}

        {/*
          Board 8a's own entry point. The hub has no nav row — it is temporary,
          and a permanent one would still be there a year later reading "nothing
          left" — so this banner and the sidebar figure are the two ways in, and
          both stop rendering when there is nothing left to do.
        */}
        {setup && setup.openCount > 0 && <SetupBanner setup={setup} />}

        <ReplyQueue overview={overview} />

        {/*
          Only where the cap can actually be hit. On Pro there is no cap, so the
          panel has nothing to argue and its absence is not a locked feature —
          it is a question that does not apply.
        */}
        {enquiries.cap !== null && <MissedPanel overview={overview} />}

        <Standing overview={overview} />
        <Allowances overview={overview} />
        <LockedFeatures overview={overview} />
      </div>
    </SellerPage>
  );
}

function tierOf(planId: string): PlanTier {
  return planId === "pro" ? "pro" : planId === "basic" ? "basic" : "free";
}

/* ── Finish setting up ───────────────────────────────────────────────────── */

function SetupBanner({ setup }: { setup: SetupChrome }) {
  /*
     `openPoints`, not `100 - strength`. The gap to a hundred includes two
     levers no card offers — who you are, and how completely the catalogue is
     specified — so quoting the gap would promise points these tasks do not pay,
     which is the failure mode the hub's own chips exist to avoid.
  */
  return (
    <Alert
      tone="info"
      title={t("overview.setup_banner_title")}
      action={
        <Link
          href="/dashboard/setup"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("overview.setup_banner_action")}
        </Link>
      }
    >
      {t("overview.setup_banner", {
        count: setup.openCount,
        formatted: formatCount(setup.openCount),
        points: formatCount(setup.openPoints),
      })}
    </Alert>
  );
}

/* ── What needs a reply ──────────────────────────────────────────────────── */

function ReplyQueue({ overview }: { overview: Overview }) {
  const { awaitingReply, threadsAwaitingReply, quotesOut, reviewsAwaitingReply } = overview;
  const nothingWaiting =
    awaitingReply === 0 && threadsAwaitingReply === 0 && reviewsAwaitingReply === 0;

  return (
    <Panel
      title={t("overview.needs_reply")}
      description={t("overview.needs_reply_body")}
      actions={
        <Link
          href="/dashboard/leads"
          className={buttonClassName({ variant: "secondary", size: "sm" })}
        >
          {t("overview.open_leads")}
        </Link>
      }
    >
      {nothingWaiting ? (
        <div>
          <p className="text-body-sm text-ink">{t("overview.all_clear")}</p>
          <p className="mt-1 max-w-prose text-caption text-muted">
            {t("overview.all_clear_body")}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t("overview.awaiting")} value={formatCount(awaitingReply)} hero />
          <StatCard label={t("overview.threads")} value={formatCount(threadsAwaitingReply)} hero />
          <StatCard label={t("overview.quotes_out")} value={formatCount(quotesOut)} hero />
          <StatCard
            label={t("overview.reviews_unanswered")}
            value={formatCount(reviewsAwaitingReply)}
            hero
          />
        </div>
      )}
    </Panel>
  );
}

/* ── Board 11a — the enquiries a cap cost them ───────────────────────────── */

function MissedPanel({ overview }: { overview: Overview }) {
  const enquiries = usageOf(overview, "enquiries");
  const cap = enquiries.cap ?? 0;
  const next = cheapestPlanUnlocking(
    overview.allPlans,
    "enquiries",
    overview.usage.enquiriesThisMonth,
    overview.plan.id,
  );

  if (overview.missedThisMonth === 0) {
    return (
      <Panel title={t("overview.missed_title")} eyebrow={t("overview.this_month")}>
        <p className="text-body-sm text-ink">{t("overview.missed_none")}</p>
        <p className="mt-1 max-w-prose text-caption text-muted">
          {t("overview.missed_none_body", { cap: String(cap) })}
        </p>
        <p className="mt-3 text-caption text-muted">{capLine(enquiries, cap)}</p>
      </Panel>
    );
  }

  const body =
    overview.missedThisMonth === 1
      ? t("overview.missed_body_one", { cap: String(cap), plan: overview.plan.name })
      : t("overview.missed_body", {
          n: formatCount(overview.missedThisMonth),
          cap: String(cap),
          plan: overview.plan.name,
        });

  return (
    <Panel
      title={t("overview.missed_title")}
      eyebrow={t("overview.this_month")}
      description={body}
      padded={false}
      actions={
        next ? (
          <Link href="/dashboard/billing/change" className={buttonClassName({ size: "sm" })}>
            {t("overview.move_to", {
              plan: next.name,
              price: formatCount(next.monthlyPriceAed),
            })}
          </Link>
        ) : undefined
      }
      footer={
        overview.missedThisMonth > overview.missed.length ? (
          <p className="text-caption text-muted">
            {t("overview.missed_more", { n: formatCount(overview.missedThisMonth) })}
          </p>
        ) : (
          <p className="text-caption text-muted">{t("overview.free_is_free")}</p>
        )
      }
    >
      <MissedTable rows={overview.missed} cap={cap} />
    </Panel>
  );
}

function MissedTable({ rows, cap }: { rows: readonly MissedEnquiryRow[]; cap: number }) {
  const now = new Date();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] border-collapse text-left">
        <caption className="sr-only">{t("overview.missed_caption")}</caption>
        <thead>
          <tr className="bg-paper-sunk">
            <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
              {t("overview.missed_col_requirement")}
            </th>
            <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
              {t("overview.missed_col_items")}
            </th>
            <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
              {t("overview.missed_col_area")}
            </th>
            <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
              {t("overview.missed_col_needed")}
            </th>
            <th scope="col" className="px-3 py-2 text-caption font-normal text-muted">
              {t("overview.missed_col_missed")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.enquiryId} className="border-t border-line align-top">
              {/*
                The reference, not a link. This enquiry went to other suppliers
                and there is nothing here for this seller to open — a link to a
                403 would be worse than the plain fact.
              */}
              <th scope="row" className="px-3 py-3 text-left font-normal">
                <span className="font-mono text-caption text-faint">{row.ref}</span>
                <span className="mt-0.5 block max-w-prose text-body-sm text-ink">
                  {row.requirement}
                </span>
              </th>
              <td className="px-3 py-3 text-body-sm text-ink">
                {row.lines.length === 0 ? (
                  <span className="text-muted">—</span>
                ) : (
                  <ul className="space-y-0.5">
                    {row.lines.slice(0, 3).map((line, i) => (
                      <li key={i} className="text-body-sm">
                        <span className="font-mono tabular-nums text-muted">
                          {formatCount(line.qty)}
                          {line.unit ? ` ${line.unit}` : ""}
                        </span>{" "}
                        {line.description}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
              <td className="px-3 py-3 text-body-sm text-ink">
                {row.deliverToArea ?? <span className="text-muted">—</span>}
              </td>
              <td className="px-3 py-3 text-body-sm text-ink">
                {row.neededBy ? formatDate(row.neededBy) : <span className="text-muted">—</span>}
              </td>
              <td className="px-3 py-3">
                <span className="block text-body-sm text-ink">
                  {formatRelative(row.missedAt, { now })}
                </span>
                <span className="mt-0.5 block text-caption text-muted">
                  {row.stillOpen ? t("overview.missed_still_open") : t("overview.missed_closed")}
                </span>
                <span className="mt-0.5 block text-caption text-faint">
                  {t("overview.reason.at_monthly_cap", { cap: String(cap) })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Measured, never claimed ─────────────────────────────────────────────── */

function Standing({ overview }: { overview: Overview }) {
  return (
    <Panel title={t("overview.standing")}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <ResponseTime
            medianMs={overview.responseTimeMedianMs}
            {...(overview.responseTimeMedianMs !== null
              ? {
                  durationLabel: formatDuration(overview.responseTimeMedianMs),
                  label: t("overview.replies_in", {
                    duration: formatDuration(overview.responseTimeMedianMs),
                  }),
                }
              : {})}
            unmeasuredLabel={t("overview.response_unmeasured")}
          />
        </div>
        <div>
          {overview.profileStrength === null ? (
            <p className="text-body-sm text-muted">{t("overview.strength_unmeasured")}</p>
          ) : (
            <CompletenessMeter
              filled={overview.profileStrength}
              total={100}
              valueLabel={`${overview.profileStrength}%`}
              label={t("overview.profile_strength")}
            />
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ── What the plan allows ────────────────────────────────────────────────── */

function capLine(a: ReturnType<typeof usageOf>, cap: number): string {
  if (a.cap === null) return "";
  if (a.atCap) return t("overview.at_cap", { cap: String(cap) });
  if (a.remaining === 1) return t("overview.remaining_one");
  return t("overview.remaining", { n: formatCount(a.remaining ?? 0) });
}

function Allowances({ overview }: { overview: Overview }) {
  const rows = [
    { key: "enquiries" as const, label: t("overview.enquiries_received"), used: overview.usage.enquiriesThisMonth },
    { key: "products" as const, label: t("overview.products"), used: overview.usage.products },
    { key: "locations" as const, label: t("overview.locations"), used: overview.usage.locations },
    { key: "photos" as const, label: t("overview.photos"), used: overview.usage.photos },
    { key: "seats" as const, label: t("overview.seats"), used: overview.usage.seats },
  ];

  return (
    <Card padded>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {rows.map((row) => {
          const a = usageOf(overview, row.key);
          return (
            <StatCard
              key={row.key}
              label={row.label}
              value={formatCount(row.used)}
              caption={
                a.cap === null
                  ? t("overview.unlimited", { plan: overview.plan.name })
                  : t("overview.of_cap", { used: formatCount(row.used), cap: formatCount(a.cap) })
              }
            />
          );
        })}
      </div>
    </Card>
  );
}

/* ── Named, dimmed, priced ───────────────────────────────────────────────── */

/**
 * Two features that are genuinely a column on the plan.
 *
 * Analytics and sponsored placement are boards 3l and 11e and are not built
 * yet — and, more to the point, neither is a flag the Plan table holds. Dimming
 * them here would mean inventing an entitlement and then naming a price for it,
 * which is the sort of thing a seller finds out is untrue at the moment they
 * pay. `customDomain` is a real boolean on a real row, so the line under the
 * panel is checkable — and since site visits were withdrawn it is the only one
 * left, which is why this grid now holds a single panel rather than a pair.
 */
function LockedFeatures({ overview }: { overview: Overview }) {
  const domainPlan = cheapestPlanWith(overview.allPlans, "customDomain", overview.plan.id);

  return (
    <div className="grid gap-5">
      <Panel
        title={t("overview.locked_domain")}
        {...lockedProps(t("overview.locked_domain"), domainPlan)}
      >
        <p className="max-w-prose text-body-sm text-muted">{t("overview.locked_domain_body")}</p>
      </Panel>

    </div>
  );
}

/**
 * A locked panel names the plan and the price, or it does not lock.
 *
 * `null` from the entitlement helpers means there is nothing to sell — the
 * seller is already on the best plan for it. Rendering a lock then would be an
 * advert for a product that does not exist, so the panel opens instead.
 */
function lockedProps(feature: string, plan: PlanCaps | null) {
  if (!plan) return {};
  return {
    locked: {
      label: t("overview.locked_upgrade", {
        feature,
        plan: plan.name,
        price: formatCount(plan.monthlyPriceAed),
      }),
      action: (
        <Link
          href="/dashboard/billing/change"
          className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("overview.see_plans")}
        </Link>
      ),
    },
  };
}
