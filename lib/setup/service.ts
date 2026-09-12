import "server-only";
import { prisma } from "@/lib/db/client";
import { getEnquiryLift, type EnquiryLift } from "@/lib/metrics/enquiry-lift";
import {
  profileStrength,
  strengthItems,
  STRONG_ENOUGH,
  type ProfileFacts,
} from "@/lib/metrics/profile-strength";
import { effectiveFor } from "@/lib/billing/entitlements-service";
import type { PlanCaps } from "@/lib/plan/entitlements";
import {
  dubaiDayStart,
  setupBoard,
  type SetupLever,
  type SetupTaskRow,
} from "./tasks";

/**
 * Everything board 8a renders, computed.
 *
 * The hub is the screen a supplier lands on straight out of the funnel, and
 * every figure on it is a claim: what a task is worth, how strong the profile
 * is, how many people have already looked. CLAUDE.md's interface-honesty rule
 * applies to all of them — each is a query here, and where the query has no
 * answer the page is told so rather than handed a placeholder.
 *
 * Two decisions inside are worth reading before changing anything, and both are
 * commented where they are made: the strength meter is **recomputed** rather
 * than read from the column the nightly job owns, and the rail's open-enquiry
 * count takes `getOverview`'s filter rather than the sidebar badge's, because
 * the two disagree on purpose and only one of them means "waiting for a reply".
 */

export {
  LEVERS_WITHOUT_TASK,
  SETUP_TASKS,
  type SetupLever,
  type SetupTaskId,
  type SetupTaskRow,
} from "./tasks";

export interface SetupRailCounts {
  /** Views on the storefront since the day it went live, in Dubai days. */
  viewsSinceLive: number;
  shortlists: number;
  /** Enquiries waiting on a reply from this seller. */
  openEnquiries: number;
}

export interface SetupHubState {
  businessId: string;
  /**
   * Which weight table this seller is measured against — board `8a-s` B1.
   *
   * One screen, one route, a conditional task set. The page reads it to decide
   * which four cards to draw and which sentence the weights footnote closes
   * with; everything else about the hub is the same screen it was.
   */
  sellsKind: "unset" | "goods" | "services" | "both";
  /** On the directory. False before `goLive`, and the hub says less. */
  live: boolean;
  /** Off the directory while staff look at it. The hub stands down entirely. */
  suspended: boolean;
  publishedAt: Date | null;

  tasks: SetupTaskRow[];
  levers: SetupLever[];
  openCount: number;
  openMinutes: number;
  doneCount: number;

  strength: number;
  threshold: number;
  /** The measured multiple, or null when the cohorts are too small to have one. */
  lift: EnquiryLift | null;

  rail: SetupRailCounts;

  /** Null only for a listing that has never had a plan, which is pre-`goLive`. */
  plan: PlanCaps | null;

  /** When the one nudge went. Null while it is still to come. */
  nudgeSentAt: Date | null;
  /** True once a `setup_nudge` row exists at all, sent or not. */
  nudgeUsed: boolean;
}

/**
 * One seller's hub, in two phases.
 *
 * The business row comes first because `publishedAt` decides which view days
 * are counted, and everything else goes out together. That is the same shape
 * `getOverview` uses, for the same reason.
 */
