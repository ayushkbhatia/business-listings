import { describe, expect, it } from "vitest";
import { describeVerdict, detectOffPlatform } from "./off-platform";

/**
 * Both directions matter, and the second one more.
 *
 * A detector that catches every IBAN and also flags every TRN, phone number
 * and letter of credit trains sellers to ignore the warning, and a queue that
 * is mostly no-action is a queue nobody reads.
 */
const BEFORE = { contactReleased: false };
const AFTER = { contactReleased: true };

describe("what it catches", () => {
  it("a UAE IBAN", () => {
    const verdict = detectOffPlatform(
      "Please transfer the 50% advance to AE070331234567890123456 and we will release the stock.",
      BEFORE,
    );
    expect(verdict.report).toBe(true);
    expect(verdict.signals.map((s) => s.kind)).toContain("iban");
  });

  it("an IBAN pasted in groups of four, which is how a bank prints it", () => {
    const verdict = detectOffPlatform("AE07 0331 2345 6789 0123 456", BEFORE);
    expect(verdict.signals.map((s) => s.kind)).toContain("iban");
  });

  it("an account number, however it is abbreviated", () => {
    for (const body of [
      "Our account number is 1234567890123",
      "a/c no. 1234567890123",
      "Acct #: 1234 5678 9012",
    ]) {
      expect(detectOffPlatform(body, BEFORE).report, body).toBe(true);
    }
  });

  it("an instruction to move money", () => {
    for (const body of [
      "Transfer the amount to our Emirates NBD account and send the slip.",
      "Please wire the balance to us before Thursday.",
      "TT to be arranged this week.",
    ]) {
      expect(detectOffPlatform(body, BEFORE).report, body).toBe(true);
    }
  });

  it("crypto, which is not hypothetical in Dubai trade", () => {
    const verdict = detectOffPlatform("We can take USDT if that is easier for you.", BEFORE);
    expect(verdict.signals.map((s) => s.kind)).toContain("crypto_wallet");
  });

  it("steering the relationship off the record, even after acceptance", () => {
    // Disintermediation is wrong whenever it happens, so this one ignores the
    // context that softens the money signals.
    for (const body of [
      "Next time just deal directly with us, no need to use the platform.",
      "You can WhatsApp me directly for the next order.",
      "Let us do this one outside the platform.",
    ]) {
      expect(detectOffPlatform(body, AFTER).report, body).toBe(true);
    }
  });
});

describe("what it must not catch", () => {
  it("a TRN, which is fifteen digits and on every invoice in the country", () => {
    for (const body of [
      "Our TRN is 100487213600003, please put it on the PO.",
      "TRN 100487213600003",
      "100487213600003",
    ]) {
      expect(detectOffPlatform(body, BEFORE).report, body).toBe(false);
    }
  });

  it("a phone number", () => {
    for (const body of [
      "Call me on +971 50 641 2288 if the drawing changes.",
      "0506412288 is the site number.",
      "Reach the yard on +971 4 391 7937.",
    ]) {
      expect(detectOffPlatform(body, BEFORE).report, body).toBe(false);
    }
  });

  it("ordinary payment terms, which are the vocabulary of the trade", () => {
    for (const body of [
      "We can do 30 days from invoice for a repeat customer.",
      "Payment terms: 50% advance, balance on delivery.",
      "Are you able to work against a letter of credit?",
      "We would need a bank guarantee for an order this size.",
    ]) {
      expect(detectOffPlatform(body, BEFORE).report, body).toBe(false);
    }
  });

  it("our own references, which contain digits and dashes", () => {
    expect(detectOffPlatform("Against ENQ-8841 and QT-8841-R2, see INV-2601.", BEFORE).report).toBe(false);
  });

  it("an ordinary quantity or price", () => {
    expect(detectOffPlatform("24 off at 398.00 each, 8 off at 712.00.", BEFORE).report).toBe(false);
  });

  it("nothing at all", () => {
    expect(detectOffPlatform("Can you bring the DN150 lead time inside two weeks?", BEFORE)).toEqual({
      signals: [],
      report: false,
      flag: false,
    });
  });
});

describe("before and after acceptance", () => {
  const INVOICE = "Invoice attached. Our account is AE070331234567890123456, 30 days as agreed.";

  it("reports bank details sent before the buyer has chosen this supplier", () => {
    // Somebody being asked to pay for something they have not agreed to, by a
    // party they have no record with. This is the case where somebody gets hurt.
    expect(detectOffPlatform(INVOICE, BEFORE).report).toBe(true);
  });

  it("does not report the same details after acceptance, because that is an invoice", () => {
    // Payment is always off-platform here. Reporting every invoice would make
    // the queue useless.
    expect(detectOffPlatform(INVOICE, AFTER).report).toBe(false);
  });

  it("still marks it on the record, because everything stays on the record", () => {
    expect(detectOffPlatform(INVOICE, AFTER).flag).toBe(true);
  });
});

describe("describeVerdict", () => {
  it("names what matched and quotes the message", () => {
    const body = "Transfer the advance to AE070331234567890123456 today.";
    const detail = describeVerdict(detectOffPlatform(body, BEFORE), body);
    expect(detail).toContain("iban");
    expect(detail).toContain(body);
  });

  it("trims a long message rather than filling the queue with it", () => {
    const body = `Please pay to AE070331234567890123456. ${"x".repeat(900)}`;
    const detail = describeVerdict(detectOffPlatform(body, BEFORE), body);
    expect(detail.length).toBeLessThan(500);
    expect(detail).toContain("…");
  });
});
