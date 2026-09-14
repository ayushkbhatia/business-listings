import { describe, expect, it } from "vitest";
import { SMS_GSM_LIMIT, SMS_UNICODE_LIMIT, smsLength } from "./sms-length";

/** Board 12g `B8`: 160 characters — while every character is GSM-7. */

describe("an SMS, counted the way a carrier counts it", () => {
  it("fits 160 GSM-7 characters in one segment and refuses 161", () => {
    expect(smsLength("a".repeat(160))).toMatchObject({ units: 160, limit: SMS_GSM_LIMIT, encoding: "gsm7", fits: true });
    expect(smsLength("a".repeat(161)).fits).toBe(false);
  });

  it("counts an extension-table character as two", () => {
    expect(smsLength("€").units).toBe(2);
    expect(smsLength("{ref}").units).toBe(7);
  });

  it("drops to 70 on one character outside GSM-7, and names it", () => {
    const result = smsLength(`New enquiry — ${"a".repeat(60)}`);
    expect(result).toMatchObject({ encoding: "unicode", limit: SMS_UNICODE_LIMIT, fits: false });
    expect(result.offending).toEqual(["—"]);
  });

  it("keeps plain punctuation and newlines in GSM-7", () => {
    expect(smsLength("Quote: https://businesslistings.me/l/ENQ-48213?x=1\nClosing 21 Sep.").encoding).toBe("gsm7");
  });
});
