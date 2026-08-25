import "server-only";

/**
 * Wires the audit and contact-reveal ports to Prisma.
 *
 * There is one implementation, in `lib/audit/prisma-writer.ts`, and this module
 * exists only so `instrumentation.ts` has a stable name to call at process
 * start. Importing the writer module registers it; the import is the wiring.
 *
 * It used to hold a **second** implementation, and the two disagreed about the
 * thing that matters most. `staffMutation` promises that the audit row and the
 * mutation it records "commit together or not at all", which it delivers by
 * passing its transaction handle down to the writer. The copy that lived here
 * ignored that argument and read the transaction from an `AsyncLocalStorage`
 * set by `runInAuditedTransaction` — a function nothing in the repo ever
 * called. So whichever writer registered last won: `instrumentation.ts`
 * installed this one at process start, and then the first module to import
 * `prisma-writer` replaced it. Whether an audit row joined its transaction
 * depended on module load order, which is not a property anybody can reason
 * about and not one any test would have caught.
 */
export async function installPersistence(): Promise<void> {
  await import("@/lib/audit/prisma-writer");
}
