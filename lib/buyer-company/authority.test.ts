import { describe, expect, it } from "vitest";
import {
  aedToFils,
  approvalNeed,
  approverHasNoCover,
  authorityCovers,
  eligibleApprovers,
  mayApprove,
  remainingFils,
  type ApprovalPolicy,
  type Seat,
} from "./authority";

/**
 * Board `7b` — the rule, as a function. Every case the rule card has a
 * sentence for has a test here, and the board's own row is the first one.
 */

const RAMI: Seat = { userId: "rami", role: "company_admin", monthlyLimitFils: null, usedFils: 0n };
const PRIYA: Seat = { userId: "priya", role: "procurement", monthlyLimitFils: aedToFils(25_000), usedFils: aedToFils(12_400) };
const JOSEPH: Seat = { userId: "joseph", role: "requester", monthlyLimitFils: null, usedFils: 0n };

const RULE: ApprovalPolicy = { thresholdFils: aedToFils(25_000), approverId: "rami", unverifiedNeedsApproval: false };
const NO_RULE: ApprovalPolicy = { thresholdFils: null, approverId: null, unverifiedNeedsApproval: false };

const ask = (aed: number | null, supplierVerified = true) => ({
  valueFils: aed === null ? null : BigInt(Math.round(aed * 100)),
  supplierVerified,
});

describe("the board's row", () => {
  it("holds AED 15,624 raised by Priya because it is beyond what is left of her month, not over the threshold", () => {
    const need = approvalNeed(RULE, PRIYA, ask(15_624));
    expect(need).toEqual({ required: true, reasons: ["over_limit"], route: { kind: "authority" } });
    // Rami covers it; Priya never approves her own.
    expect(mayApprove(need.required ? need.route : { kind: "admin" }, RAMI, "priya", ask(15_624).valueFils)).toBe(true);
    expect(mayApprove(need.required ? need.route : { kind: "admin" }, PRIYA, "priya", ask(15_624).valueFils)).toBe(false);
  });

  it("lets the same quote through when her month has room", () => {
    expect(approvalNeed(RULE, { ...PRIYA, usedFils: 0n }, ask(15_624))).toEqual({ required: false });
  });
});

describe("the threshold", () => {
  it("sends anything over it to the named approver and only them", () => {
    const need = approvalNeed(RULE, { ...PRIYA, monthlyLimitFils: aedToFils(100_000), usedFils: 0n }, ask(30_000));
    expect(need).toEqual({ required: true, reasons: ["over_threshold"], route: { kind: "named", approverId: "rami" } });
    const second = { ...RAMI, userId: "second" };
    expect(eligibleApprovers(need.required ? need.route : { kind: "admin" }, [RAMI, second, PRIYA], "priya", ask(30_000).valueFils).map((s) => s.userId)).toEqual(["rami"]);
  });

  it("treats exactly the threshold as inside it", () => {
    expect(approvalNeed(RULE, RAMI, ask(25_000))).toEqual({ required: false });
  });

  it("will not let the named approver approve their own: another admin, or nobody", () => {
    const need = approvalNeed(RULE, RAMI, ask(30_000));
    expect(need).toEqual({ required: true, reasons: ["over_threshold"], route: { kind: "admin" } });
    const route = need.required ? need.route : { kind: "admin" as const };
    expect(eligibleApprovers(route, [RAMI, PRIYA], "rami", ask(30_000).valueFils)).toEqual([]);
    expect(approverHasNoCover(RULE, [RAMI, PRIYA])).toBe(true);
    expect(approverHasNoCover(RULE, [RAMI, { ...RAMI, userId: "second" }])).toBe(false);
  });

  it("reads a null approver as any admin but the raiser", () => {
    const need = approvalNeed({ ...RULE, approverId: null }, { ...PRIYA, usedFils: 0n, monthlyLimitFils: aedToFils(99_999) }, ask(30_000));
    expect(need).toMatchObject({ required: true, route: { kind: "admin" } });
  });
});

describe("requesters", () => {
  it("send everything for approval, which anyone whose authority covers it may give", () => {
    const need = approvalNeed(NO_RULE, JOSEPH, ask(5_000));
    expect(need).toEqual({ required: true, reasons: ["no_authority"], route: { kind: "authority" } });
    const route = need.required ? need.route : { kind: "admin" as const };
    expect(eligibleApprovers(route, [RAMI, PRIYA, JOSEPH], "joseph", ask(5_000).valueFils).map((s) => s.userId)).toEqual([
      "rami",
      "priya",
    ]);
    // Beyond what Priya has left, only Rami.
    expect(eligibleApprovers(route, [RAMI, PRIYA, JOSEPH], "joseph", ask(20_000).valueFils).map((s) => s.userId)).toEqual(["rami"]);
  });
});

describe("a quote with no single total", () => {
  it("counts as over every limit — procurement cannot show it is inside theirs", () => {
    expect(approvalNeed(NO_RULE, { ...PRIYA, usedFils: 0n }, ask(null))).toEqual({
      required: true,
      reasons: ["no_total"],
      route: { kind: "admin" },
    });
  });

  it("is an admin's to commit when no threshold is set, and the named approver's when one is", () => {
    expect(approvalNeed(NO_RULE, RAMI, ask(null))).toEqual({ required: false });
    const withRule = approvalNeed(RULE, { ...RAMI, userId: "second" }, ask(null));
    expect(withRule).toEqual({ required: true, reasons: ["no_total"], route: { kind: "named", approverId: "rami" } });
  });
});

describe("unverified suppliers", () => {
  it("need the approver at any value when the company asks, and never otherwise", () => {
    const policy = { ...NO_RULE, approverId: "rami", unverifiedNeedsApproval: true };
    expect(approvalNeed(policy, { ...RAMI, userId: "second" }, ask(100, false))).toEqual({
      required: true,
      reasons: ["unverified_supplier"],
      route: { kind: "named", approverId: "rami" },
    });
    expect(approvalNeed(NO_RULE, RAMI, ask(100, false))).toEqual({ required: false });
  });

  it("lists every reason that holds, in one order", () => {
    const policy = { ...RULE, unverifiedNeedsApproval: true };
    const need = approvalNeed(policy, JOSEPH, ask(40_000, false));
    expect(need).toMatchObject({ reasons: ["over_threshold", "no_authority", "unverified_supplier"] });
  });
});

describe("authority", () => {
  it("is unlimited for an admin, the month's remainder for procurement, nothing for a requester", () => {
    expect(remainingFils(RAMI)).toBeNull();
    expect(remainingFils(PRIYA)).toBe(aedToFils(12_600));
    expect(remainingFils({ ...PRIYA, usedFils: aedToFils(30_000) })).toBe(0n);
    expect(remainingFils(JOSEPH)).toBe(0n);
    expect(authorityCovers(RAMI, null)).toBe(true);
    expect(authorityCovers(PRIYA, null)).toBe(false);
  });
});
