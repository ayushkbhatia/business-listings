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
 * What to show on the verify screen: enough to recognise, not enough to
 * confirm. `+971 50 ••• ••88` tells the right person they typed their own
 * number and tells anybody else nothing. Uses the same mask character as every
 * other masked value in the product — see lib/format/locale.
 */
export function maskIdentifier(identifier: Identifier): string {
  if (identifier.kind === "email") {
    const [user = "", domain = ""] = identifier.value.split("@");
    const head = user.slice(0, 2);
    return `${head}${MASK_CHAR.repeat(Math.max(1, user.length - 2))}@${domain}`;
  }

  const digits = identifier.value.replace(/^\+/, "");
  const cc = digits.slice(0, 3);
  const operator = digits.slice(3, 5);
  const last = digits.slice(-2);
  const dot = MASK_CHAR;
  return `+${cc} ${operator} ${dot.repeat(3)} ${dot.repeat(2)}${last}`;
}
