import { describe, expect, it } from "vitest";
import { t } from "@/lib/i18n";
import {
  addMonths,
  canReverse,
  closureState,
  COOLING_OFF_DAYS,
  DOCUMENT_RETENTION_MONTHS,
  documentsDeletableAt,
  INVOICE_RETENTION_YEARS,
  hashReversalToken,
  looksLikeReversalToken,
  newReversalToken,
  ownerClosureDates,
  platformClosureDates,
  type ClosureFacts,
} from "./policy";

/**
 * Board `11i`'s dates and states, without a database.
 *
 * Every question here is one a seller asks with their listing already down:
 * can I still get it back, and until when.
 */

const NOW = new Date("2026-09-14T08:00:00.000Z");
const DAY = 86_400_000;

function owner(over: Partial<ClosureFacts> = {}): ClosureFacts {
  const { effectiveAt, finalAt } = ownerClosureDates(NOW);
  return {
    initiator: "owner",
    effectiveAt,
    appliedAt: NOW,
    finalAt,
    reversedAt: null,
    finalisedAt: null,
    ...over,
  };
}

describe("the window", () => {
  it("runs fourteen days from the request for an owner closure", () => {
    const { effectiveAt, finalAt } = ownerClosureDates(NOW);
    expect(effectiveAt).toEqual(NOW);
    expect(finalAt.getTime() - NOW.getTime()).toBe(COOLING_OFF_DAYS * DAY);
  });

  it("starts when a platform closure takes effect, not when notice was given", () => {
    // The same fourteen days to reverse, however the closure began.
    const { effectiveAt, finalAt } = platformClosureDates(NOW);
    expect(effectiveAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(finalAt.getTime() - effectiveAt.getTime()).toBe(COOLING_OFF_DAYS * DAY);
  });
});

describe("closureState", () => {
  it("is requested while the window is open", () => {
    expect(closureState(owner(), new Date(NOW.getTime() + DAY))).toBe("requested");
    expect(canReverse(owner(), new Date(NOW.getTime() + DAY))).toBe(true);
  });

  it("is due, not final, once the window has passed and the job has not run", () => {
    /*
       The reader must not offer a reversal the service is about to refuse, and
       must not call it final before the row says so.
    */
    const after = new Date(owner().finalAt.getTime() + 1);
    expect(closureState(owner(), after)).toBe("due");
    expect(canReverse(owner(), after)).toBe(false);
  });

  it("refuses at the exact final instant, not one millisecond later", () => {
    expect(canReverse(owner(), owner().finalAt)).toBe(false);
  });

  it("is final once finalised, and reversed once reversed", () => {
    expect(closureState(owner({ finalisedAt: NOW }), NOW)).toBe("final");
    expect(closureState(owner({ reversedAt: NOW }), NOW)).toBe("reversed");
  });

  it("is noticed while a platform notice runs, and pending once it has run out unapplied", () => {
    const { effectiveAt, finalAt } = platformClosureDates(NOW);
    const facts: ClosureFacts = {
      initiator: "platform",
      effectiveAt,
      appliedAt: null,
      finalAt,
      reversedAt: null,
      finalisedAt: null,
    };
    expect(closureState(facts, NOW)).toBe("noticed");
    expect(closureState(facts, effectiveAt)).toBe("pending");
  });
});

describe("addMonths", () => {
  it("clamps to the end of a shorter month rather than rolling into the next", () => {
    // 31 January plus one month is 28 February, not 3 March. A retention date
    // that lands late is a document held longer than the policy says.
    expect(addMonths(new Date("2027-01-31T00:00:00Z"), 1).toISOString()).toBe(
      "2027-02-28T00:00:00.000Z",
    );
  });

  it("puts document deletion twelve months after finalisation", () => {
    expect(documentsDeletableAt(new Date("2026-09-28T00:00:00Z")).toISOString()).toBe(
      "2027-09-28T00:00:00.000Z",
    );
  });
});

describe("the published retention period", () => {
  it("is the number Privacy §07 prints for verification documents", () => {
    /*
       The constant is not ours to choose. If the policy page changes the
       number, the purge must change with it — and if somebody edits the
       constant, the page it contradicts is named here.
    */
    const printed = t("legal.privacy.07.r4.how_long");
    expect(printed).toContain(`${DOCUMENT_RETENTION_MONTHS} months`);
  });

  it("keeps invoices for the period Privacy §07 prints for tax records", () => {
    expect(t("legal.privacy.07.r5.how_long")).toContain(`${INVOICE_RETENTION_YEARS} years`);
  });
});

describe("the reversal token", () => {
  it("is stored only as a hash, and the hash is stable", () => {
    const { token, hash } = newReversalToken();
    expect(hash).not.toContain(token);
    expect(hashReversalToken(token)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recognises its own shape and refuses a mangled link", () => {
    const { token } = newReversalToken();
    expect(looksLikeReversalToken(token)).toBe(true);
    expect(looksLikeReversalToken(`${token.slice(0, 20)}`)).toBe(false);
    expect(looksLikeReversalToken(`${token.slice(0, 42)}=`)).toBe(false);
  });
});
