/**
 * Board 13c `B4` — the reference a reporter is given, and the only thing they
 * are ever given.
 *
 * The board's second correction: *"the reporter is anonymous, so nobody can be
 * told the outcome. No name, no email, no reference number."* An optional email
 * answers half of it — `4h`'s `Q5`, *we looked at what you reported*. This
 * answers the other half, which is the half that works even when somebody
 * declines to leave an address: a string they can quote at us.
 *
 * ## Random, where an enquiry reference is sequential
 *
 * `ENQ-8901` comes from `enquiry_ref_seq`, and that is right for an enquiry:
 * two parties who are already talking need a number they can both say on the
 * phone, and what it leaks — how many enquiries this directory has carried —
 * it leaks to somebody who is already inside one.
 *
 * A report reference is handed to anybody who fills in a public form with no
 * account. A sequence there publishes the size of the moderation queue to the
 * street: file two reports a week apart, subtract, and you know how many
 * complaints a UAE trade directory receives. So it is forty bits of randomness
 * with a unique index behind it, and the caller retries on the astronomically
 * unlikely clash rather than pretending a sequence.
 *
 * ## Crockford's alphabet
 *
 * No `I`, `L`, `O` or `U`. A reference is read off a screen and typed into an
 * email by somebody who is annoyed about a telephone number, and `RP-I0L1` is
 * four characters of trouble. `U` is out of Crockford's set to keep an accident
 * out of the alphabet; the other three are out because they are the digits `1`
 * and `0` wearing hats.
 *
 * Pure but for `newReference`, which is the one line that needs entropy.
 */

import { randomBytes } from "node:crypto";

/** Crockford base32, which is base32 with the ambiguous letters taken out. */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const REFERENCE_PREFIX = "RP-";

/** Eight characters of the alphabet above — forty bits. */
export const REFERENCE_BODY_LENGTH = 8;

const PATTERN = new RegExp(`^${REFERENCE_PREFIX}[${ALPHABET}]{${REFERENCE_BODY_LENGTH}}$`);

/**
 * Bytes to a reference. Pure, so the shape can be tested without a generator.
 *
 * Five bits at a time out of a big-endian bit string, which is what base32 is.
 * At least five bytes are required: forty bits is exactly eight characters, and
 * padding a short input would produce a reference with less entropy than its
 * length claims.
 */
export function formatReference(bytes: Uint8Array): string {
  if (bytes.length * 8 < REFERENCE_BODY_LENGTH * 5) {
    throw new Error("A reference needs at least 40 bits of input");
  }
  let out = "";
  for (let index = 0; index < REFERENCE_BODY_LENGTH; index += 1) {
    const bit = index * 5;
    let value = 0;
    for (let offset = 0; offset < 5; offset += 1) {
      const position = bit + offset;
      const byte = bytes[position >> 3] ?? 0;
      value = (value << 1) | ((byte >> (7 - (position % 8))) & 1);
    }
    out += ALPHABET[value];
  }
  return `${REFERENCE_PREFIX}${out}`;
}

/** One reference. */
export function newReference(): string {
  return formatReference(randomBytes(5));
}

/**
 * True for a string this module could have produced.
 *
 * Case-sensitive on purpose: everything written is upper case, and a lenient
 * reader here would be a second normalisation rule for a column that has an
 * exact unique index on it.
 */
export function isReference(value: string): boolean {
  return PATTERN.test(value);
}

/**
 * What a person typed, as a reference, or null.
 *
 * Trimmed, upper-cased, and the prefix supplied if they left it off — somebody
 * reading `RP-4K2M9XQT` out of an email and typing `4k2m9xqt` into a support
 * form has given us the reference, and refusing it would be refusing to
 * recognise our own number.
 */
export function parseReference(input: string): string | null {
  const bare = input.trim().toUpperCase().replace(/\s+/g, "");
  const candidate = bare.startsWith(REFERENCE_PREFIX) ? bare : `${REFERENCE_PREFIX}${bare}`;
  return isReference(candidate) ? candidate : null;
}
