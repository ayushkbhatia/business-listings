import { describe, expect, it } from "vitest";
import { CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { can } from "@/lib/auth/can";
import type { Actor, Role } from "@/lib/auth/roles";

/**
 * `lib/auth/capabilities.ts` against `docs/permissions.md`, row by row.
 *
 * The file it replaced carried an inferred matrix and a note to diff it against
 * §07 before handoff 1. That diff never happened, and by handoff 3 nine rows
 * were wrong — five of them in the direction of granting more than the design
 * allows. A comment asking somebody to check is not a check.
 *
 * So the tables below are transcribed from the document, and this asserts them.
 * If the document changes, this fails; if the code drifts, this fails. Either
 * is the right outcome, and neither is silent.
 */

const actor = (...roles: Role[]): Actor => ({ id: `u_${roles.join("_")}`, roles });

/* ── docs/permissions.md §2 — seller roles, board 7d ─────────────────────── */

type Seat = "owner" | "manager" | "sales" | "finance";
const SEAT: Record<Seat, Role> = {
  owner: "seller_owner",
  manager: "seller_manager",
  sales: "seller_sales",
  finance: "seller_finance",
};

/** ✓ = holds it. A sales seat's "own leads only" is a ✓ narrowed elsewhere. */
const SELLER_TABLE: [Capability, Seat[]][] = [
  ["enquiry.respond", ["owner", "manager", "sales"]],
  ["quote.send", ["owner", "manager", "sales"]],
  ["product.edit", ["owner", "manager"]],
  ["listing.edit", ["owner", "manager"]],
  ["review.reply", ["owner", "manager"]],
  ["review.request", ["owner", "manager", "sales"]],
  ["analytics.read", ["owner", "manager", "sales"]],
  ["billing.manage", ["owner", "finance"]],
  ["placement.purchase", ["owner", "finance"]],
  ["plan.change", ["owner"]],
  ["team.manage", ["owner", "manager"]],
  ["routing.manage", ["owner", "manager"]],
];

describe("seller roles match board 7d", () => {
  for (const [capability, holders] of SELLER_TABLE) {
    it(`${capability}: ${holders.join(", ")}`, () => {
      for (const seat of Object.keys(SEAT) as Seat[]) {
        expect(can(actor(SEAT[seat]), capability), `${capability} × ${seat}`).toBe(
          holders.includes(seat),
        );
      }
    });
  }

  it("has no row resembling fulfilment", () => {
    /*
     * Board 7d carried a "Dispatch orders & upload PODs" row from before the
     * e-commerce pivot. It was deleted rather than renamed, because there is no
     * order entity and therefore nothing to dispatch. This is what stops it
     * being reintroduced under a friendlier name.
     */
    const forbidden = /dispatch|fulfil|fulfill|shipment|shipping|delivery_note|pod\b|waybill|consignment/i;
    for (const capability of Object.keys(CAPABILITIES) as Capability[]) {
      expect(capability, capability).not.toMatch(forbidden);
      expect(CAPABILITIES[capability].why, capability).not.toMatch(/dispatch|proof of delivery/i);
    }
  });
});

/* ── docs/permissions.md §3 — staff roles, board 4i ──────────────────────── */

type Staff = "ops" | "moderator" | "field" | "finance";
const STAFF: Record<Staff, Role> = {
  ops: "staff_ops_lead",
  moderator: "staff_moderator",
  field: "staff_field",
  finance: "staff_finance",
};

const STAFF_TABLE: [Capability, Staff[]][] = [
  ["queue.decide", ["ops", "moderator"]],
  ["claim.resolve", ["ops"]],
  ["business.verification_tier.write", ["ops"]],
  ["taxonomy.write", ["ops"]],
  ["storefront.template.write", ["ops"]],
  ["review.remove", ["ops"]],
  // Board 1m's reversible pause, one rung below the removal above it.
  ["review.hold", ["ops", "moderator"]],
  ["report.resolve", ["ops", "moderator"]],
  ["business.suspend", ["ops"]],
  ["subscription.credit", ["finance"]],
  ["plan.entitlements.write", ["ops", "finance"]],
  ["revenue.read", ["finance"]],
  ["search.ranking.write", ["ops"]],
  ["placement.boost", ["ops"]],
  ["support.view_as", ["ops", "moderator"]],
  ["audit.read", ["ops", "moderator", "field", "finance"]],
];

describe("staff roles match board 4i", () => {
  for (const [capability, holders] of STAFF_TABLE) {
    it(`${capability}: ${holders.join(", ")}`, () => {
      for (const seat of Object.keys(STAFF) as Staff[]) {
        expect(can(actor(STAFF[seat]), capability), `${capability} × ${seat}`).toBe(
          holders.includes(seat),
        );
      }
    });
  }

  it("does not give the ops lead the two rows that are finance's alone", () => {
    // The separation is the point: the role that can suspend an account and
    // change a verification tier is not the role that can move money.
    expect(can(actor("staff_ops_lead"), "subscription.credit")).toBe(false);
    expect(can(actor("staff_ops_lead"), "revenue.read")).toBe(false);
  });

  it("audits every staff row that changes state, ops lead included", () => {
    // §07: "Every ✓ in this table that changes state writes an AuditEvent with
    // a non-null reason. Ops lead has no exemption."
    const readOnly = new Set<Capability>(["revenue.read", "audit.read"]);
    for (const [capability] of STAFF_TABLE) {
      if (readOnly.has(capability)) continue;
      expect(CAPABILITIES[capability].audited, capability).toBe(true);
    }
  });
});

/* ── docs/permissions.md §1 — the cross-surface table ────────────────────── */

describe("the cross-surface matrix", () => {
  it("lets a seller send an enquiry, not only a buyer", () => {
    // §07 row 1 is ✓ for both. A supplier buying from another supplier is
    // ordinary trade, and this was inferred as buyer-only.
    expect(can(actor("buyer"), "enquiry.create")).toBe(true);
    expect(can(actor("seller_owner"), "enquiry.create")).toBe(true);
  });

  it("lets nobody but an ops lead set a tier", () => {
    /*
       CLAUDE.md non-negotiable 2. A field verifier used to hold the row as
       well, for a business they had recorded a visit to. Site visits were
       withdrawn and that evidence with them, so the grant was narrowed to the
       ops lead rather than widened — `staff_field` is in the list below now.
    */
    for (const role of ["buyer", "seller_owner", "seller_manager", "staff_moderator", "staff_finance", "staff_field"] as Role[]) {
      expect(can(actor(role), "business.verification_tier.write"), role).toBe(false);
    }
  });

  it("marks every row the document calls subject-dependent", () => {
    /*
       permissions.md: "three of the rows above are subject-dependent and a
       role-only check gets them wrong." Two, now. The tier row was the third
       and its subject was the site visit that licensed a field verifier; with
       visits withdrawn it is a plain role check and must not claim otherwise —
       a leftover `subject` sends call sites through a check with nothing to
       read.
    */
    expect(CAPABILITIES["business.verification_tier.write"]).not.toHaveProperty("subject");
    expect(CAPABILITIES["enquiry.respond"].subject).toBe("own_branch");
    expect(CAPABILITIES["enquiry.read_other_business"].subject).toBe("other_business");
  });

  it("has no seller role able to read another business's enquiries", () => {
    for (const seat of Object.values(SEAT)) {
      expect(can(actor(seat), "enquiry.read_other_business"), seat).toBe(false);
    }
  });
});

describe("every row cites the document", () => {
  it("names every row §07 does not contain, so inferred cannot spread quietly", () => {
    /*
       Real capabilities with no row in permissions.md. Naming them here is what
       stops "inferred" spreading back through the file — adding one has to be a
       deliberate edit to this list rather than a quiet default.

       `question.remove` joined on board 1g. §07 has no row for it because
       product questions did not exist when the document was written. It is held
       at the ops-lead rung alongside `review.remove`, on the argument that
       taking down a buyer's published words is the same decision whichever
       surface it was written on — and erring higher is the safe direction for
       a removal.

       `review.hold` joined on board 1m, which states the held row — "one review
       is being reviewed by our team", out of every average while it stands —
       without saying who may set it. It sits one rung *below* `review.remove`,
       which is the opposite direction from the paragraph above and is deliberate:
       a hold is reversible and a removal is not, so putting the reversible
       control out of a moderator's reach would push them towards the
       irreversible one.

       `business.verification_tier.write` joined when site visits were
       withdrawn. §07 does still have a row for it — ops lead plus a field
       verifier for a visit they recorded — and half of that row now describes
       evidence the product does not gather. The grant was narrowed to the ops
       lead, which is a departure from the document and so is marked inferred
       rather than left claiming the document says it.
    */
    const inferred = (Object.keys(CAPABILITIES) as Capability[]).filter(
      (c) => CAPABILITIES[c].source === "inferred",
    );
    expect(inferred.sort()).toEqual([
      "business.merge",
      "business.verification_tier.write",
      "question.remove",
      "review.hold",
      "staff.manage",
    ]);
  });
});
