import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { ACTION_FOR_CAPABILITY } from "@/lib/audit/types";
import { CAPABILITIES } from "@/lib/auth/capabilities";

/**
 * The three queues handoff 4 drains, checked against a real seeded database.
 *
 * Handoff 3 fills `ListingChangeRequest`, `ClaimSubmission` and
 * `SiteVisitRequest` at runtime, and for three merges the seed did not — so
 * `pnpm db:seed` produced a database where `/admin/queue` had nothing to open
 * on. That is not a visible failure: an empty queue and a broken query look
 * identical on screen, and the screens that would have shown the difference
 * are the ones handoff 4 has yet to build.
 *
 * These tests are the tripwire. They assert the shapes an admin queue needs
 * rather than exact counts, so adding a fixture does not break them and
 * removing the last one of a kind does.
 *
 * The second half is the one worth keeping. Every decided row must carry an
 * audit event written by a role that actually holds the capability — CLAUDE.md
 * non-negotiable 3, and `claim.resolve` is ops lead alone. A seed that decides
 * a claim as a moderator puts a row in the database the permission matrix
 * forbids, and every screen built on top of it inherits the lie.
 */

describe("listing change requests", () => {
  it("cover every status the queue filters on", async () => {
    const byStatus = await prisma.listingChangeRequest.groupBy({
      by: ["status"],
      _count: true,
    });
    const seen = new Set(byStatus.map((row) => row.status));

    expect(seen).toContain("pending");
    expect(seen).toContain("approved");
    expect(seen).toContain("rejected");
    expect(seen).toContain("withdrawn");
  });

  it("cover all three moderated fields", async () => {
    const byField = await prisma.listingChangeRequest.groupBy({
      by: ["field"],
      _count: true,
    });
    const seen = new Set(byField.map((row) => row.field));

    // The enum is the product decision — only these three queue. If a fourth
    // ever appears, this fails and the seed has to say what it looks like.
    expect(seen).toEqual(new Set(["trade_name", "primary_category", "licence"]));
  });

  it("show a real diff, not just the ask", async () => {
    const pending = await prisma.listingChangeRequest.findMany({
      where: { status: "pending" },
      select: { beforeValue: true, afterValue: true },
    });

    expect(pending.length).toBeGreaterThan(0);
    for (const row of pending) {
      expect(row.beforeValue).toBeTruthy();
      expect(row.afterValue).toBeTruthy();
      expect(row.beforeValue).not.toEqual(row.afterValue);
    }
  });

  it("carry a written reason exactly on the decided ones", async () => {
    const rows = await prisma.listingChangeRequest.findMany({
      select: { status: true, decisionReason: true, decidedAt: true, decidedById: true },
    });

    for (const row of rows) {
      const decided = row.status === "approved" || row.status === "rejected";
      if (decided) {
        expect(row.decidedAt).not.toBeNull();
        expect(row.decidedById).not.toBeNull();
        expect(row.decisionReason?.trim().length ?? 0).toBeGreaterThan(0);
      } else {
        // Withdrawn is the seller changing their mind before anybody looked.
        // A reason on it would be somebody's words attributed to nobody.
        expect(row.decidedAt).toBeNull();
        expect(row.decisionReason).toBeNull();
      }
    }
  });

  it("are decided only by a role holding queue.decide", async () => {
    const allowed = new Set<string>(CAPABILITIES["queue.decide"].roles);
    const decided = await prisma.listingChangeRequest.findMany({
      where: { decidedById: { not: null } },
      select: { decidedBy: { select: { roles: true } } },
    });

    expect(decided.length).toBeGreaterThan(0);
    for (const row of decided) {
      expect(row.decidedBy?.roles.some((role) => allowed.has(role))).toBe(true);
    }
  });
});

