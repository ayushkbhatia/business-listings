import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSidebar, DashboardShell, PageHeader, resolveNav } from "@/components/structure";
import { dashboardNavFor } from "@/components/structure/nav-config";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller, devSellerRequest } from "@/lib/auth/dev-seller";
import { getActor } from "@/lib/auth/session";
import { currentSession, minutesLeft } from "@/lib/support/view-as";
import { isStaff, type Actor } from "@/lib/auth/roles";
import { setupChrome, type SetupChrome } from "@/lib/setup/service";
import { tabWhere } from "@/lib/leads/inbox";
import { formatCount } from "@/lib/format";
import { t } from "@/lib/i18n";

/**
 * The seller frame, resolved once and shared by the three screens this handoff
 * builds. The rest of the dashboard is handoff 3; the nav already names those
 * screens and the sidebar renders them locked rather than hiding them.
 */

export interface SellerSeat {
  actor: Actor;
  businessId: string;
  businessName: string;
  /**
   * The public path segment, so a write can revalidate the storefront it
   * changed without a second query for the slug it already had.
   */
  businessSlug: string;
  /**
   * What the identity block under the wordmark says about the account.
   *
   * Two facts and no more: the plan, because it decides what half the screens
   * render, and where the head office is, because a supplier with branches in
   * three emirates needs to know which listing they are looking at. Both are
   * read where the seat is, so no page loads them a second time.
   */
  planName: string;
  place: string | null;
  /**
   * What the seller said on `2b-s`. It decides which catalogue the rail offers
   * — board `3f-s` B1 — and nothing else about the frame.
   *
   * Read with the identity, so no screen loads it a second time.
   */
  sellsKind: "unset" | "goods" | "services" | "both";
  /** True while the seat came from DEV_SELLER_SLUG rather than a session. */
  isDevSeat: boolean;
  /**
   * Set while a staff member is viewing this account through board 12f.
   *
   * The actor is still **them** — their id, their roles, their audit trail —
   * and only the business changes. That is what makes the session read-only
   * without a second mechanism: every seller mutation guards on a seller
   * capability, and a staff actor holds none of them, so the refusal happens at
   * the same `assertCan` that refuses a sales seat.
   *
   * The banner is what this field is for. Hiding buttons is fine and is not the
   * fence.
   */
  viewingAs?: { sessionId: string; ticketRef: string; expiresAt: Date };
}

/**
 * The two identity facts, selected once so the three seat branches agree.
 *
 * The location is the head office where there is one and any published branch
 * otherwise — a supplier who has only ever added a warehouse should still see
 * where they are rather than a blank.
 */
const IDENTITY_SELECT = {
  displayName: true,
  slug: true,
  sellsKind: true,
  plan: { select: { name: true } },
  locations: {
    where: { published: true },
    orderBy: { type: "asc" },
    take: 1,
    select: { area: { select: { name: true } } },
  },
} as const;

interface IdentityRow {
  slug: string;
  sellsKind: "unset" | "goods" | "services" | "both";
  plan: { name: string } | null;
  locations: { area: { name: string } | null }[];
}

function identityOf(business: IdentityRow): {
  planName: string;
  place: string | null;
  sellsKind: SellerSeat["sellsKind"];
  businessSlug: string;
} {
  return {
    sellsKind: business.sellsKind,
    businessSlug: business.slug,
    // Null means Free — `Business.planId` is nullable because an imported
    // licence record never chose one.
    planName: business.plan?.name ?? "Free",
    place: business.locations[0]?.area?.name ?? null,
  };
}

/**
 * Who is acting, and for which business.
 *
 * A real session first. The development seat only answers when there is no
 * session at all, is opt-in, and is inert in production — see lib/auth/dev-seller.ts.
 */
