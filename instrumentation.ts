/**
 * Runs once per server process, before any route handler.
 *
 * Installing the audit and contact-reveal writers here means a staff mutation
 * cannot reach the database on a server where the audit trail was never wired —
 * writeAudit throws AuditNotConfiguredError rather than writing silently.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installPersistence } = await import("./lib/db/writers");
    await installPersistence();
  }
}
