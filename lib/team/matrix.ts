import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { SELLER_ROLES } from "@/lib/auth/roles";
import type { Role } from "@/lib/auth/roles";

/**
 * Board 7d §2 — what each role can do, derived rather than drawn.
 *
 * The four seller roles are canonical on this screen and `docs/permissions.md`
 * §2 is the source of truth for them. `lib/auth/capabilities.ts` is that file
 * transcribed, and `can()` is the only thing in the product that answers the
 * question — so the ticks below come from the same table the guards read.
 *
 * A hand-written matrix would be a fourth copy of the permission model, kept
 * level with the other three by nobody. It would also be the copy a seller
 * reads, which makes it the one that must not be wrong: a screen promising a
 * sales seat can send a quote, over a guard that refuses, is a support ticket
 * with a screenshot attached.
 *
 * ## Two rows, one capability
 *
 * "Send a quote revision" and "Extend a quote's validity" are both `quote.send`
 * — board 3k ships the extend action behind that guard, and 7d asks for the row
 * because the matrix had none. They are listed separately because a seller asks
 * about them separately, and they carry the same ticks because they are the
 * same permission. The alternative is inventing a capability nothing checks.
 *
 * ## Where this disagrees with the board's render
 *
 * The board draws `See analytics` as a dash for Sales. `analytics.read` grants
 * it — "owner and manager in full, a sales seat for their own leads only" — and
 * the row carries `subject: own_branch`, which is what "their own" means. The
 * table below follows the capability, and the scope note beside the row says
 * what the tick is limited to. A picture and a permission matrix disagreed; the
 * permission matrix is the one the product enforces.
 */

/** The columns, in the order 7d §2 names them. */
export const MATRIX_ROLES: readonly Role[] = SELLER_ROLES;

export interface MatrixRow {
  /** The i18n key under `team.can.`, which is also this row's stable id. */
  key: string;
  capability: Capability;
  /** True where a role grant is not the whole answer — see lib/auth/subject.ts. */
  scoped: boolean;
}

const ROWS: readonly { key: string; capability: Capability }[] = [
  { key: "respond", capability: "enquiry.respond" },
  { key: "revise", capability: "quote.send" },
  { key: "extend", capability: "quote.send" },
  { key: "products", capability: "product.edit" },
  { key: "listing", capability: "listing.edit" },
  { key: "analytics", capability: "analytics.read" },
  { key: "team", capability: "team.manage" },
  { key: "routing", capability: "routing.manage" },
  { key: "billing", capability: "billing.manage" },
  { key: "plan", capability: "plan.change" },
];

export const MATRIX_ROWS: readonly MatrixRow[] = ROWS.map((row) => ({
  ...row,
  scoped: "subject" in CAPABILITIES[row.capability],
}));

/** Whether this role holds this capability. The same table `can()` reads. */
export function holds(role: Role, capability: Capability): boolean {
  return (CAPABILITIES[capability].roles as readonly string[]).includes(role);
}