export async function getSellerSeat(): Promise<SellerSeat | null> {
  const actor = await getActor();

  /*
   * A staff member looking through a seller's eyes. Checked before the seller
   * path, because a staff actor has no `businessId` of their own and would
   * otherwise fall through to the development seat.
   */
  if (actor && isStaff(actor)) {
    const session = await currentSession(actor.id);
    if (!session) return null;
    return {
      actor,
      businessId: session.businessId,
      businessName: session.business.displayName,
      businessSlug: session.business.slug,
      // A staff member looking through a seller's eyes gets the seller's
      // screens; the identity block is deliberately not one of them, because
      // the loud banner above it is what says whose account this is.
      planName: "",
      place: null,
      // The rail still has to offer the right catalogue: a staff member looking
      // at a services firm must see the screens that firm sees, or the session
      // is showing them somebody else's product.
      sellsKind: session.business.sellsKind,
      isDevSeat: false,
      viewingAs: {
        sessionId: session.id,
        ticketRef: session.ticketRef,
        expiresAt: session.expiresAt,
      },
    };
  }

  if (actor?.businessId) {
    const business = await prisma.business.findUnique({
      where: { id: actor.businessId },
      select: IDENTITY_SELECT,
    });
    if (business) {
      return {
        actor,
        businessId: actor.businessId,
        businessName: business.displayName,
        ...identityOf(business),
        isDevSeat: false,
      };
    }
  }

  const request = devSellerRequest();
  if (!request) return null;

  const business = await prisma.business.findUnique({
    where: { slug: request.slug },
    select: {
      id: true,
      ...IDENTITY_SELECT,
      team: {
        where: { roles: { has: "seller_owner" } },
        select: { id: true, roles: true },
        take: 1,
      },
    },
  });
  const owner = business?.team[0];
  if (!business || !owner) return null;

  return {
    actor: actorFromDevSeller({ userId: owner.id, roles: owner.roles, businessId: business.id }),
    businessId: business.id,
    businessName: business.displayName,
    ...identityOf(business),
    isDevSeat: true,
  };
}

/** The seat, or a 404. Every dashboard page starts here. */
export async function requireSellerSeat(): Promise<SellerSeat> {
  const seat = await getSellerSeat();
  if (!seat) notFound();
  return seat;
}

/**
 * The counts the sidebar shows. Read once per page render, alongside the page's
 * own query — two small counts are cheaper than a badge that lies.
 */
export async function getNavBadges(businessId: string): Promise<Record<string, number>> {
  const [leads, quotes] = await Promise.all([
    /*
       The same population as board 3j's `Open` tab, through the same function.

       It used to count delivered, opened *and* quoted, which is a different
       number from the one the inbox now shows above the rail — and a sidebar
       saying twenty over a list saying nine is the disagreement CLAUDE.md's
       "every number is a query" rule exists to prevent. `tabWhere` is the one
       definition; this reads it rather than restating it.
    */
    prisma.enquiryRecipient.count({ where: tabWhere(businessId, "open", { kind: "all" }) }),
    prisma.quote.count({ where: { businessId, status: { in: ["sent", "read"] } } }),
  ]);
  return { leads, quotes };
}

/**
 * The one link to the setup hub that is on every dashboard screen.
 *
 * Board 8a gives the hub no nav row — it is temporary, and a permanent row for
 * it would still be there a year later reading "nothing left". This figure and
 * the banner on the overview are how it is reached, and both stop rendering at
 * a hundred per cent.
 *
 * It reads the same recomputed score the hub's body reads, through the same two
 * functions. The render this was drawn from had a sidebar saying `82% · 3 items
 * left` over a body saying `62%` with four tasks open, because the footer came
 * from a shared default; one figure, one source, is the correction.
 */
export async function getSetupProgress(businessId: string) {
  return setupChrome(businessId);
}

function SidebarProgress({ strength, openCount }: { strength: number; openCount: number }) {
  return (
    <div>
      <p className="text-caption text-muted">{t("shell.strength_label")}</p>
      <Link
        href="/dashboard/setup"
        className="mt-0.5 block text-body-sm font-medium text-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
      >
        {openCount === 0
          ? t("shell.strength_done", { strength: formatCount(strength) })
          : t("shell.strength_value", {
              count: openCount,
              strength: formatCount(strength),
              formatted: formatCount(openCount),
            })}
      </Link>
    </div>
  );
}

