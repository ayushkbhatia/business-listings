/**
 * Turning what somebody typed into the thing we throttle and look up by.
 *
 * Pure, because a normalisation bug is a security bug: if `+971 50 641 2288`
 * and `971506412288` normalise differently, the attempt counter counts them
 * separately and the lockout is one retry away from being free.
 */
import { MASK_CHAR } from "@/lib/format/locale";
import { toE164 } from "@/lib/format/phone";

export type IdentifierKind = "phone" | "email";

export interface Identifier {
  kind: IdentifierKind;
  /** E.164 with the plus, or a lowercased trimmed email. */
  value: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Null when it is neither a UAE phone number nor an email address. */
export function normaliseIdentifier(raw: string): Identifier | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return EMAIL.test(email) ? { kind: "email", value: email } : null;
  }

  const phone = toE164(trimmed);
  return phone ? { kind: "phone", value: phone } : null;
}

/**
 * What to show on the verify screen: enough for the right person to recognise
 * the number they typed, and to spot the one they mistyped.
 *
 * Board 7a draws `+971 50 641 ••88` — operator, the next three digits, the last
 * two — and corrected its own render to exactly that, because the first draft
 * masked a colleague's number. Two digits hidden is enough on a screen that only
 * ever shows the number this browser just typed: it is not a lookup, and it
 * reveals nothing the typist did not already hold. Uses the same mask character
 * as every other masked value in the product — see lib/format/locale.
 */
export function maskIdentifier(identifier: Identifier): string {
  if (identifier.kind === "email") {
    const [user = "", domain = ""] = identifier.value.split("@");
    const head = user.slice(0, 2);
    // Capped at six, so the mask does not print the length of the address.
    return `${head}${MASK_CHAR.repeat(Math.min(6, Math.max(1, user.length - 2)))}@${domain}`;
  }

  const digits = identifier.value.replace(/^\+/, "");
  const cc = digits.slice(0, 3);
  const operator = digits.slice(3, 5);
  const middle = digits.slice(5, 8);
  const last = digits.slice(-2);
  return `+${cc} ${operator} ${middle} ${MASK_CHAR.repeat(2)}${last}`;
}
