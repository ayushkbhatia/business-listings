import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Deleting thread messages a test wrote.
 *
 * A message is the dispute record since board `10h` (`B10`): trigger
 * `message_is_the_record` refuses every edit, and refuses a DELETE aimed at a
 * message unless it arrives as a cascade from its enquiry, business or sender —
 * or the session has set `app.thread_maintenance` to `on`. Test cleanup is the
 * one sanctioned caller of the flag and this is the one place it sets it, with
 * `set_config(..., true)` so it ends with the transaction rather than riding a
 * pooled connection into the next query — which may be a service the trigger
 * exists to refuse. Mirrors `purgeAuditRows`.
 */
export async function purgeThreadMessages(where: Prisma.MessageWhereInput): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.thread_maintenance', 'on', true)`;
    const { count } = await tx.message.deleteMany({ where });
    return count;
  });
}
