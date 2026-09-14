import { prisma } from "@/lib/db/client";
import type { Prisma } from "@/lib/db/generated/client";

/**
 * Pin one interleaving of a write against the enquiry's row lock.
 *
 * A `Promise.all` race proves only what the scheduler happened to do that run.
 * This holds the lock `lockQuoteFence` takes, starts `racer`, and waits until
 * Postgres reports the racer blocked on this very transaction — through
 * `pg_blocking_pids`, not a sleep. By then the racer has done every read it does
 * before the lock. `meanwhile` then writes what the other side of the race would
 * have committed, the hold commits, and the racer resumes against it.
 *
 * A racer that finishes without ever waiting fails loudly: that is a write path
 * that does not take the lock, which is the defect these tests exist for.
 */
export async function whileHoldingEnquiryLock<T>(
  enquiryId: string,
  racer: () => Promise<T>,
  meanwhile: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<T> {
  let pending: Promise<T> | undefined;
  await prisma.$transaction(
    async (tx) => {
      const [holder] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM enquiry WHERE id = ${enquiryId} FOR UPDATE`;
      pending = racer();
      await untilBlockedBy(holder!.pid, pending);
      await meanwhile(tx);
    },
    { timeout: 20_000 },
  );
  return pending!;
}

async function untilBlockedBy(holder: number, racer: Promise<unknown>): Promise<void> {
  let settled = false;
  racer.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (settled) throw new Error("The racer finished without waiting on the enquiry's row lock.");
    const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE ${holder}::int = ANY (pg_blocking_pids(pid))
    `;
    if (row!.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("The racer never waited on the enquiry's row lock.");
}
