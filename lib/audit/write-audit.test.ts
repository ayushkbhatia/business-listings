import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditReasonError, PermissionError } from "@/lib/auth/errors";
import type { Actor, Role } from "@/lib/auth/roles";
import { AUDITED_CAPABILITIES } from "@/lib/auth/capabilities";
import { staffMutation, SubjectCheckRequiredError } from "./staff-mutation";
import { ACTION_FOR_CAPABILITY, type AuditRow } from "./types";
import { AuditNotConfiguredError, setAuditWriter, writeAudit } from "./write-audit";

const actor = (...roles: Role[]): Actor => ({ id: `user_${roles.join("_")}`, roles });
const opsLead = actor("staff_ops_lead");
const moderator = actor("staff_moderator");

let rows: AuditRow[];

beforeEach(() => {
  rows = [];
  setAuditWriter({
    write: async (row) => {
      rows.push(row);
    },
  });
});

afterEach(() => {
  setAuditWriter(null);
  vi.restoreAllMocks();
});

describe("acceptance criterion 7 — a staff mutation without a reason throws", () => {
  it("rejects an omitted reason", async () => {
    await expect(
      writeAudit({
        actor: opsLead,
        action: "tier_change",
        subject: "Business:clx1",
        // @ts-expect-error the type already forbids this; the runtime must too
        reason: undefined,
      }),
    ).rejects.toThrow(AuditReasonError);
  });

  it("rejects an empty or whitespace reason", async () => {
    for (const reason of ["", "   ", "\n\t "]) {
      await expect(
        writeAudit({ actor: opsLead, action: "tier_change", subject: "Business:clx1", reason }),
      ).rejects.toThrow(AuditReasonError);
    }
  });

  it("rejects a keystroke that only exists to clear the field", async () => {
    for (const reason of ["x", "ok", "...", "---", "!!"]) {
      await expect(
        writeAudit({ actor: opsLead, action: "tier_change", subject: "Business:clx1", reason }),
      ).rejects.toThrow(AuditReasonError);
    }
  });

  it("writes nothing when the reason is rejected", async () => {
    await expect(
      writeAudit({ actor: opsLead, action: "suspend", subject: "Business:clx1", reason: "" }),
    ).rejects.toThrow();
    expect(rows).toHaveLength(0);
  });

  it("accepts a written reason and trims it", async () => {
    await writeAudit({
      actor: opsLead,
      action: "tier_change",
      subject: "Business:clx1",
      reason: "  Licence expired on 14 Aug 2026, dropped to tier 2.  ",
    });
    expect(rows[0]!.reason).toBe("Licence expired on 14 Aug 2026, dropped to tier 2.");
  });
});

describe("writeAudit", () => {
  it("records actor, action, subject and both sides of the change", async () => {
    await writeAudit({
      actor: opsLead,
      action: "tier_change",
      subject: "Business:clx1",
      reason: "Site visit completed, promoted to tier 3.",
      before: { verificationTier: 2 },
      after: { verificationTier: 3 },
    });
    expect(rows[0]).toEqual({
      actorId: "user_staff_ops_lead",
      action: "tier_change",
      subject: "Business:clx1",
      reason: "Site visit completed, promoted to tier 3.",
      before: { verificationTier: 2 },
      after: { verificationTier: 3 },
    });
  });

  it("stores null rather than undefined when a side is absent", async () => {
    await writeAudit({
      actor: opsLead,
      action: "view_as",
      subject: "Business:clx1",
      reason: "Support ticket 8841, buyer reports a missing product.",
    });
    expect(rows[0]!.before).toBeNull();
    expect(rows[0]!.after).toBeNull();
  });

  it("refuses to run at all when no writer is configured", async () => {
    setAuditWriter(null);
    await expect(
      writeAudit({
        actor: opsLead,
        action: "suspend",
        subject: "Business:clx1",
        reason: "Trade licence revoked by DED.",
      }),
    ).rejects.toThrow(AuditNotConfiguredError);
  });
});

