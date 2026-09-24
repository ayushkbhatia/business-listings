import { describe, expect, it } from "vitest";
import { CAPABILITIES, PROVISIONAL_CAPABILITIES, type Capability } from "@/lib/auth/capabilities";
import { can, capabilitiesFor } from "@/lib/auth/can";
import { isRole, ROLES, SELLER_ROLES, STAFF_ROLES, type Actor, type Role } from "@/lib/auth/roles";

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

type Staff = "ops" | "moderator" | "finance";
const STAFF: Record<Staff, Role> = {
  ops: "staff_ops_lead",
  moderator: "staff_moderator",
  finance: "staff_finance",
};

const STAFF_TABLE: [Capability, Staff[]][] = [
  ["queue.decide", ["ops", "moderator"]],
  // Board 4b's rule tuning. Inferred; named in the inferred list below.
  ["queue.rules", ["ops"]],
  ["claim.resolve", ["ops"]],
  ["business.verification_tier.write", ["ops"]],
  ["taxonomy.write", ["ops"]],
  // Board 4d. Inferred; named in the inferred list below.
  ["taxonomy.read", ["ops", "moderator"]],
  ["taxonomy.merge", ["ops"]],
  ["review.remove", ["ops"]],
  // Board 1m's reversible pause, one rung below the removal above it.
  ["review.hold", ["ops", "moderator"]],
  ["report.resolve", ["ops", "moderator"]],
  // Board 4h's detection thresholds. Inferred; named in the inferred list below.
  ["report.detectors", ["ops"]],
  ["business.suspend", ["ops"]],
  ["subscription.credit", ["finance"]],
  ["plan.entitlements.write", ["ops", "finance"]],
  ["revenue.read", ["finance"]],
  ["search.ranking.write", ["ops"]],
  ["placement.boost", ["ops"]],
  ["support.view_as", ["ops", "moderator"]],
  ["audit.read", ["ops", "moderator", "finance"]],
  // Standing item 9.5's run record. Inferred; named in the inferred list below.
  ["jobs.read", ["ops", "moderator", "finance"]],
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

  it("has three staff roles, and the field verifier is not one of them", () => {
    // Board 4i `B1`: retired means removed. A value `isRole()` still accepted
    // would be one a claim, a seed or a form could grant.
    expect([...STAFF_ROLES].sort()).toEqual(Object.values(STAFF).sort());
    expect(isRole("staff_field")).toBe(false);
  });

  it("does not give the ops lead the two rows that are finance's alone", () => {
    // The separation is the point: the role that can suspend an account and
    // change a verification tier is not the role that can move money.
    expect(can(actor("staff_ops_lead"), "subscription.credit")).toBe(false);
    expect(can(actor("staff_ops_lead"), "revenue.read")).toBe(false);
  });

  it("audits every staff row that changes state, ops lead included", () => {
    // §07: "Every ✓ in this table that changes state writes an AuditEvent with
    // a non-null reason. Ops lead has no exemption."
    // Board 4d's `taxonomy.read` reads the tree and changes nothing.
    const readOnly = new Set<Capability>(["revenue.read", "audit.read", "taxonomy.read", "jobs.read"]);
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
       ops lead rather than widened — and board 4i then retired `staff_field`
       outright, so it is not in the list below because it is not a role.
    */
    for (const role of ["buyer", "seller_owner", "seller_manager", "staff_moderator", "staff_finance"] as Role[]) {
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

/* ── The buyer journey — build plan 9.4 ───────────────────────────────────── */

describe("the three buyer rows, which nothing asked until 9.4", () => {
  const JOURNEY: Capability[] = ["enquiry.create", "quote.accept", "review.create"];
  /** What `actorFor` returns for a claim-token buyer: no role, marked. */
  const provisional: Actor = { id: "u_provisional", roles: [], provisional: true };

  it("lets a buyer with no account send, accept and review — and do nothing else", () => {
    /*
       The finding. A provisional identity holds no role, so while these three
       were role grants, asking them would have refused most buyers the one
       thing the funnel exists for. What it holds is named on the matrix, and
       this is the whole list: a phone number and a claim token go no further.
    */
    expect([...PROVISIONAL_CAPABILITIES].sort()).toEqual([...JOURNEY].sort());
    expect(capabilitiesFor(provisional).sort()).toEqual([...JOURNEY].sort());
  });

  it("answers a provisional identity from the matrix even if its row carries a role", () => {
    // Claiming the identity is what grants a role; a stray one on the row grants nothing.
    const withStrayRole: Actor = { id: "u_stray", roles: ["staff_ops_lead"], provisional: true };
    expect(capabilitiesFor(withStrayRole).sort()).toEqual([...JOURNEY].sort());
  });

  it("gives the three the same holders, so no seat can start an enquiry it cannot finish", () => {
    // §07 row 1 gives sending to buyer and seller; accepting and reviewing were
    // buyer-only, which left a supplier's seat able to ask and unable to accept.
    for (const role of ROLES) {
      const held = JOURNEY.map((capability) => can(actor(role), capability));
      expect(new Set(held).size, role).toBe(1);
    }
    for (const role of ["buyer", ...SELLER_ROLES] as Role[]) {
      for (const capability of JOURNEY) expect(can(actor(role), capability), `${role} × ${capability}`).toBe(true);
    }
  });

  it("gives none of them to a staff role on its own — §07's dash — and all of them to staff who also buy", () => {
    for (const role of STAFF_ROLES) {
      for (const capability of JOURNEY) expect(can(actor(role), capability), `${role} × ${capability}`).toBe(false);
      for (const capability of JOURNEY) expect(can(actor("buyer", role), capability), `buyer+${role}`).toBe(true);
    }
  });

  it("gives an account with no role none of them — a claimed account holds at least `buyer`", () => {
    for (const capability of JOURNEY) expect(can(actor(), capability), capability).toBe(false);
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

       `review.dispute` joined on board 11c, whose `Q4` asks who may raise one.
       Board 7d's table has "Reply to a review" and stops there, so there is no
       row to cite. Owner alone, one rung above `review.reply`: a reply is the
       business answering in public, and a dispute is a formal claim it makes
       about a named customer with a two-working-day decision attached.

       `business.close` joined on board 11i, for build note B8's
       platform-initiated closure of a lapsed licence and the withdraw and reopen
       that undo one. §07 has no closure row because closure did not exist. Held
       at ops lead beside `business.suspend`, which it outranks: a suspension is a
       pause, a closure revokes the team. `account.close`, the owner's own
       closure, is not in this list — the owner answered Q4 on 14 Sep 2026, so
       it cites a decision rather than inferring one.

       `queue.rules` joined on board 4b, for "Tune auto-check rules". Moving a
       threshold changes what bulk approve may act on across the whole queue,
       so it sits a rung above `queue.decide`, at ops lead.

       `staff.read` joined on board 4i, whose states table says a non-ops viewer
       "sees the matrix read-only". §07 has no row for reading the roster. Every
       staff seat holds it and it is not audited, because reading who holds which
       role changes nothing — the write beside it, `staff.manage`, stays ops lead.

       `notification.template.write` and `notification.read` joined on board 12g,
       split out of `taxonomy.write`, which had gated the screen because it was
       the nearest ops-lead row. The write follows "Edit taxonomy & spec
       templates" to ops lead alone — a save changes what every recipient is
       sent, and on WhatsApp it submits wording to Meta. The read adds the
       moderator, who answers a seller asking why they were not told.

       `homepage.curate` joined on board 6h, whose Q5 names the gap: the screen
       borrowed `taxonomy.write`. Ops lead alone, the rung that owns the tier the
       four cards assert.

       `taxonomy.read` and `taxonomy.merge` joined on board 4d. The page had been
       gated on the write, so the moderator deciding a category change could not
       see the tree it was deciding against. The merge is split out of the write
       for Q4, "who may merge", so the answer is one row.

       `strings.write` joined on board 12g-s, split out of the same borrowed
       `taxonomy.write`: a paired half is what every business of one kind reads,
       written without a deploy. Ops lead alone.

       `report.detectors` joined on board 4h `B11`, for the thresholds its two
       nightly sweeps file against. The same argument as `queue.rules` one row
       up: deciding a report is working the queue, and moving the line that
       decides what lands in it is answering for the queue. Ops lead alone. §07
       has no row because the detectors did not exist.

       `contact_lead.read` and `contact_lead.platform.read` joined on the `1d`
       amendment, when the owner asked that a landline reveal register as a
       lead in the seller's panel and the site owner's. Neither panel existed
       when §07 or board 7d were drawn. The seller's list sits with owner and
       manager, the seats that read the whole unassigned queue; staff's with the
       ops lead alone, because every row is a buyer's contact details.

       `quote.accept` and `review.create` joined on build plan 9.4, having been
       marked `stated` with no row to state them — §07's only buyer row is
       "Send an enquiry". 9.4 is when they were first asked, and the answer they
       gave refused the provisional identity most enquiries belong to and a
       supplier's seat on the enquiry §07 lets it send. Both now follow
       `enquiry.create`: whoever may send an enquiry may finish it.

       `jobs.read` joined on standing item 9.5, for `/admin/jobs`: when each cron
       last ran, which runs are missing and which steps threw. §07 has no row
       because the record did not exist. Every staff seat holds it — each answers
       for something the two routes do — and it is not audited: the screen has
       nothing to press.
    */
    const inferred = (Object.keys(CAPABILITIES) as Capability[]).filter(
      (c) => CAPABILITIES[c].source === "inferred",
    );
    expect(inferred.sort()).toEqual([
      "business.close",
      "business.merge",
      "business.verification_tier.write",
      "contact_lead.platform.read",
      "contact_lead.read",
      "homepage.curate",
      "jobs.read",
      "notification.read",
      "notification.template.write",
      "question.remove",
      "queue.rules",
      "quote.accept",
      "report.detectors",
      "review.create",
      "review.dispute",
      "review.hold",
      "staff.manage",
      "staff.read",
      "strings.write",
      "taxonomy.merge",
      "taxonomy.read",
    ]);
  });
});