export async function setupHubState(
  businessId: string,
  /*
     The cached lift by default. `unstable_cache` needs Next's incremental cache
     and throws outside a request, so the integration suite passes the uncached
     reader — the same split `lib/db/queries/home.ts` documents.
  */
  readLift: () => Promise<EnquiryLift | null> = getEnquiryLift,
): Promise<SetupHubState | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      description: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      publishedAt: true,
      suspendedAt: true,
      categories: { select: { categoryId: true } },
      locations: { select: { hours: true } },
      /*
         Board `8a-s`. Which table this seller is measured against, and the four
         facts on the row that the services half of it reads. Every one of them
         is empty on a goods listing, which is what keeps the goods hub the
         screen it already was.
      */
      sellsKind: true,
      verifiedAt: true,
      sectorsServed: true,
      deliveryModes: true,
      _count: {
        select: {
          team: true,
          services: { where: { status: "live" } },
          serviceCoverage: true,
          documents: { where: { kind: "certificate" } },
        },
      },
    },
  });
  if (!business) return null;

  const since = business.publishedAt === null ? null : dubaiDayStart(business.publishedAt);

  const [media, products, invitesSent, shortlists, openEnquiries, views, nudge, plan, lift] =
    await Promise.all([
      /*
         Kinds rather than counts: the meter needs the logo and the cover named
         separately, and three counts would be three round trips for one fact.
         Review photographs are the buyer's and belong to nobody's profile.
      */
      prisma.media.findMany({
        where: { businessId, reviewId: null },
        select: { kind: true },
      }),
      /*
         The same derivation the strength job makes, for one seller. A product
         counts as having filterable specs when it has any spec value at all,
         which Postgres could answer without shipping the rows — but a seller on
         this page has a catalogue in single figures, because adding one is the
         task the page is asking them to do.
      */
      prisma.product.findMany({ where: { businessId }, select: { specValues: true } }),
    /*
       Outstanding invitations. Board 8d §5: the team task ticks on send, not on
       acceptance — the seller cannot make a colleague click a link, and a task
       held open by somebody else's inaction is one they learn to ignore.
    */
    prisma.teamInvite.count({ where: { businessId, acceptedAt: null, revokedAt: null } }),
      prisma.shortlist.count({ where: { businessId } }),
      /*
         Delivered or opened, not yet quoted — `getOverview`'s `awaitingReply`,
         to the state.

         `getNavBadges` counts a wider set, `delivered | opened | quoted`, and
         documents it as "a live lead". That is the right answer for a sidebar
         badge and the wrong one here: board 8a's rail says "waiting for a
         reply", and a quote already sent is not waiting on the seller. Counting
         it would put a number on the hub that the enquiries screen contradicts
         the moment the seller clicks through.
      */
      prisma.enquiryRecipient.count({
        where: { businessId, state: { in: ["delivered", "opened"] } },
      }),
      prisma.listingViewDay.aggregate({
        _sum: { views: true },
        where: { businessId, ...(since === null ? {} : { day: { gte: since } }) },
      }),
      /*
         Exactly one nudge is ever sent, so the panel has to know whether it has
         been. `sentAt` for the date it names; the row's existence for the
         promise, because a queued or deferred nudge is still the one this
         listing gets and "we will remind you once" would be a second promise.
      */
      prisma.notificationDelivery.findFirst({
        where: { businessId, event: "setup_nudge" },
        orderBy: { createdAt: "desc" },
        select: { sentAt: true },
      }),
      // Through the snapshot, so a grandfathered seller keeps the caps they
      // bought even after the plan they bought them on changed.
      effectiveFor(businessId),
      readLift(),
    ]);

  const facts: ProfileFacts = {
    hasDescription: (business.description ?? "").trim().length > 0,
    hasLogo: media.some((item) => item.kind === "logo"),
    hasCover: media.some((item) => item.kind === "cover"),
    additionalCategories: business.categories.length,
    hasEstablishedYear: business.establishedYear !== null,
    hasTeamSize: business.teamSize !== null,
    languages: business.languages.length,
    locations: business.locations.length,
    locationsWithHours: business.locations.filter((location) => hasHours(location.hours)).length,
    products: products.length,
    productsWithFilterableSpecs: products.filter((product) => hasSpecs(product.specValues)).length,
    photos: media.length,
    teamSeats: business._count.team,

    credentials: business._count.documents,
    licenceVerified: business.verifiedAt !== null,
    servicesLive: business._count.services,
    sectors: business.sectorsServed.length,
    deliveryModes: business.deliveryModes.length,
    coverageAreas: business._count.serviceCoverage,
  };

  /*
     Recomputed, not read.

     `Business.profileStrength` is written by the nightly job in
     `lib/metrics/strength-job.ts` and by nothing else — which is what makes it
     unforgeable and is exactly why it is stale here. A seller who has just
     uploaded six photographs, come back to the hub and seen the same number
     concludes the meter is decorative, and they would be right to. The facts
     are already loaded for the chips, so the score costs nothing extra; the
     stored column stays the one search ranking and the cohort query read, and
     the job puts it right within the hour.
  */
  const strength = profileStrength(facts, business.sellsKind);

  const board = setupBoard({
    kind: business.sellsKind,
    photos: facts.photos,
    products: facts.products,
    seats: facts.teamSeats,
    credentials: facts.credentials,
    servicesLive: facts.servicesLive,
    invitesSent,
    items: strengthItems(facts, business.sellsKind),
  });

  return {
    businessId: business.id,
    sellsKind: business.sellsKind,
    live: business.publishedAt !== null,
    suspended: business.suspendedAt !== null,
    publishedAt: business.publishedAt,

    tasks: board.tasks,
    levers: board.levers,
    openCount: board.openCount,
    openMinutes: board.openMinutes,
    doneCount: board.doneCount,

    strength,
    threshold: STRONG_ENOUGH,
    /*
       The measured multiple where forty listings a side support one, and null
       where they do not. Board 2c set the rule and board 8a keeps it: the page
       renders either the measured sentence or the mechanism sentence, and
       neither is ever a placeholder for the other.
    */
    lift,

    rail: {
      viewsSinceLive: views._sum.views ?? 0,
      shortlists,
      openEnquiries,
    },

    plan,

    nudgeSentAt: nudge?.sentAt ?? null,
    nudgeUsed: nudge !== null,
  };
}

