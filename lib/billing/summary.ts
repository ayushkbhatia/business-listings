import "server-only";
import { prisma } from "@/lib/db/client";
import { assertCanManageBilling } from "@/lib/auth/guards";
import type { Actor } from "@/lib/auth/roles";
import { allowance, capFor, effectiveCaps, type Allowance, type PlanCaps } from "@/lib/plan/entitlements";
import { storedTotals } from "./invoice";
import { monthlyValueFils, offersAnnual, periodPriceAed, type BillingTerm } from "./period";
import { FILS_PER_AED, VAT_RATE, vatOn } from "./proration";
import { nextAction, SCHEDULE, GRACE_AFTER_FINAL_DAYS, type DunningStage } from "./dunning";
import { pendingChangeFor, type PendingChange } from "./schedule";
import { paymentProvider } from "./provider";
import { t } from "@/lib/i18n";
import type { Usage } from "./plan-grid";

/**
 * Board 3m, read once.
 *
 * Every figure the screen prints comes from here, and it comes from a query.
 * That is not a style preference on this surface — a directory whose numbers are
 * true is the whole asset, and a billing screen is where a wrong one costs
 * money rather than credibility. The pair of boards exists because two of them
 * disagreed about one invoice.
 *
 * ## What is deliberately not computed here
 *
 * Invoice totals. They are read, never derived: `storedTotals` is the one reader
 * and it says whether the figures were stored or fell back to the lines. See
 * ./invoice.
 */

const PLAN_SELECT = {
  id: true, name: true, monthlyPriceAed: true, enquiriesPerMonth: true, productLimit: true,
  locationLimit: true, photoLimit: true, categoryLimit: true, storageMb: true, teamSeats: true,
  rankingMultiplier: true, customDomain: true, analytics: true, csvImport: true,
  sponsoredEligible: true, sortOrder: true, annualMonthsCharged: true,
} as const;

export interface InvoiceRowView {
  id: string;
  ref: string;
  issuedAt: Date | null;
  status: string;
  isCreditNote: boolean;
  /** What it corrects, on a credit note. */
  correctsRef: string | null;
  /** Gross, in fils. Negative on a credit note. */
  totalFils: number;
  /** False where the figure was derived from the lines rather than stored. */
  stored: boolean;
  /** One line, built from the lines. `Pro subscription + sponsored placement`. */
  description: string;
}

export interface PeriodLine {
  key: string;
  label: string;
  /** Whole fils, ex-VAT. */
  fils: number;
  /** The dates this line covers, where it has its own. Q7: placement does. */
  from: Date | null;
  to: Date | null;
}

export interface PeriodView {
  lines: PeriodLine[];
  subtotalFils: number;
  vatFils: number;
  totalFils: number;
  vatRate: number;
  /** When it falls due. The subscription's renewal, not a placement's end. */
  dueAt: Date;
}

export interface FailedPayment {
  stage: DunningStage;
  /** What we tried to take, in fils. */
  amountFils: number;
  failedOn: Date;
  /** Verbatim from the provider, or null where it gave nothing. */
  reason: string | null;
  /** When the sequence tries again. Null once it has run out of retries. */
  retryAt: Date | null;
  /** The day the plan drops if nothing changes. Criterion 12 counts to here. */
  dropsOn: Date;
}

export interface BillingSummary {
  plan: PlanCaps;
  /** Null on Free, which has no subscription row. */
  term: BillingTerm | null;
  status: string;
  renewsAt: Date | null;
  periodStartedAt: Date | null;
  /** Set once a cancellation is scheduled. */
  endsAt: Date | null;
  /** What a year costs on this plan, and what it saves. Null where none is sold. */
  annual: { priceAed: number; savingAed: number } | null;
  usage: Usage;
  allowances: Record<"products" | "locations" | "seats" | "storage", Allowance>;
  period: PeriodView | null;
  invoices: InvoiceRowView[];
  card: { brand: string; last4: string; expiry: string } | null;
  pendingChange: PendingChange | null;
  failedPayment: FailedPayment | null;
  /**
   * The verified custom domain, where there is one.
   *
   * Board 11f's `ENDS WITH PRO` names it — `shop.alwaha.ae stops resolving on
   * 14 Sep` — and only a verified one is worth naming: an unverified hostname
   * has never resolved, so a downgrade does not stop it doing anything.
   */
  domain: string | null;
  /**
   * Placements running now or booked ahead, with their own end dates.
   *
   * Q7: a placement is a separately-termed booking, so its dates are its own.
   * `11f` saying it "runs to 30 Sep" and `3m` billing it inside a cycle ending
   * on the 13th were both right about different things.
   */
  placements: { label: string; endsOn: Date | null }[];
  /** What Free would keep of this seller's live products, for the cancel card. */
  freeKeepsProducts: number;
  freeEnquiriesPerMonth: number | null;
  /** False when no gateway is configured, so the screen can say so. */
  providerIsLive: boolean;
}

