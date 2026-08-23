import { CAPABILITIES, type Capability } from "./capabilities";
import { PermissionError } from "./errors";
import type { Actor } from "./roles";

/**
 * The single predicate. Every named guard in guards.ts routes through it, and
 * nothing in a component compares a role string.
 */
export function can(actor: Actor, capability: Capability): boolean {
  const spec = CAPABILITIES[capability];
  return actor.roles.some((role) => (spec.roles as readonly string[]).includes(role));
}

/** Throws PermissionError. Server-side only; there is no client equivalent. */
export function assertCan(actor: Actor, capability: Capability): void {
  if (!can(actor, capability)) throw new PermissionError(capability, actor.id);
}

/**
 * What this actor may do. Drives nav config and the "locked by plan" treatment —
 * the panel is shown dimmed, never hidden. A seller cannot want what they cannot
 * see, and a staff member needs to know a queue exists to ask for access to it.
 */
export function capabilitiesFor(actor: Actor): Capability[] {
  return (Object.keys(CAPABILITIES) as Capability[]).filter((c) => can(actor, c));
}