/** `hours` is Json and defaults to `{}`, so presence is not the same as filled in. */
function hasHours(hours: unknown): boolean {
  return typeof hours === "object" && hours !== null && Object.keys(hours).length > 0;
}

/** Any spec value at all. An empty object is a product nobody can filter to. */
function hasSpecs(values: unknown): boolean {
  return typeof values === "object" && values !== null && Object.keys(values).length > 0;
}

export interface SetupChrome {
  /** Nought to a hundred, recomputed the same way the hub recomputes it. */
  strength: number;
  /** How many of the four are still open. Zero hides every entry point. */
  openCount: number;
  /**
   * What the open cards would pay this seller, added up.
   *
   * Not `100 - strength`. The meter has two levers no card offers — who you
   * are, and how completely the catalogue is specified — so the gap to a
   * hundred is larger than what the four tasks can close, and a banner quoting
   * the gap would promise points the tasks behind it do not pay.
   */
  openPoints: number;
}

/**
 * The figure the chrome carries, without the ten reads the hub itself makes.
 *
 * The sidebar footer and the overview banner are the only two ways to reach the
 * hub — it has no nav row — so they run on every dashboard page, and running
 * `setupHubState` for them would buy a plan lookup, a cohort query and a
 * notification-delivery read to draw one percentage.
 *
 * It has to agree with the hub exactly. The render this board was drawn from
 * had the sidebar reading `82% · 3 items left` from a shared default while the
 * body read `62%` over four open tasks, and the correction was that both come
 * from one figure. So this recomputes from the same facts through the same two
 * functions rather than reading `Business.profileStrength`, which the nightly
 * job writes and which is stale for exactly the seller looking at this.
 */
export async function setupChrome(businessId: string): Promise<SetupChrome | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      description: true,
      establishedYear: true,
      teamSize: true,
      languages: true,
      categories: { select: { categoryId: true } },
      locations: { select: { hours: true } },
      // Board `8a-s`, and the same four facts the hub reads: the chrome has to
      // agree with the body exactly, which means measuring against the same
      // table rather than a shorter version of it.
      sellsKind: true,
      verifiedAt: true,
      sectorsServed: true,
      deliveryModes: true,
      _count: {
        select: {
          team: true,
          services: { where: { status: "live" } },
          serviceCoverage: true,
          documents: { where: { kind: "certificate" } },
        },
      },
    },
  });
  if (!business) return null;

  const [media, products, invitesSent] = await Promise.all([
    prisma.media.findMany({
      where: { businessId, reviewId: null },
      select: { kind: true },
    }),
    prisma.product.findMany({ where: { businessId }, select: { specValues: true } }),
    /*
       Outstanding invitations. Board 8d §5: the team task ticks on send, not on
       acceptance — the seller cannot make a colleague click a link, and a task
       held open by somebody else's inaction is one they learn to ignore.
    */
    prisma.teamInvite.count({ where: { businessId, acceptedAt: null, revokedAt: null } }),
  ]);

  const facts: ProfileFacts = {
    hasDescription: (business.description ?? "").trim().length > 0,
    hasLogo: media.some((item) => item.kind === "logo"),
    hasCover: media.some((item) => item.kind === "cover"),
    additionalCategories: business.categories.length,
    hasEstablishedYear: business.establishedYear !== null,
    hasTeamSize: business.teamSize !== null,
    languages: business.languages.length,
    locations: business.locations.length,
    locationsWithHours: business.locations.filter((location) => hasHours(location.hours)).length,
    products: products.length,
    productsWithFilterableSpecs: products.filter((product) => hasSpecs(product.specValues)).length,
    photos: media.length,
    teamSeats: business._count.team,

    credentials: business._count.documents,
    licenceVerified: business.verifiedAt !== null,
    servicesLive: business._count.services,
    sectors: business.sectorsServed.length,
    deliveryModes: business.deliveryModes.length,
    coverageAreas: business._count.serviceCoverage,
  };

  const board = setupBoard({
    kind: business.sellsKind,
    photos: facts.photos,
    products: facts.products,
    seats: facts.teamSeats,
    credentials: facts.credentials,
    servicesLive: facts.servicesLive,
    invitesSent,
    items: strengthItems(facts, business.sellsKind),
  });

  return {
    strength: profileStrength(facts, business.sellsKind),
    openCount: board.openCount,
    openPoints: board.tasks
      .filter((task) => !task.done)
      .reduce((total, task) => total + task.points, 0),
  };
}