/**
 * Everything board 3m renders.
 *
 * The guard is `billing.manage` — owner and finance, per the permission matrix.
 * Q6 asks owner-only versus owner-and-admin and answers owner-only; the matrix
 * separates *seeing* the invoices from *deciding* what the business buys, and
 * `plan.change` is the owner-only half. A manager and a sales seat hold neither.
 */
export async function billingSummary(
  actor: Actor,
  businessId: string,
  now = new Date(),
): Promise<BillingSummary> {
  assertCanManageBilling(actor);

  const [business, freePlan, invoices, products, locations, seats, media, placements, pendingChange] =
    await Promise.all([
      prisma.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          plan: { select: PLAN_SELECT },
          customDomain: { select: { hostname: true, verifiedAt: true } },
          subscription: {
            select: {
              status: true,
              term: true,
              renewsAt: true,
              periodStartedAt: true,
              endsAt: true,
              entitlementSnapshot: true,
              dunningStage: true,
              pastDueSince: true,
              plan: { select: { monthlyPriceAed: true, annualMonthsCharged: true, name: true } },
              attempts: {
                orderBy: { attemptedAt: "desc" },
                take: 1,
                select: { amountFils: true, succeeded: true, providerMessage: true, attemptedAt: true },
              },
            },
          },
          paymentMethod: {
            select: { brand: true, last4: true, expiryMonth: true, expiryYear: true },
          },
        },
      }),
      prisma.plan.findUnique({ where: { id: "free" }, select: PLAN_SELECT }),
      prisma.invoice.findMany({
        where: { businessId, status: { not: "draft" } },
        orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
        take: 24,
        select: {
          id: true,
          ref: true,
          issuedAt: true,
          status: true,
          docType: true,
          vatRate: true,
          subtotalFils: true,
          vatFils: true,
          totalFils: true,
          corrects: { select: { ref: true } },
          lines: { select: { kind: true, description: true, amountAed: true, qty: true } },
        },
      }),
      prisma.product.count({ where: { businessId, status: "live" } }),
      prisma.location.count({ where: { businessId, published: true } }),
      seatsUsed(businessId, now),
      prisma.media.aggregate({ where: { businessId }, _sum: { bytes: true } }),
      prisma.placementSlot.findMany({
        where: { businessId, OR: [{ endsOn: null }, { endsOn: { gte: now } }] },
        orderBy: { startsOn: "asc" },
        select: {
          monthlyPriceAed: true,
          startsOn: true,
          endsOn: true,
          emirate: true,
          category: { select: { name: true } },
        },
      }),
      pendingChangeFor(businessId),
    ]);

  const livePlan: PlanCaps = business.plan
    ? toCaps(business.plan)
    : freeOr(freePlan);
  // The caps this subscription was signed up on, where they were frozen. A plan
  // edit must not move somebody who has already paid for the old numbers.
  const plan = effectiveCaps(livePlan, business.subscription?.entitlementSnapshot);

  const usage: Usage = {
    products,
    locations,
    seats,
    storageMb: Math.ceil(Number(media._sum.bytes ?? 0) / (1024 * 1024)),
  };

  const subscription = business.subscription;
  const term = subscription?.term ?? null;

  return {
    plan,
    term,
    status: subscription?.status ?? "active",
    renewsAt: subscription?.renewsAt ?? null,
    periodStartedAt: subscription?.periodStartedAt ?? null,
    endsAt: subscription?.endsAt ?? null,
    annual: annualOf(plan, business.plan?.annualMonthsCharged ?? null),
    usage,
    allowances: {
      products: allowance(plan, "products", usage.products),
      locations: allowance(plan, "locations", usage.locations),
      seats: allowance(plan, "seats", usage.seats),
      storage: allowance(plan, "storage", usage.storageMb),
    },
    period: subscription
      ? periodOf(plan, subscription.term, subscription.renewsAt, placements, now)
      : null,
    invoices: invoices.map(toInvoiceRow),
    card: business.paymentMethod
      ? {
          brand: business.paymentMethod.brand,
          last4: business.paymentMethod.last4,
          expiry: expiryOf(business.paymentMethod.expiryMonth, business.paymentMethod.expiryYear),
        }
      : null,
    pendingChange,
    failedPayment: failedPaymentOf(subscription, now),
    domain: business.customDomain?.verifiedAt ? business.customDomain.hostname : null,
    placements: placements.map((placement) => ({
      label: placement.category.name,
      endsOn: placement.endsOn,
    })),
    /*
       What Free would keep, for the cancel card.

       `min(cap, live)` and not the cap: a seller with four products does not
       need telling that ten of them stay. Board 3f §6 owns the rule and board
       11f's Free column renders the same figure, so both read `capFor` rather
       than either writing the number down.
    */
    freeKeepsProducts: keepsOnFree(freePlan, usage.products),
    freeEnquiriesPerMonth: freePlan ? capFor(toCaps(freePlan), "enquiries") : null,
    providerIsLive: paymentProvider().live,
  };
}

