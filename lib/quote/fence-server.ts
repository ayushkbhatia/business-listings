import "server-only";
import type { Prisma } from "@/lib/db/generated/client";
import type { QuoteFenceState } from "./fence";

/**
 * Read the fence's state inside a transaction, holding the enquiry row.
 *
 * **The lock is the point.** Checking before the write is not a fence under
 * READ COMMITTED: a buyer's accept and a supplier's send can each read the
 * enquiry as open, and both commit — a quote on an accepted enquiry, the exact
 * row the fence exists to refuse. `acceptQuote` claims the enquiry with a
 * conditional update, which takes the same row lock, so whichever arrives second
 * waits for the first to commit and then reads what it wrote:
 *
 *  - send first: the accept waits, then marks the new quote lost and the
 *    recipient declined, exactly as it does for every other supplier;
 *  - accept first: the send waits, then reads the release and refuses.
 *
 * Returns null when this business was never sent the enquiry, which every caller
 * answers the same way as a missing enquiry.
 */
export async function lockQuoteFence(
  tx: Prisma.TransactionClient,
  enquiryId: string,
  businessId: string,
): Promise<QuoteFenceState | null> {
  const locked = await tx.$queryRaw<EnquiryRow[]>`
    SELECT closes_at, contact_released_to_business_id
    FROM enquiry
    WHERE id = ${enquiryId}
    FOR UPDATE
  `;
  return withRecipient(tx, locked[0], enquiryId, businessId);
}

/**
 * The same state without the lock, for the answer a seller reads first.
 *
 * A send checks this before it validates eleven prices, so a supplier on an
 * accepted enquiry is told that rather than being asked to fix a decimal — and
 * then checks again under the lock, because this read proves nothing by the
 * time the write happens.
 */
export async function readQuoteFence(
  db: Prisma.TransactionClient,
  enquiryId: string,
  businessId: string,
): Promise<QuoteFenceState | null> {
  const rows = await db.$queryRaw<EnquiryRow[]>`
    SELECT closes_at, contact_released_to_business_id
    FROM enquiry
    WHERE id = ${enquiryId}
  `;
  return withRecipient(db, rows[0], enquiryId, businessId);
}

interface EnquiryRow {
  closes_at: Date;
  contact_released_to_business_id: string | null;
}

async function withRecipient(
  db: Prisma.TransactionClient,
  enquiry: EnquiryRow | undefined,
  enquiryId: string,
  businessId: string,
): Promise<QuoteFenceState | null> {
  if (!enquiry) return null;

  const recipient = await db.enquiryRecipient.findUnique({
    where: { enquiryId_businessId: { enquiryId, businessId } },
    select: { state: true, outcome: true, business: { select: { suspendedAt: true } } },
  });
  if (!recipient) return null;

  return {
    businessId,
    contactReleasedToBusinessId: enquiry.contact_released_to_business_id,
    recipientState: recipient.state,
    outcome: recipient.outcome,
    suspended: recipient.business.suspendedAt !== null,
    closesAt: enquiry.closes_at,
  };
}
