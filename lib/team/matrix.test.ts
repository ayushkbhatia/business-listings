import { describe, expect, it } from "vitest";
import { can } from "@/lib/auth/can";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { holds, MATRIX_ROLES, MATRIX_ROWS } from "./matrix";
import { en } from "@/lib/i18n/en";

/**
 * Board 7d §2 — the matrix a seller reads must be the matrix the product
 * enforces.
 *
 * This is the only rendering of `docs/permissions.md` §2 a seller ever sees, so
 * it is the copy that must not drift. The tests below are all one assertion in
 * different clothes: nothing on that screen may be a second opinion about a
 * permission.
 */

describe("the rendered capability matrix", () => {
  it("puts every tick through the same predicate the guards use", () => {
    for (const row of MATRIX_ROWS) {
      for (const role of MATRIX_ROLES) {
        expect(
          holds(role, row.capability),
          `${row.key} × ${role}`,
        ).toBe(can({ id: "u", roles: [role], businessId: "b" }, row.capability));
      }
    }
  });

  it("names a capability that exists for every row", () => {
    for (const row of MATRIX_ROWS) {
      expect(Object.hasOwn(CAPABILITIES, row.capability), row.key).toBe(true);
    }
  });

  it("has a string for every row, so the screen cannot render a key", () => {
    /*
       `t()` throws outside production on an unknown key, so a row added here
       without its copy takes the whole screen down in development and prints
       the key in front of a seller in production. Both are worse than this
       failing.
    */
    for (const row of MATRIX_ROWS) {
      expect(Object.hasOwn(en, `team.can.${row.key}`), row.key).toBe(true);
    }
    for (const role of MATRIX_ROLES) {
      expect(Object.hasOwn(en, `team.role.${role}`), role).toBe(true);
    }
  });

  it("marks exactly the rows a role grant does not finish answering", () => {
    /*
       §2: a branch-scoped sales seat is limited to that branch's enquiries. The
       marker is not decoration — an unmarked tick on `enquiry.respond` promises
       Fatima every lead in the business, and `lib/auth/subject.ts` is what
       actually decides.
    */
    for (const row of MATRIX_ROWS) {
      expect(row.scoped, row.key).toBe("subject" in CAPABILITIES[row.capability]);
    }
    expect(MATRIX_ROWS.filter((row) => row.scoped).map((row) => row.key)).toEqual([
      "respond",
      "revise",
      "extend",
      "analytics",
    ]);
  });

  it("gives Finance nothing that reaches the inbox", () => {
    /*
       The sentence the screen prints under the table, asserted rather than
       trusted. 7d §2: "Finance cannot reply to an enquiry or send a quote, so a
       Finance seat is never a routing target" — and `lib/team/reachability.ts`
       decides that by asking this exact question.
    */
    expect(holds("seller_finance", "enquiry.respond")).toBe(false);
    expect(holds("seller_finance", "quote.send")).toBe(false);
  });

  it("covers the four canonical roles and no others", () => {
    // "The four roles are canonical here", and this screen is their only
    // user-facing rendering. A fifth column would be a role nothing grants.
    expect([...MATRIX_ROLES]).toEqual([
      "seller_owner",
      "seller_manager",
      "seller_sales",
      "seller_finance",
    ]);
  });

  it("carries the extend row board 3k shipped the action for", () => {
    // §2: "`Extend a quote's validity` is added because 3k ships the action and
    // the matrix had no row for it." It is `quote.send`, which is what
    // lib/quotes/extend.ts asserts — not a capability invented for a table.
    const extend = MATRIX_ROWS.find((row) => row.key === "extend");
    expect(extend?.capability).toBe("quote.send");
  });
});
