import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Deleting audit rows a test wrote.
 *
 * `audit_event` is append-only since board 4i: a trigger refuses every UPDATE,
 * and refuses a DELETE unless the session has set `app.audit_maintenance` to
 * `on`. Test cleanup is the one sanctioned caller, and this is the one place it
 * sets the flag — with `set_config(..., true)`, so the setting is local to this
 * transaction and ends with it rather than riding a pooled connection into the
 * next query, which may be a service the trigger exists to refuse.
 */
export async function purgeAuditRows(where: Prisma.AuditEventWhereInput): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.audit_maintenance', 'on', true)`;
    const { count } = await tx.auditEvent.deleteMany({ where });
    return count;
  });
}
