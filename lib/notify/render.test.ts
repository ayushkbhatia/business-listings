import { describe, expect, it } from "vitest";
import {
  MissingParamError,
  NotificationLeakError,
  contactShape,
  placeholdersIn,
  render,
} from "./render";

const TEMPLATE = {
  body: "New enquiry {ref} for {summary}. Needed by {neededBy} in {area}. {lineCount} lines.",
  subject: "Enquiry {ref}",
  actionLabel: "Open and quote",
  actionPath: "/dashboard/leads/{enquiryId}/thread",
};

const PARAMS = {
  ref: "ENQ-8841",
  summary: "resilient seated gate valves",
  neededBy: "14 Sep 2026",
  area: "Al Quoz Industrial 1",
  lineCount: 3,
  enquiryId: "cmt73abc",
};

describe("render", () => {
  it("fills every placeholder, in the body, the subject and the link", () => {
    const out = render(TEMPLATE, PARAMS);
    expect(out.body).toBe(
      "New enquiry ENQ-8841 for resilient seated gate valves. Needed by 14 Sep 2026 in Al Quoz Industrial 1. 3 lines.",
    );
    expect(out.subject).toBe("Enquiry ENQ-8841");
    expect(out.actionPath).toBe("/dashboard/leads/cmt73abc/thread");
  });

  it("refuses to send a message with a hole in it", () => {
    // A notification reading "Needed by {neededBy}" looks broken, and looking
    // broken is worse than not arriving.
    const missing = Object.fromEntries(
      Object.entries(PARAMS).filter(([key]) => key !== "neededBy"),
    );
    expect(() => render(TEMPLATE, missing)).toThrow(MissingParamError);
    expect(() => render(TEMPLATE, missing)).toThrow(/\{neededBy\} has no value/);
  });
});

describe("criterion 8 at render time", () => {
  /*
   * The template guard checks that no template *names* a contact placeholder.
   * This is the other half: a safe placeholder filled with an unsafe value.
   */
  it("refuses a phone number smuggled into a safe placeholder", () => {
    for (const area of ["+971 50 641 2288", "00971506412288", "0506412288", "971506412288"]) {
      expect(() => render(TEMPLATE, { ...PARAMS, area }), area).toThrow(NotificationLeakError);
    }
  });

  it("refuses an email address", () => {
    expect(() => render(TEMPLATE, { ...PARAMS, summary: "ask rashid@harbour.example" })).toThrow(
      /looks like a email/,
    );
  });

  it("refuses an IBAN", () => {
    expect(() => render(TEMPLATE, { ...PARAMS, summary: "AE070331234567890123456" })).toThrow(
      /looks like a iban/,
    );
  });

  it("names the placeholder that carried it, so the caller is findable", () => {
    try {
      render(TEMPLATE, { ...PARAMS, area: "+971506412288" });
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationLeakError);
      expect((error as NotificationLeakError).placeholder).toBe("area");
      expect((error as NotificationLeakError).code).toBe("notification_contact_leak");
    }
  });

  it("throws rather than quietly dropping the value", () => {
    // Rendering without the leak would send a message the seller cannot act on
    // and would hide the bug. Failing loudly is the only honest option.
    expect(() => render(TEMPLATE, { ...PARAMS, area: "0506412288" })).toThrow();
  });
});

describe("what must still render", () => {
  it("lets a formatted amount through", () => {
    // The check is tight for exactly this reason: a price has separators.
    expect(contactShape("AED 15,344")).toBeNull();
    expect(contactShape("AED 1,250,000")).toBeNull();
  });

  it("lets our own references through", () => {
    for (const value of ["ENQ-8841", "QT-8841-ALMR1", "INV-2601", "cmt73h5cr007yddit0mrgfx39"]) {
      expect(contactShape(value), value).toBeNull();
    }
  });

  it("lets ordinary trade language through", () => {
    for (const value of [
      "Al Quoz Industrial 1",
      "resilient seated gate valves, DN100 and DN150",
      "14 Sep 2026",
      "3 lines",
      "2 h",
    ]) {
      expect(contactShape(value), value).toBeNull();
    }
  });

  it("lets an identifier through, whatever digits it happens to contain", () => {
    /*
       The defect this replaced, and it refused a real notification.

       A cuid is twenty-five characters of base-36, so one in roughly two
       million contains a run that reads as an international dialling prefix
       followed by a number — `…y0085254929h3`. The guard threw
       `NotificationLeakError: {enquiryId} looks like a phone` and the message
       was never sent. It surfaced as a red `verify` on a docs-only branch,
       which is the only reason it was found at all.

       An id is opaque by construction. Anything the product mints must pass.
    */
    for (const value of [
      "c3bzgrfeeq1hy0085254929h3",
      "cmtx0xzs700ji1ksphxmq0hgp",
      "cmtx0xzsl00k01ksp9uko0fu3",
      "cjld2cjxh0000qzrmn831i7rn",
    ]) {
      expect(contactShape(value), value).toBeNull();
    }
  });

  it("still refuses a dialling prefix that stands on its own", () => {
    // The boundary that fixes the identifier must not blunt the check: a
    // number after a space, a colon or the start of the value still throws.
    for (const value of [
      "00971506412288",
      "Tel: 00971506412288",
      "call 00971 50 641 2288",
      "+971 50 641 2288",
    ]) {
      expect(contactShape(value), value).toBe("phone");
    }
  });

  it("lets a deep link through", () => {
    expect(contactShape("/dashboard/leads/cmt73abc/thread")).toBeNull();
  });
});

describe("placeholdersIn", () => {
  it("finds them across every field, once each", () => {
    expect(placeholdersIn(TEMPLATE).sort()).toEqual([
      "area",
      "enquiryId",
      "lineCount",
      "neededBy",
      "ref",
      "summary",
    ]);
  });
});