describe("claim submissions", () => {
  it("include an undecided claim on each route", async () => {
    const undecided = await prisma.claimSubmission.findMany({
      where: { decidedAt: null },
      select: { route: true },
    });
    const routes = new Set(undecided.map((row) => row.route));

    expect(routes).toContain("phone_callback");
    expect(routes).toContain("licence_upload");
  });

  it("include a contested one, decided and not", async () => {
    const contested = await prisma.claimSubmission.findMany({
      where: { contested: true },
      select: { decidedAt: true },
    });

    expect(contested.some((row) => row.decidedAt === null)).toBe(true);
    expect(contested.some((row) => row.decidedAt !== null)).toBe(true);
  });

  it("carry the evidence their route is", async () => {
    const rows = await prisma.claimSubmission.findMany({
      select: { route: true, documentId: true, phone: true },
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      if (row.route === "licence_upload") expect(row.documentId).not.toBeNull();
      else expect(row.phone).not.toBeNull();
    }
  });

  it("carry a written reason exactly on the decided ones", async () => {
    const rows = await prisma.claimSubmission.findMany({
      select: { decidedAt: true, decisionReason: true },
    });

    for (const row of rows) {
      if (row.decidedAt === null) expect(row.decisionReason).toBeNull();
      else expect(row.decisionReason?.trim().length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("site visit requests", () => {
  it("cover asked, scheduled, completed and cancelled", async () => {
    const rows = await prisma.siteVisitRequest.findMany({
      select: { scheduledFor: true, completedAt: true, cancelledAt: true },
    });

    const asked = rows.filter((r) => !r.scheduledFor && !r.completedAt && !r.cancelledAt);
    const scheduled = rows.filter((r) => r.scheduledFor && !r.completedAt && !r.cancelledAt);
    const completed = rows.filter((r) => r.completedAt !== null);
    const cancelled = rows.filter((r) => r.cancelledAt !== null);

    expect(asked.length).toBeGreaterThan(0);
    expect(scheduled.length).toBeGreaterThan(0);
    expect(completed.length).toBeGreaterThan(0);
    expect(cancelled.length).toBeGreaterThan(0);
  });

  it("leave a completed visit attributable to the staff member who made it", async () => {
    /*
     * lib/auth/subject.ts reads exactly this: a field verifier may set a tier
     * only for a visit they recorded. A completed visit whose business has no
     * `visitedByStaffId` is a tier nobody but ops lead can ever move, which is
     * a permission bug that only shows up as a missing button.
     */
    const completed = await prisma.siteVisitRequest.findMany({
      where: { completedAt: { not: null } },
      select: { business: { select: { visitedAt: true, visitedByStaffId: true } } },
    });

    expect(completed.length).toBeGreaterThan(0);
    for (const row of completed) {
      expect(row.business.visitedAt).not.toBeNull();
      expect(row.business.visitedByStaffId).not.toBeNull();
    }
  });
});

describe("the audit rows those decisions owe", () => {
  it("exist for every decided change request", async () => {
    const [decidedChanges, queueDecided] = await Promise.all([
      prisma.listingChangeRequest.count({ where: { decidedAt: { not: null } } }),
      prisma.auditEvent.count({ where: { action: "queue_decided" } }),
    ]);
    expect(queueDecided).toBeGreaterThanOrEqual(decidedChanges);
  });

  it("exist once per resolved conflict, not once per decided claim", async () => {
    /*
     * Written the other way round in step 0, and wrong once step 1 built the
     * resolution: settling a conflict is ONE decision that decides TWO
     * submissions, so counting audit rows against decided claims expects twice
     * as many rows as there are decisions.
     *
     * One decision, one audit row, and the subject is the conflict rather than
     * either submission — which is also what makes the row readable. "Resolved
     * this claim" says nothing about the person on the other side of it.
     */
    const resolved = await prisma.claimConflict.findMany({
      where: { resolvedAt: { not: null } },
      select: { id: true },
    });

    for (const conflict of resolved) {
      const rows = await prisma.auditEvent.count({
        where: { action: "claim_resolved", subject: `ClaimConflict:${conflict.id}` },
      });
      expect(rows, `conflict ${conflict.id}`).toBe(1);
    }
  });

  it("are written by an actor who holds the capability", async () => {
    // The map is the same one lib/audit/staff-mutation.ts uses, so this reads
    // the production wiring rather than a copy of it.
    const roleFor = new Map<string, ReadonlySet<string>>();
    for (const [capability, action] of Object.entries(ACTION_FOR_CAPABILITY)) {
      roleFor.set(
        action,
        new Set(CAPABILITIES[capability as keyof typeof CAPABILITIES].roles),
      );
    }

    const events = await prisma.auditEvent.findMany({
      select: { action: true, reason: true, actor: { select: { roles: true } } },
    });

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.reason.trim().length).toBeGreaterThan(0);

      const allowed = roleFor.get(event.action);
      // An action with no capability behind it is a hole in the map, not a
      // reason to skip the check.
      expect(allowed, `no capability maps to audit action "${event.action}"`).toBeDefined();
      expect(
        event.actor.roles.some((role) => allowed!.has(role)),
        `"${event.action}" written by ${event.actor.roles.join(", ")}`,
      ).toBe(true);
    }
  });
});
