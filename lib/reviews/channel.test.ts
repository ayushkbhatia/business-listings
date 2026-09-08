import { describe, expect, it } from "vitest";
import { requestChannelFor } from "./channel";

/**
 * Board 11c `B2` — the fallback that has to be real.
 *
 * The board named one channel on the send button, for buyers whose contact
 * record may hold only an email. Both columns are nullable and always have
 * been, so the sentence was true of some buyers and silently false of the rest.
 */

const BOTH = new Set(["whatsapp", "email"] as const);
const EMAIL_ONLY = new Set(["email"] as const);
const NONE = new Set([] as ("whatsapp" | "email")[]);

describe("which carrier a review request leaves on", () => {
  it("prefers WhatsApp where we hold a number", () => {
    expect(requestChannelFor({ phone: "+971500000000", email: "a@b.co" }, BOTH)).toBe("whatsapp");
  });

  it("falls back to email where we hold no number", () => {
    expect(requestChannelFor({ phone: null, email: "a@b.co" }, BOTH)).toBe("email");
  });

  it("falls back to email while the WhatsApp template is not live", () => {
    /*
       The half the board could not have known about. Every WhatsApp template in
       this product ships `pending_meta` — Meta approves them and we do not — so
       a matrix that routed on the strength of a phone number alone would find
       no live template and send nothing at all, having told the seller it had.
    */
    expect(requestChannelFor({ phone: "+971500000000", email: "a@b.co" }, EMAIL_ONLY)).toBe(
      "email",
    );
  });

  it("returns null when there is nothing to send on", () => {
    // A real answer, and the panel renders it as one: the buyer is shown with
    // the reason rather than dropped, because a name that quietly disappears
    // from a list headed "8 buyers are eligible" is a count that stops adding up.
    expect(requestChannelFor({ phone: null, email: null }, BOTH)).toBeNull();
    expect(requestChannelFor({ phone: "+971500000000", email: "a@b.co" }, NONE)).toBeNull();
  });
});
