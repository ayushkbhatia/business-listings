import "server-only";
import { prisma } from "@/lib/db/client";
import { setAuditWriter } from "./write-audit";
import { setContactRevealWriter } from "./contact-reveal";
import type { AuditRow, AuditTransaction } from "./types";

/**
 * The Prisma implementations of the two audit ports.
 *
 * Handoff 0 built the ports and left the writers for "checkpoint 3". They were
 * never wired, which meant `writeAudit` threw `AuditNotConfiguredError` and no
 * audited staff mutation could run at all. Nothing had called one yet, so
 * nothing noticed — review removal in handoff 2 step 6 is the first.
 *
 * Registered by importing this module. `install()` is idempotent so a hot
 * reload does not stack writers.
 */
export function installAuditWriters(): void {
  setAuditWriter({
    async write(row: AuditRow, tx?: AuditTransaction) {
      const client = tx ?? prisma;
      await client.auditEvent.create({
        data: {
          actorId: row.actorId,
          action: row.action,
          subject: row.subject,
          // NOT NULL in the schema and validated before it reaches here.
          reason: row.reason,
          before: (row.before ?? null) as never,
          after: (row.after ?? null) as never,
        },
      });
    },
  });

  setContactRevealWriter({
    async write(row) {
      await prisma.contactReveal.create({
        data: {
          actorId: row.actorId,
          businessId: row.businessId,
          locationId: row.locationId,
          channel: row.channel,
          surface: row.surface,
        },
      });
    },
  });
}

installAuditWriters();
