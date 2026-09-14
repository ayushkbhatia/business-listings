import "server-only";
import { prisma } from "@/lib/db/client";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import { callHistory } from "@/lib/crm/call-list";
import { sessionsFor } from "@/lib/support/view-as";
import { windowStart } from "@/lib/metrics/response-time";
import { CAP_REFUSED_EVENTS, upgradeWindowStart } from "./health";
import { describeRows, type AccountRow } from "./list";

/**
 * Board 4f — one account, opened. `B10`: read-only here; every change is a
 * logged `staffMutation` from the decision panel beside it, and suspension is
 * ops lead alone.
 *
 * The row is described by the same `describeRows` the list uses, so the state
 * on the list and the state on the page it opens cannot disagree about the same
 * business at the same moment.
 */

export interface CapEvent {
  kind: "products" | "services";
  at: Date;
  plan: string;
  cap: number | null;
  attempted: number | null;
  surface: string | null;
}

export interface AccountDetail {
  row: AccountRow;
  licenceAuthority: string;
  licenceExpiry: Date;
  trn: string | null;
  verifiedAt: Date | null;
  publishedAt: Date | null;
  suspendedAt: Date | null;
  mergedInto: { id: string; displayName: string } | null;
  locations: { emirate: string; areaName: string }[];
  plan: { name: string; monthlyPriceAed: number; productLimit: number | null; serviceLimit: number | null } | null;
  subscription: {
    status: string;
    startedAt: Date;
    renewsAt: Date;
    cancelledAt: Date | null;
    endsAt: Date | null;
    trialEndsAt: Date | null;
  } | null;
  closure: { initiator: string; requestedAt: Date; effectiveAt: Date; appliedAt: Date | null; finalAt: Date } | null;
  seats: number;
  /** The measure's raw inputs for the window, so the rate on screen can be checked. */
  replies: { windowDays: number; delivered: number; replied: number; stillOpen: number; measuredAt: Date | null };
  capEvents: CapEvent[];
  missedAtCap: { count: number; latest: Date | null };
  calls: Awaited<ReturnType<typeof callHistory>>;
  viewAs: Awaited<ReturnType<typeof sessionsFor>>;
}

export async function accountDetail(id: string, now: Date = new Date()): Promise<AccountDetail | null> {
  const business = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true,
      slug: true,
      displayName: true,
      licenceNumber: true,
      licenceAuthority: true,
      licenceExpiry: true,
      trn: true,
      claimStatus: true,
      planId: true,
      verificationTier: true,
      verifiedAt: true,
      publishedAt: true,
      sellsKind: true,
      replyRate: true,
      replySample: true,
      responseTimeMedianMs: true,
      derivedAt: true,
      suspendedAt: true,
      mergedIntoId: true,
      mergedInto: { select: { id: true, displayName: true } },
      closedAt: true,
      closureRequestedAt: true,
      subscription: {
        select: {
          status: true,
          startedAt: true,
          renewsAt: true,
          cancelledAt: true,
          endsAt: true,
          trialEndsAt: true,
          plan: { select: { monthlyPriceAed: true } },
        },
      },
      locations: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { emirate: true, area: { select: { name: true } } },
      },
      claimSubmissions: {
        where: { outcome: "approved", decidedAt: { not: null } },
        orderBy: [{ decidedAt: "asc" }, { id: "asc" }],
        take: 1,
        select: { decidedAt: true },
      },
      closures: {
        where: { reversedAt: null, finalisedAt: null },
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { initiator: true, requestedAt: true, effectiveAt: true, appliedAt: true, finalAt: true },
      },
      _count: {
        select: {
          products: { where: { status: "live" } },
          services: { where: { status: "live" } },
          team: true,
        },
      },
    },
  });
  if (!business) return null;

  const since = windowStart(now);
  const upgradeSince = upgradeWindowStart(now);

  const [rows, caps, recipients, capRows, missed, calls, viewAs] = await Promise.all([
    describeRows([business], now),
    effectiveFor(business.id),
    prisma.enquiryRecipient.findMany({
      where: { businessId: business.id, createdAt: { gte: since } },
      select: { firstReplyAt: true, enquiry: { select: { closesAt: true } } },
    }),
    prisma.productEvent.findMany({
      where: { businessId: business.id, name: { in: [...CAP_REFUSED_EVENTS] }, createdAt: { gte: upgradeSince } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { name: true, createdAt: true, props: true },
    }),
    prisma.missedEnquiry.aggregate({
      where: { businessId: business.id, createdAt: { gte: upgradeSince } },
      _count: { _all: true },
      _max: { createdAt: true },
    }),
    callHistory(business.id, 10),
    sessionsFor(business.id, 10),
  ]);

  const row = rows[0]!;
  const replied = recipients.filter((r) => r.firstReplyAt !== null).length;
  const stillOpen = recipients.filter(
    (r) => r.firstReplyAt === null && r.enquiry.closesAt.getTime() > now.getTime(),
  ).length;

  const closure = business.closures[0] ?? null;

  return {
    row,
    licenceAuthority: business.licenceAuthority,
    licenceExpiry: business.licenceExpiry,
    trn: business.trn,
    verifiedAt: business.verifiedAt,
    publishedAt: business.publishedAt,
    suspendedAt: business.suspendedAt,
    mergedInto: business.mergedInto,
    locations: business.locations.map((location) => ({ emirate: location.emirate, areaName: location.area.name })),
    // B2: an unclaimed listing is on no plan, whatever a stray column holds.
    plan:
      business.claimStatus === "claimed" && caps
        ? {
            name: caps.name,
            monthlyPriceAed: caps.monthlyPriceAed,
            productLimit: caps.productLimit,
            serviceLimit: caps.serviceLimit,
          }
        : null,
    subscription: business.subscription
      ? {
          status: business.subscription.status,
          startedAt: business.subscription.startedAt,
          renewsAt: business.subscription.renewsAt,
          cancelledAt: business.subscription.cancelledAt,
          endsAt: business.subscription.endsAt,
          trialEndsAt: business.subscription.trialEndsAt,
        }
      : null,
    closure,
    seats: business._count.team,
    replies: {
      windowDays: Math.round((now.getTime() - since.getTime()) / 86_400_000),
      delivered: recipients.length,
      replied,
      stillOpen,
      measuredAt: business.derivedAt,
    },
    capEvents: capRows.map((event) => {
      const props = (event.props ?? {}) as Record<string, unknown>;
      return {
        kind: event.name === "service_cap_refused" ? "services" : "products",
        at: event.createdAt,
        plan: typeof props["plan"] === "string" ? props["plan"] : "",
        cap: typeof props["cap"] === "number" ? props["cap"] : null,
        attempted: typeof props["attempted"] === "number" ? props["attempted"] : null,
        surface: typeof props["surface"] === "string" ? props["surface"] : null,
      };
    }),
    missedAtCap: { count: missed._count._all, latest: missed._max.createdAt },
    calls,
    viewAs,
  };
}