/**
 * Whose account this is, under the wordmark.
 *
 * Board 8a's render opens with it, and the reason is not decoration: the seller
 * dashboard had no statement of identity anywhere in its chrome, so a supplier
 * with two listings — or a person who had been sent a link — had to read the
 * page body to find out which one they were editing.
 *
 * Initials rather than a logo. `Media` with `kind: "logo"` is optional and most
 * seeded listings have none, so a tile that was sometimes an image and
 * sometimes a gap would be worse than one that is always the same shape.
 */
function SidebarIdentity({ seat }: { seat: SellerSeat }) {
  const initials = seat.businessName
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-[30px] shrink-0 items-center justify-center rounded-ctl bg-moss font-mono text-eyebrow text-on-ink"
      >
        {initials}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body-sm font-medium text-ink">
          {seat.businessName}
        </span>
        <span className="mt-0.5 block truncate font-mono text-eyebrow uppercase text-muted">
          {seat.place ? `${seat.planName} · ${seat.place}` : seat.planName}
        </span>
      </span>
    </div>
  );
}

export interface SellerPageProps {
  seat: SellerSeat;
  /** From getNavBadges. Omitted only where a screen has no reason to load them. */
  badges?: Readonly<Record<string, number>>;
  /**
   * The setup figure in the sidebar footer. Omitted where a screen has not
   * loaded it — the footer then renders nothing, rather than a zero that would
   * read as a finished profile.
   */
  setup?: SetupChrome | null;
  activeHref: string;
  title: string;
  eyebrow?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  children: React.ReactNode;
}

export function SellerPage({
  seat,
  badges,
  setup,
  activeHref,
  title,
  eyebrow,
  meta,
  actions,
  breadcrumb,
  children,
}: SellerPageProps) {
  return (
    <DashboardShell
      sidebar={
        <AppSidebar
          label={t("nav.label.dashboard")}
          groups={resolveNav(dashboardNavFor(seat.sellsKind), (key) => t(key as never), badges)}
          /*
             The seller rail is light and carries the supplier's own name. The
             staff console keeps the dark one — see AppSidebar for why the
             difference is whose surface it is rather than a theme.
          */
          tone="paper"
          {...(seat.planName ? { identity: <SidebarIdentity seat={seat} /> } : {})}
          activeHref={activeHref}
          actor={seat.actor}
          lockedLabel={t("nav.locked")}
          laterLabel={t("nav.later")}
          // The brand name is a proper noun, rendered as written on the public
          // chrome. It is not a string to translate.
          mark={<span className="font-serif text-h2 text-ink">Business Listings</span>}
          {...(setup && setup.openCount > 0
            ? {
                footer: (
                  <SidebarProgress strength={setup.strength} openCount={setup.openCount} />
                ),
              }
            : {})}
        />
      }
      notice={
        seat.viewingAs ? (
          /*
           * Loud, and on every screen. Somebody looking at an account that is
           * not theirs should never be able to forget it — and the countdown is
           * there because the cap is real: the session ends at thirty minutes
           * whether or not this tab is still open.
           */
          <p className="border-b border-warn-line bg-warn-surface px-[var(--section-pad)] py-2 text-caption text-warn-ink">
            {t("dashboard.viewing_as", {
              business: seat.businessName,
              ticket: seat.viewingAs.ticketRef,
              minutes: String(minutesLeft(seat.viewingAs.expiresAt)),
            })}
          </p>
        ) : seat.isDevSeat ? (
          <p className="border-b border-warn-line bg-warn-surface px-[var(--section-pad)] py-2 text-caption text-warn-ink">
            {t("dev.acting_as", { business: seat.businessName })}
          </p>
        ) : undefined
      }
      header={
        <PageHeader
          title={title}
          {...(eyebrow ? { eyebrow } : {})}
          {...(meta ? { meta } : {})}
          {...(actions ? { actions } : {})}
          {...(breadcrumb ? { breadcrumb } : {})}
        />
      }
    >
      {children}
    </DashboardShell>
  );
}
