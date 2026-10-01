import type { Prisma } from "@/lib/db/generated/client";

/**
 * Board `1o` D4 — who the buyer's contact details went to, and what was
 * accepted from them.
 *
 * `Enquiry.contactReleasedToBusinessId` is the enquiry's **decided** marker:
 * non-null once anything on it is accepted, read by every "is this decided"
 * check and by two triggers. For an enquiry accepted across suppliers it names
 * the main supplier only, so it cannot answer whether the buyer's contact went
 * to a particular supplier.
 *
 * That question is asked of the supplier's own recipient row,
 * `EnquiryRecipient.contactReleasedAt`, set for every supplier an acceptance
 * releases to — one for an ordinary accept, each of them for a split. Two
 * triggers keep it in step with the enquiry's column for anything written the
 * older way, in either order.
 */

/** A recipient `where` for "the buyer's contact went to this supplier". */
export const RELEASED_RECIPIENT = { contactReleasedAt: { not: null } } as const satisfies Prisma.EnquiryRecipientWhereInput;

/** An enquiry `where` for "the buyer's contact went to this business". */
export function releasedToBusiness(businessId: string): Prisma.EnquiryWhereInput {
  return { recipients: { some: { businessId, ...RELEASED_RECIPIENT } } };
}

/** Select on an enquiry: who the buyer's contact went to, and when. */
export const RELEASES_SELECT = {
  where: RELEASED_RECIPIENT,
  select: { businessId: true, contactReleasedAt: true },
  orderBy: { businessId: "asc" },
} as const satisfies Prisma.Enquiry$recipientsArgs;

export interface Release {
  businessId: string;
  contactReleasedAt: Date | null;
}

/** Whether the buyer's contact went to this business. */
export function isReleasedTo(releases: readonly Release[], businessId: string): boolean {
  return releases.some((release) => release.businessId === businessId && release.contactReleasedAt !== null);
}

/** When the buyer's contact went to this business, or null. */
export function releasedAtFor(releases: readonly Release[], businessId: string): Date | null {
  return releases.find((release) => release.businessId === businessId)?.contactReleasedAt ?? null;
}

/**
 * The lines an acceptance covers, from a quote's lines as stored.
 *
 * Since `1o` an acceptance marks the lines it covers: all of them for a quote
 * accepted whole, the chosen ones and the supplier's added ones for a part.
 * A quote accepted before `1o` marks none, and was accepted whole. Ask this of
 * an accepted quote only: an open quote marks nothing either.
 */
export function coveredLines<L extends { acceptedAt: Date | null }>(lines: readonly L[]): L[] {
  return lines.some((line) => line.acceptedAt !== null) ? lines.filter((line) => line.acceptedAt !== null) : [...lines];
}

/** Whether an accepted quote was accepted in part — some lines covered and some not. */
export function acceptedInPart(lines: readonly { acceptedAt: Date | null }[]): boolean {
  return lines.some((line) => line.acceptedAt !== null) && lines.some((line) => line.acceptedAt === null);
}
