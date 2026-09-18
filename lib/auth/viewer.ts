import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { getActor } from "./session";

/**
 * Who is looking at a public page, for the header — board 10e Q1.
 *
 * The directory nav had no signed-in state, so a buyer on their own account
 * page was offered *Sign in* and *List your business*. `7c` shipped that way.
 * This is what the nav needs to draw an account menu instead, and nothing more:
 * a name to show and which consoles the person can open.
 *
 * Read only by pages that are already dynamic — the account pages, the enquiry
 * pages, the composer. Reading a session makes a page dynamic, and the static
 * pages (legal, guides, curated lists) keep the signed-out header rather than
 * giving up their cache for a name in the corner.
 */
export interface Viewer {
  /** The first name, or null when the account has none. */
  firstName: string | null;
  /**
   * The whole name, as the header prints it — board 7b's `BLNav` mount,
   * `auth="buyer" user="Rami Haddad" org="Marina Facilities LLC"`.
   */
  fullName: string | null;
  /** The buying company's registered name, when they send enquiries for one. */
  company: string | null;
  /** Holds a seller seat, so the menu offers the dashboard. */
  seller: boolean;
  /** Holds a staff role, so the menu offers the console. */
  staff: boolean;
}

export const getViewer = cache(async function getViewer(): Promise<Viewer | null> {
  const actor = await getActor();
  if (!actor) return null;
  const profile = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { fullName: true, buyerCompany: { select: { name: true } } },
  });
  const fullName = profile?.fullName?.trim() || null;
  return {
    firstName: fullName?.split(/\s+/)[0] ?? null,
    fullName,
    company: profile?.buyerCompany?.name ?? null,
    seller: actor.roles.some((role) => role.startsWith("seller_")) && Boolean(actor.businessId),
    staff: actor.roles.some((role) => role.startsWith("staff_")),
  };
});
