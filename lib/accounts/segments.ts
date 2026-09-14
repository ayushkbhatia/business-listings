import "server-only";
import { prisma } from "@/lib/db/client";
import { can } from "@/lib/auth/can";
import { isStaff, type Actor } from "@/lib/auth/roles";
import { hasAnyFilter, normaliseAccountFilter, toQueryString } from "./filter";
import { accountWhere } from "./list";

/**
 * Board 4f `B8` — saved segments are saved queries.
 *
 * A segment is a name and the canonical query string `./filter.ts` writes.
 * Opening one navigates to that query, which runs it: there is no list of ids
 * anywhere, so the account that answered every enquiry since Tuesday is not on
 * Tuesday's at-risk segment. The count beside each name is a query run when the
 * menu renders, not a number written at save time (acceptance criterion 8).
 *
 * Not audited, and exempt in `scripts/check-audit-coverage.mts` for the reason:
 * a segment changes nothing about any account. Every staff seat may save one;
 * the person who saved it, or an ops lead, may delete it.
 */

export const MAX_SEGMENTS = 40;
const NAME_MAX = 80;

export interface SegmentView {
  id: string;
  name: string;
  query: string;
  /** Matching accounts now. */
  count: number;
  createdByName: string | null;
  mayDelete: boolean;
}

export async function listSegments(actor: Actor, now: Date): Promise<SegmentView[]> {
  const segments = await prisma.accountSegment.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: MAX_SEGMENTS,
    select: { id: true, name: true, query: true, createdById: true, createdBy: { select: { fullName: true } } },
  });
  const counts = await Promise.all(
    segments.map((segment) =>
      prisma.business.count({ where: accountWhere(normaliseAccountFilter(Object.fromEntries(new URLSearchParams(segment.query))), now) }),
    ),
  );
  const opsLead = can(actor, "staff.manage");
  return segments.map((segment, index) => ({
    id: segment.id,
    name: segment.name,
    query: segment.query,
    count: counts[index] ?? 0,
    createdByName: segment.createdBy.fullName,
    mayDelete: opsLead || segment.createdById === actor.id,
  }));
}

export type SegmentResult =
  | { ok: true; id: string; query: string }
  | { ok: false; error: "not_staff" | "empty_name" | "empty_filter" | "name_taken" | "too_many" | "not_found" | "not_yours" };

export async function saveSegment(actor: Actor, input: { name: string; query: string }): Promise<SegmentResult> {
  if (!isStaff(actor)) return { ok: false, error: "not_staff" };
  const name = input.name.trim().replace(/\s+/g, " ").slice(0, NAME_MAX);
  if (name.length === 0) return { ok: false, error: "empty_name" };

  // Re-normalised, never stored as posted: the query is a URL somebody could
  // have edited, and a segment that saved an unrecognised key would re-run a
  // view the page never shows.
  const filter = normaliseAccountFilter(Object.fromEntries(new URLSearchParams(input.query)));
  if (!hasAnyFilter(filter)) return { ok: false, error: "empty_filter" };
  const query = toQueryString(filter);

  if ((await prisma.accountSegment.count()) >= MAX_SEGMENTS) return { ok: false, error: "too_many" };

  try {
    const created = await prisma.accountSegment.create({
      data: { name, query, createdById: actor.id },
      select: { id: true },
    });
    return { ok: true, id: created.id, query };
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002") {
      return { ok: false, error: "name_taken" };
    }
    throw error;
  }
}

export async function deleteSegment(actor: Actor, id: string): Promise<SegmentResult> {
  if (!isStaff(actor)) return { ok: false, error: "not_staff" };
  const segment = await prisma.accountSegment.findUnique({ where: { id }, select: { id: true, createdById: true, query: true } });
  if (!segment) return { ok: false, error: "not_found" };
  if (segment.createdById !== actor.id && !can(actor, "staff.manage")) return { ok: false, error: "not_yours" };
  await prisma.accountSegment.delete({ where: { id: segment.id } });
  return { ok: true, id: segment.id, query: segment.query };
}