describe("staffMutation", () => {
  const REASON = "Licence expired, dropping the tier as policy requires.";

  it("refuses a subject-dependent capability with no subject check", async () => {
    /*
     * The failure this prevents was silent. `assertCan` is role membership, and
     * for this row a role test passes for every field verifier — including one
     * tiering a business they have never visited, which is the single thing
     * CLAUDE.md's second non-negotiable exists to stop. The old contract let
     * that call run and write a tidy audit row saying it was fine.
     */
    const run = vi.fn(async () => ({ result: "ok" }));

    await expect(
      staffMutation(
        {
          actor: opsLead,
          capability: "business.verification_tier.write",
          subject: "Business:clx1",
          reason: REASON,
        },
        run,
      ),
    ).rejects.toThrow(SubjectCheckRequiredError);

    expect(run).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("refuses subjectChecked on a capability that does not take one", async () => {
    // A flag that can be set anywhere is a flag that means nothing.
    const run = vi.fn(async () => ({ result: "ok" }));

    await expect(
      staffMutation(
        {
          actor: opsLead,
          capability: "business.suspend",
          subject: "Business:clx1",
          reason: REASON,
          subjectChecked: true,
        },
        run,
      ),
    ).rejects.toThrow(/not subject-dependent/);

    expect(run).not.toHaveBeenCalled();
  });

  it("runs the mutation and writes exactly one audit row", async () => {
    const run = vi.fn(async () => ({ result: "ok", before: { tier: 3 }, after: { tier: 2 } }));

    const result = await staffMutation(
      {
        actor: opsLead,
        capability: "business.verification_tier.write",
        subject: "Business:clx1",
        reason: REASON,
        // Subject-dependent, so the caller has to say it ran the narrower
        // check — see lib/verification/service.ts, which does.
        subjectChecked: true,
      },
      run,
    );

    expect(result).toBe("ok");
    expect(run).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("tier_change");
  });

  it("rejects a moderator before the mutation runs", async () => {
    const run = vi.fn(async () => ({ result: "ok" }));

    await expect(
      staffMutation(
        {
          actor: moderator,
          capability: "business.verification_tier.write",
          subject: "Business:clx1",
          reason: REASON,
          subjectChecked: true,
        },
        run,
      ),
    ).rejects.toThrow(PermissionError);

    expect(run).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("rejects a blank reason before the permission check, and before the mutation", async () => {
    const run = vi.fn(async () => ({ result: "ok" }));

    await expect(
      staffMutation(
        {
          actor: opsLead,
          capability: "business.suspend",
          subject: "Business:clx1",
          reason: "  ",
        },
        run,
      ),
    ).rejects.toThrow(AuditReasonError);

    expect(run).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("propagates a failure in the mutation and logs nothing", async () => {
    const run = vi.fn(async () => {
      throw new Error("constraint violation");
    });

    await expect(
      staffMutation(
        { actor: opsLead, capability: "business.merge", subject: "Business:clx1", reason: REASON },
        run,
      ),
    ).rejects.toThrow("constraint violation");
    expect(rows).toHaveLength(0);
  });

  it("maps every audited capability to exactly one action", () => {
    for (const capability of AUDITED_CAPABILITIES) {
      expect(ACTION_FOR_CAPABILITY, capability).toHaveProperty(capability);
    }
    const actions = Object.values(ACTION_FOR_CAPABILITY);
    expect(new Set(actions).size).toBe(actions.length);
  });

  it("covers the seven actions data-model.md names by hand", () => {
    const named = ["tier_change", "review_removed", "credit_issued", "suspend", "merge", "boost", "view_as"];
    const mapped = new Set<string>(Object.values(ACTION_FOR_CAPABILITY));
    for (const action of named) expect(mapped, action).toContain(action);
  });
});
