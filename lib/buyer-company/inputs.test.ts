import { describe, expect, it } from "vitest";
import { parseSnapshot, readAddress, readClock, snapshotOf } from "./address";
import { changedDetails, readDetails } from "./details";
import { inviteState, readInvite, readSeatTerms, readThreshold } from "./team";

/** Board `7b` — what the forms post, read into what the rows hold. */

describe("company details", () => {
  it("keeps a TRN as fifteen digits and refuses a fourteenth", () => {
    expect(readDetails({ name: " Marina  Facilities ", trn: "100-4482-1690-0003", licenceNumber: "ded-772104", accountsEmail: " Accounts@Marina.AE " })).toEqual({
      ok: true,
      value: { name: "Marina Facilities", trn: "100448216900003", licenceNumber: "DED-772104", accountsEmail: "accounts@marina.ae" },
    });
    expect(readDetails({ name: "M", trn: "10044821690003" })).toEqual({ ok: false, errors: { trn: "invalid" } });
    expect(readDetails({ name: "", accountsEmail: "accounts" })).toEqual({
      ok: false,
      errors: { name: "required", accountsEmail: "invalid" },
    });
  });

  it("names the fields that changed", () => {
    const before = { name: "A", trn: null, licenceNumber: null, accountsEmail: null };
    expect(changedDetails(before, { ...before, trn: "100448216900003" })).toEqual(["trn"]);
  });
});

describe("addresses", () => {
  it("reads access hours as minutes and refuses a window that ends first", () => {
    expect(readClock("07:00")).toBe(420);
    expect(readClock("24:00")).toBe(1440);
    expect(readClock("24:30")).toBe("invalid");
    expect(readClock("")).toBeNull();
    expect(
      readAddress({ label: "Site", addressLine: "JLT", emirate: "dubai", accessFrom: "12:00", accessUntil: "11:00" }),
    ).toMatchObject({ ok: false, errors: { accessUntil: "window_order" } });
  });

  it("refuses a phone that is not a UAE number, and an emirate that is not one", () => {
    expect(readAddress({ label: "Site", addressLine: "JLT", emirate: "qatar", attnPhone: "12" })).toMatchObject({
      ok: false,
      errors: { emirate: "invalid", attnPhone: "invalid" },
    });
  });

  it("snapshots and reads back, and refuses anything that is not a snapshot", () => {
    const read = readAddress({ label: "Site store", addressLine: "JLT Cluster D", emirate: "dubai", accessUntil: "11:00", loadLimit: "small_parcels", attnPhone: "050 220 1188" });
    if (!read.ok) throw new Error("fixture");
    const snapshot = snapshotOf(read.value, "Jumeirah Lake Towers");
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
    expect(snapshot.attnPhone).toBe("+971502201188");
    expect(parseSnapshot({ v: 2, label: "x" })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
  });
});

describe("seats and invitations", () => {
  it("requires a limit for procurement and takes it however it is typed", () => {
    expect(readSeatTerms({ role: "procurement", monthlyLimitAed: "AED 25,000" })).toEqual({
      ok: true,
      value: { role: "procurement", monthlyLimitAed: 25_000 },
    });
    expect(readSeatTerms({ role: "procurement" })).toEqual({ ok: false, errors: { monthlyLimitAed: "required" } });
    // A number typed against an admin means nothing and is not kept.
    expect(readSeatTerms({ role: "company_admin", monthlyLimitAed: "5000" })).toEqual({
      ok: true,
      value: { role: "company_admin", monthlyLimitAed: null },
    });
    expect(readSeatTerms({ role: "finance" })).toEqual({ ok: false, errors: { role: "invalid" } });
  });

  it("needs a person's name and a work email", () => {
    expect(readInvite({ fullName: "", email: "not-an-email", role: "requester" })).toEqual({
      ok: false,
      errors: { fullName: "required", email: "invalid" },
    });
  });

  it("is invited until it expires, whatever the page thought", () => {
    const at = new Date("2026-09-19T08:00:00Z");
    expect(inviteState({ expiresAt: new Date(at.getTime() + 1), acceptedAt: null, revokedAt: null }, at)).toBe("invited");
    expect(inviteState({ expiresAt: at, acceptedAt: null, revokedAt: null }, at)).toBe("expired");
    expect(inviteState({ expiresAt: at, acceptedAt: at, revokedAt: null }, at)).toBe("accepted");
  });

  it("reads a threshold in whole dirhams, empty as none", () => {
    expect(readThreshold("25,000")).toEqual({ ok: true, value: 25_000 });
    expect(readThreshold("")).toEqual({ ok: true, value: null });
    expect(readThreshold("25000.50")).toEqual({ ok: false, error: "invalid" });
  });
});