function toCaps(row: {
  id: string;
  name: string;
  monthlyPriceAed: unknown;
  rankingMultiplier: unknown;
  enquiriesPerMonth: number | null;
  productLimit: number | null;
  locationLimit: number | null;
  photoLimit: number | null;
  categoryLimit: number | null;
  storageMb: number | null;
  teamSeats: number;
  customDomain: boolean;
  analytics: boolean;
  csvImport: boolean;
  sponsoredEligible: boolean;
  sortOrder: number;
  annualMonthsCharged: number | null;
}): PlanCaps {
  return {
    ...row,
    monthlyPriceAed: Number(row.monthlyPriceAed),
    rankingMultiplier: Number(row.rankingMultiplier),
  };
}

/**
 * Free, or a Free-shaped nothing.
 *
 * `Business.planId` is nullable — an imported licence record never chose a plan
 * — and the seed always has a `free` row. The fallback is for a database where
 * it does not, and it caps nothing rather than everything: a missing plan row
 * must not silently hand somebody unlimited products.
 */
function freeOr(plan: Parameters<typeof toCaps>[0] | null): PlanCaps {
  if (plan) return toCaps(plan);
  return {
    id: "free", name: "Free", monthlyPriceAed: 0, enquiriesPerMonth: 0, productLimit: 0,
    locationLimit: 0, photoLimit: 0, categoryLimit: 0, storageMb: 0, teamSeats: 1,
    rankingMultiplier: 1, customDomain: false, analytics: false, csvImport: false,
    sponsoredEligible: false, sortOrder: 0,
  };
}

function keepsOnFree(plan: Parameters<typeof toCaps>[0] | null, live: number): number {
  if (!plan) return 0;
  const cap = capFor(toCaps(plan), "products");
  return cap === null ? live : Math.min(cap, live);
}

/** Seats taken, counting pending invitations. The same population board 7d meters. */
async function seatsUsed(businessId: string, now: Date): Promise<number> {
  const [people, invited] = await Promise.all([
    prisma.user.count({ where: { businessId } }),
    prisma.teamInvite.count({
      where: { businessId, acceptedAt: null, revokedAt: null, expiresAt: { gte: now } },
    }),
  ]);
  return people + invited;
}

function annualOf(
  plan: PlanCaps,
  annualMonthsCharged: number | null,
): { priceAed: number; savingAed: number } | null {
  const termPlan = { monthlyPriceAed: plan.monthlyPriceAed, annualMonthsCharged };
  if (!offersAnnual(termPlan)) return null;
  const priceAed = periodPriceAed(termPlan, "annual");
  return { priceAed, savingAed: plan.monthlyPriceAed * 12 - priceAed };
}

/**
 * What falls due at the end of this period.
 *
 * The subscription line plus every placement running inside it. Q7 settles that
 * a placement is a **separately-termed booking**, so its own dates go on the
 * line rather than the subscription's — board 11f says the placement "runs to
 * 30 Sep" while `3m` billed it inside a 14 Aug – 13 Sep cycle, and both could
 * not be true.
 */
function periodOf(
  plan: PlanCaps,
  term: BillingTerm,
  renewsAt: Date,
  placements: readonly {
    monthlyPriceAed: number;
    startsOn: Date;
    endsOn: Date | null;
    emirate: string | null;
    category: { name: string };
  }[],
  now: Date,
): PeriodView {
  const lines: PeriodLine[] = [];

  const planFils = Math.round(
    periodPriceAed({ monthlyPriceAed: plan.monthlyPriceAed, annualMonthsCharged: null }, "monthly") *
      FILS_PER_AED,
  );
  if (term === "annual" || planFils > 0) {
    lines.push({
      key: "subscription",
      label: plan.name,
      fils: monthlyValueFils({ monthlyPriceAed: plan.monthlyPriceAed, annualMonthsCharged: null }, "monthly"),
      from: null,
      to: renewsAt,
    });
  }

  for (const placement of placements) {
    // Not yet started is not yet billed. A booking dated next month is a real
    // row and belongs on next month's invoice, not this one.
    if (placement.startsOn > renewsAt) continue;
    lines.push({
      key: `placement:${placement.category.name}:${placement.startsOn.toISOString()}`,
      label: placement.category.name,
      fils: Math.round(placement.monthlyPriceAed * FILS_PER_AED),
      from: placement.startsOn > now ? placement.startsOn : null,
      to: placement.endsOn,
    });
  }

  const subtotalFils = lines.reduce((sum, line) => sum + line.fils, 0);
  const vatFils = vatOn(subtotalFils);

  return {
    lines,
    subtotalFils,
    vatFils,
    totalFils: subtotalFils + vatFils,
    vatRate: VAT_RATE,
    dueAt: renewsAt,
  };
}

