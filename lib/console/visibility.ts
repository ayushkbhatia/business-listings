import { can } from "@/lib/auth/can";
import type { Actor } from "@/lib/auth/roles";
import { capabilityForNavKey } from "@/components/structure/nav-config";

/**
 * May this seat open the screen behind a nav key?
 *
 * Every figure on board 4a links to the screen that owns it, and the capability
 * that gates that screen is already declared once — in `ADMIN_NAV`. Reading it
 * from there rather than restating it here is what keeps the two from
 * drifting: §07 puts `revenue.read` with finance and gives ops lead a dash, so
 * an ops lead's overview once showed a past-due count linking straight into a
 * 404.
 *
 * A key with no capability — the overview itself, `/admin/businesses`,
 * `/admin/quotes` — is any staff seat's.
 */
export function mayOpen(actor: Actor, navKey: string): boolean {
  const capability = capabilityForNavKey(navKey);
  return !capability || can(actor, capability);
}
