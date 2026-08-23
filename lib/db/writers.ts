import "server-only";
import { setAuditWriter } from "@/lib/audit/write-audit";
import { setContactRevealWriter } from "@/lib/audit/contact-reveal";
import type { AuditRow } from "@/lib/audit/types";
import type { ContactRevealRow } from "@/lib/audit/contact-reveal";
import { prisma } from "./client";
import type { Prisma } from "./generated/client";

/**
 * Wires the audit and contact-reveal ports to Prisma.
 *
 * Import this once, from instrumentation.ts, so nothing that can mutate staff
 * state can load without an audit trail behind it.
 */

/** A Prisma transaction client, or the base client when there is no transaction. */
export type Db = Prisma.TransactionClient | typeof prisma;

/**
 * The audit row and the mutation it records belong in one transaction. Set the
 * transaction for the duration of a staffMutation and the write lands inside
 * it; leave it unset and the write goes to the base client.
 *
 * AsyncLocalStorage rather than a module-level variable: two concurrent requests
 * on the same server must not see each other's transaction.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const txStore = new AsyncLocalStorage<Prisma.TransactionClient>();

export function runInAuditedTransaction<T>(
  tx: Prisma.TransactionClient,
  fn: () => Promise<T>,
): Promise<T> {
  return txStore.run(tx, fn);
}

function db(): Db {
  return txStore.getStore() ?? prisma;
}

export function installPersistence(): void {
  setAuditWriter({
    async write(row: AuditRow) {
      await db().auditEvent.create({
        data: {
          actorId: row.actorId,
          action: row.action,
          subject: row.subject,
          reason: row.reason,
          before: (row.before ?? null) as Prisma.InputJsonValue,
          after: (row.after ?? null) as Prisma.InputJsonValue,
        },
      });
    },
  });

  setContactRevealWriter({
    async write(row: ContactRevealRow) {
      // Deliberately on the base client, never inside a caller's transaction:
      // a counter must not be able to roll back the thing it counted.
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
