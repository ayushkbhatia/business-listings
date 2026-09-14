import "server-only";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Board `3j-s` — whether an enquiry is one for work, read once for every writer.
 *
 * Its own module because both composers ask it: the proposal service to know
 * what it answers, and the goods send and autosave to refuse what they must not
 * answer. In either of those files it would be a cycle.
 */

/** What makes an enquiry one for work, and the trade to read services from. */
export interface WorkEnquiry {
  /** The brief's subcategory, else the named service's. */
  categoryId: string;
  /** Services the buyer named on a line, whoever they belong to. */
  namedServiceIds: string[];
  isBrief: boolean;
}

/**
 * Null for an enquiry for things.
 *
 * The brief's own category wins over a named service's: the brief is what the
 * matcher routed on. An enquiry that names a service and has no brief is a
 * single-supplier enquiry from a service page, whose trade is that service's.
 */
export async function workEnquiryOf(
  db: Prisma.TransactionClient,
  enquiryId: string,
): Promise<WorkEnquiry | null> {
  const enquiry = await db.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      serviceBrief: { select: { categoryId: true } },
      lines: {
        where: { serviceId: { not: null } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { serviceId: true, service: { select: { categoryId: true } } },
      },
    },
  });
  if (!enquiry) return null;

  const named = enquiry.lines.flatMap((line) => (line.serviceId ? [line.serviceId] : []));
  const categoryId = enquiry.serviceBrief?.categoryId ?? enquiry.lines[0]?.service?.categoryId ?? null;
  if (!categoryId) return null;

  return { categoryId, namedServiceIds: named, isBrief: enquiry.serviceBrief !== null };
}

