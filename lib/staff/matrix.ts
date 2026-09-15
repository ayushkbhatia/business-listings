import { CAPABILITIES, CAPABILITY_LIST, type Capability } from "@/lib/auth/capabilities";
import { STAFF_ROLES, type StaffRole } from "@/lib/auth/roles";

/**
 * Board 4i's "Role permissions" panel, as data. `B5`.
 *
 * Built from `CAPABILITIES` and nothing else. The render drew seven rows by
 * hand, and a hand-drawn matrix is how the 5 Sep cut shipped a `FLD` column
 * holding "Set verification tier" nine days after the permission was withdrawn:
 * the document was updated and the picture of it was not. Here the picture *is*
 * the table `can()` reads, so the two cannot disagree — `4b`'s bulk-approve gate,
 * `12b`'s merge and `11c`'s removal answer from the same rows this panel shows.
 *
 * What is decided here is only grouping and order, for reading. A capability
 * that some staff role holds and that no group names fails
 * `tests/unit/staff-matrix.test.ts`, so a new row cannot quietly miss the panel.
 */

export const MATRIX_GROUPS = [
  {
    key: "trust",
    capabilities: [
      "business.verification_tier.write",
      "claim.resolve",
      "business.suspend",
      "account.suspend",
      "business.close",
      "business.merge",
    ],
  },
  {
    key: "moderation",
    capabilities: [
      "queue.decide",
      "queue.rules",
      "report.resolve",
      "review.hold",
      "review.remove",
      "question.remove",
      "support.view_as",
      "enquiry.read_other_business",
      "crm.work",
    ],
  },
  {
    key: "catalogue",
    capabilities: [
      "taxonomy.read",
      "taxonomy.write",
      "taxonomy.merge",
      "storefront.template.write",
      "search.ranking.write",
      "placement.boost",
      "notification.template.write",
      "notification.read",
      "homepage.curate",
      "strings.write",
    ],
  },
  {
    key: "commercial",
    capabilities: ["subscription.credit", "plan.entitlements.write", "revenue.read"],
  },
  {
    key: "staff",
    capabilities: ["staff.manage", "staff.read", "audit.read"],
  },
] as const satisfies readonly { key: string; capabilities: readonly Capability[] }[];

export type MatrixGroupKey = (typeof MATRIX_GROUPS)[number]["key"];

export interface MatrixRow {
  capability: Capability;
  /** Written into the audit log, with a reason, whenever it is used. */
  audited: boolean;
  grants: Record<StaffRole, boolean>;
  /**
   * Held by every staff role, but not to the same depth — `audit.read` is the
   * whole log for an ops lead and their own rows for everybody else. A tick in
   * every column would read as "everybody sees everything", so the panel says so.
   */
  scoped: boolean;
}

export interface MatrixGroup {
  key: MatrixGroupKey;
  rows: MatrixRow[];
}

/** Capabilities some staff role holds. Seller and buyer rows are not this panel's. */
export function staffCapabilities(): Capability[] {
  return CAPABILITY_LIST.filter((capability) =>
    (CAPABILITIES[capability].roles as readonly string[]).some((role) =>
      (STAFF_ROLES as readonly string[]).includes(role),
    ),
  );
}

export function staffMatrix(): MatrixGroup[] {
  return MATRIX_GROUPS.map((group) => ({
    key: group.key,
    rows: group.capabilities.map((capability) => {
      const spec = CAPABILITIES[capability];
      const held = spec.roles as readonly string[];
      return {
        capability,
        audited: spec.audited,
        grants: {
          staff_ops_lead: held.includes("staff_ops_lead"),
          staff_moderator: held.includes("staff_moderator"),
          staff_finance: held.includes("staff_finance"),
        },
        scoped: capability === "audit.read",
      };
    }),
  }));
}

/** How many capabilities each staff role holds. For the role picker's one-line summary. */
export function grantCount(role: StaffRole): number {
  return staffCapabilities().filter((capability) =>
    (CAPABILITIES[capability].roles as readonly string[]).includes(role),
  ).length;
}

/**
 * What moving somebody from one role to another adds and takes away.
 *
 * The change-role dialog shows both lists before the click. "Moderator to
 * finance" is a sentence that sounds like a promotion or a sideways step
 * depending on who reads it; "gains: issue subscription credits · loses: approve
 * listings & edits" is not.
 */
export function roleDelta(from: StaffRole | null, to: StaffRole | null): {
  gains: Capability[];
  loses: Capability[];
} {
  const holds = (role: StaffRole | null, capability: Capability) =>
    role !== null && (CAPABILITIES[capability].roles as readonly string[]).includes(role);
  // In the panel's reading order, so the dialog lists rows where the matrix does.
  const all: Capability[] = MATRIX_GROUPS.flatMap((group) => [...group.capabilities]);
  return {
    gains: all.filter((capability) => holds(to, capability) && !holds(from, capability)),
    loses: all.filter((capability) => holds(from, capability) && !holds(to, capability)),
  };
}
