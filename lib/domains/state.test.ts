import { describe, expect, it } from "vitest";
import {
  checkHostname,
  domainState,
  GIVE_UP_AFTER_HOURS,
  recordsFor,
  VERIFY_PREFIX,
  type RecordCheck,
} from "./state";

/**
 * Criterion 8, in the pure.
 *
 * Four clauses, and the second is the one that decides whether the flow is
 * usable at all: partial propagation must not read as failure.
 */

const OURS = "businesslistings.me";
const check = (cname: RecordCheck["cname"], txt: RecordCheck["txt"]): RecordCheck => ({
  cname,
  txt,
});

describe("the four states before it is live", () => {
  it("is pending while neither record has appeared", () => {
    expect(domainState(check("waiting", "waiting"), 0.2, false)).toEqual({ status: "pending" });
  });

  it("is partial when one is up and one is not, and that is not a failure", () => {
    /*
     * The load-bearing case. DNS propagates unevenly and a seller who added
     * both records at once will often see one resolve minutes before the
     * other. A screen showing that as an error sends them back to undo work
     * that was correct.
     */
    expect(domainState(check("found", "waiting"), 1, false)).toEqual({ status: "partial" });
    expect(domainState(check("waiting", "found"), 6, false)).toEqual({ status: "partial" });
  });

  it("is verified only when both are up", () => {
    expect(domainState(check("found", "found"), 0.1, false)).toEqual({ status: "verified" });
  });

  it("waits a full day before it says anything is wrong", () => {
    const nearly = GIVE_UP_AFTER_HOURS - 0.01;
    expect(domainState(check("found", "waiting"), nearly, false).status).toBe("partial");
    expect(domainState(check("found", "waiting"), GIVE_UP_AFTER_HOURS, false).status).toBe("failed");
  });
});

describe("naming the likely cause", () => {
  it("says which record is missing rather than that DNS failed", () => {
    // Every one of these names something somebody can change at a registrar.
    expect(domainState(check("found", "waiting"), 30, false).cause).toBe("cname_only");
    expect(domainState(check("waiting", "found"), 30, false).cause).toBe("txt_only");
    expect(domainState(check("waiting", "waiting"), 30, false).cause).toBe("no_records_at_all");
  });

  it("tells a record that is there but wrong from one that is missing", () => {
    expect(domainState(check("wrong_value", "found"), 30, false).cause).toBe(
      "cname_points_elsewhere",
    );
    expect(domainState(check("found", "wrong_value"), 30, false).cause).toBe("txt_value_stale");
  });
});

describe("a domain that stopped resolving after it was live", () => {
  it("is revoked, not failed", () => {
    /*
     * The seller did the setup correctly once. Telling them it is wrong sends
     * them to check something that is not the problem — somebody changed their
     * DNS, possibly by accident, possibly because they moved registrar.
     */
    expect(domainState(check("waiting", "waiting"), 900, true)).toEqual({ status: "revoked" });
    expect(domainState(check("found", "waiting"), 900, true)).toEqual({ status: "revoked" });
  });

  it("goes straight back to verified when the records come back", () => {
    expect(domainState(check("found", "found"), 900, true)).toEqual({ status: "verified" });
  });

  it("is never failed once it has been verified, however long it has been", () => {
    for (const hours of [0, 1, GIVE_UP_AFTER_HOURS, 10_000]) {
      expect(domainState(check("waiting", "waiting"), hours, true).status).not.toBe("failed");
    }
  });
});

describe("the records a seller is given", () => {
  it("uses the label, not the whole hostname", () => {
    /*
     * The single most common way this goes wrong: a seller pastes
     * `shop.alwaha.ae` into a registrar field that wants `shop`, and ends up
     * with `shop.alwaha.ae.alwaha.ae`.
     */
    const records = recordsFor("shop.alwaha.ae", "abc123", "stores.businesslistings.me");
    expect(records[0]).toEqual({
      type: "CNAME",
      name: "shop",
      value: "stores.businesslistings.me",
    });
    expect(records[1]).toEqual({
      type: "TXT",
      name: `${VERIFY_PREFIX}.shop`,
      value: "bl-verify=abc123",
    });
  });
});

describe("what may be pointed at us", () => {
  it("refuses an apex domain, because a CNAME is illegal at a zone apex", () => {
    /*
     * Not fussiness. SOA and NS live at the apex and a CNAME cannot coexist
     * with them. Some registrars offer ALIAS records that work around it and
     * many do not, so accepting an apex would be a flow that succeeds or fails
     * depending on who the seller bought their domain from.
     */
    expect(checkHostname("alwaha.ae", OURS)).toBe("apex_domain");
    expect(checkHostname("shop.alwaha.ae", OURS)).toBeNull();
  });

  it("refuses our own domain", () => {
    expect(checkHostname("stores.businesslistings.me", OURS)).toBe("our_own_domain");
    expect(checkHostname("businesslistings.me", OURS)).toBe("our_own_domain");
  });

  it("refuses things that are not hostnames", () => {
    for (const input of ["", "not a domain", "http://shop.alwaha.ae", "shop.alwaha.ae/path", "-x.alwaha.ae"]) {
      expect(checkHostname(input, OURS), input).toBe("not_a_hostname");
    }
  });

  it("takes a trailing dot and mixed case, because people paste both", () => {
    expect(checkHostname("Shop.AlWaha.ae.", OURS)).toBeNull();
  });
});
