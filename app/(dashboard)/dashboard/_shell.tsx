import "server-only";
import { notFound } from "next/navigation";
import { AppSidebar, DashboardShell, PageHeader, resolveNav } from "@/components/structure";
import { DASHBOARD_NAV } from "@/components/structure/nav-config";
import { prisma } from "@/lib/db/client";
import { actorFromDevSeller, devSellerRequest } from "@/lib/auth/dev-seller";
import { getActor } from "@/lib/auth/session";
import { currentSession, minutesLeft } from "@/lib/support/view-as";
import { isStaff, type Actor } from "@/lib/auth/roles";
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
      select: { displayName: true },
    });
    if (business) {
      return {
        actor,
        businessId: actor.businessId,
        businessName: business.displayName,
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
      displayName: true,
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
    prisma.enquiryRecipient.count({
      where: { businessId, state: { in: ["delivered", "opened", "quoted"] } },
    }),
    prisma.quote.count({ where: { businessId, status: { in: ["sent", "read"] } } }),
  ]);
  return { leads, quotes };
}

export interface SellerPageProps {
  seat: SellerSeat;
  /** From getNavBadges. Omitted only where a screen has no reason to load them. */
  badges?: Readonly<Record<string, number>>;
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
          groups={resolveNav(DASHBOARD_NAV, (key) => t(key as never), badges)}
          activeHref={activeHref}
          actor={seat.actor}
          lockedLabel={t("nav.locked")}
          laterLabel={t("nav.later")}
          // The brand name is a proper noun, rendered as written on the public
          // chrome. It is not a string to translate.
          mark={<span className="font-serif text-h2 text-on-ink">Business Listings</span>}
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