function toInvoiceRow(invoice: {
  id: string;
  ref: string;
  issuedAt: Date | null;
  status: string;
  docType: string;
  vatRate: unknown;
  subtotalFils: number | null;
  vatFils: number | null;
  totalFils: number | null;
  corrects: { ref: string } | null;
  lines: readonly { kind: string; description: string; amountAed: unknown; qty: number }[];
}): InvoiceRowView {
  const totals = storedTotals(invoice as Parameters<typeof storedTotals>[0]);
  return {
    id: invoice.id,
    ref: invoice.ref,
    issuedAt: invoice.issuedAt,
    status: invoice.status,
    isCreditNote: invoice.docType === "credit_note",
    correctsRef: invoice.corrects?.ref ?? null,
    totalFils: totals.totalFils,
    stored: totals.stored,
    description: describe(invoice.lines),
  };
}

/**
 * `Pro subscription + sponsored placement`, from the lines that are there.
 *
 * Built rather than stored, because it is a summary of the document and not a
 * figure on it — nothing reconciles against this string.
 *
 * This used to `join(" + ")` the raw `InvoiceLineKind` values, so a pro-rated
 * upgrade rendered `subscription + subscription_credit` on the seller's own
 * screen: two database enum names and an underscore. The kinds are the right
 * thing to summarise by — the descriptions carry a plan name and a day count
 * and would make a different sentence on every row — but they have to be said
 * in words.
 *
 * A credit beside a subscription line is not a third thing the seller bought.
 * It is what a plan change looks like, so the pair reads as one.
 */
function describe(lines: readonly { kind: string; description: string }[]): string {
  if (lines.length === 1) return lines[0]?.description ?? "";

  const kinds = new Set(lines.map((line) => line.kind));
  if (kinds.has("subscription") && kinds.has("subscription_credit")) {
    return t("billing.invoices.plan_change");
  }

  return [...kinds]
    .map((kind) => t(`billing.invoices.kind.${kind}` as "billing.invoices.kind.subscription"))
    .join(t("billing.invoices.kind_join"));
}

function expiryOf(month: number, year: number): string {
  return `${String(month).padStart(2, "0")}/${String(year).slice(-2)}`;
}

/**
 * Where a failed payment has got to, and what happens next.
 *
 * The state neither board had. Criterion 12 is a promise about what does *not*
 * happen — no downgrade and no listing change during the grace — and the screen
 * can only make it if it can say when the grace ends. `dropsOn` is that date,
 * and it comes from the same `SCHEDULE` the job runs on rather than from a
 * sentence written beside it.
 */
function failedPaymentOf(
  subscription: {
    dunningStage: string;
    pastDueSince: Date | null;
    attempts: readonly {
      amountFils: number;
      succeeded: boolean;
      providerMessage: string | null;
      attemptedAt: Date;
    }[];
  } | null,
  now: Date,
): FailedPayment | null {
  if (!subscription?.pastDueSince) return null;
  const stage = subscription.dunningStage as DunningStage;
  if (stage === "none") return null;

  const failed = subscription.attempts.find((attempt) => !attempt.succeeded);
  const since = subscription.pastDueSince;
  const next = nextAction(stage, since, now);

  const dropsOn = new Date(
    since.getTime() + (SCHEDULE.final + GRACE_AFTER_FINAL_DAYS) * 86_400_000,
  );

  return {
    stage,
    amountFils: failed?.amountFils ?? 0,
    failedOn: failed?.attemptedAt ?? since,
    reason: failed?.providerMessage ?? null,
    // Only a silent retry is a retry. An email is not a second attempt at the
    // card, and calling it one would have the seller waiting for a charge that
    // is not coming.
    retryAt: next.kind === "retry_silently" ? nextStepAt(since, stage) : null,
    dropsOn,
  };
}

/** When the sequence next moves, from the schedule it actually runs on. */
function nextStepAt(since: Date, stage: DunningStage): Date {
  const day =
    stage === "none" || stage === "retry"
      ? SCHEDULE.emailed
      : stage === "emailed"
        ? SCHEDULE.messaged
        : SCHEDULE.final;
  return new Date(since.getTime() + day * 86_400_000);
}
