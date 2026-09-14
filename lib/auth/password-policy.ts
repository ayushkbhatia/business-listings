/**
 * What a password has to be, and how strong the meter says it is.
 *
 * Pure and dependency-free, because both sides of the boundary need the same
 * answer: the meter under the field on board 7a's reset panel reads it as the
 * person types, and `setPasswordFromGrant` reads it again before anything is
 * written. A meter that says "Strong" over a password the server then refuses
 * is a screen that lied.
 *
 * ## Length, not punctuation
 *
 * The rule is twelve characters and nothing about symbols or capitals. Length
 * is what makes a password expensive to guess, and composition rules are what
 * make people write `Password1!` on a sticky note. The few refusals beyond
 * length are for passwords that are long and still worthless: one character
 * repeated, a run along the keyboard or the alphabet, the word "password", or
 * the account's own mobile number or email.
 *
 * ## Seventy-two bytes
 *
 * Supabase stores passwords with bcrypt, which reads the first 72 bytes and
 * ignores the rest. A longer password is not refused by Supabase — it is
 * silently truncated, so two passwords that differ after byte 72 both work.
 * Refusing it here says so instead.
 */

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_BYTES = 72;

/** Four bars, as drawn. Zero lights none. */
export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export type PasswordProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "repeated"
  | "sequence"
  | "common"
  | "contains_identifier";

export interface PasswordAssessment {
  /** Characters as a person counts them, which is what the meter prints. */
  length: number;
  strength: PasswordStrength;
  /** Null when the password may be saved. */
  problem: PasswordProblem | null;
}

const RUNS = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "qwertyuiopasdfghjklzxcvbnm",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
] as const;

/** Words that make a long password short. Compared case-insensitively. */
const COMMON_FRAGMENTS = ["password", "passw0rd", "businesslistings", "letmein", "welcome", "iloveyou"] as const;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** `aaaaaaaaaaaa`, `abababababab` — a short unit repeated to length. */
function isRepeated(value: string): boolean {
  for (let unit = 1; unit <= 3; unit += 1) {
    if (value.length < unit * 4) continue;
    const head = value.slice(0, unit);
    if (head.repeat(Math.ceil(value.length / unit)).slice(0, value.length) === value) return true;
  }
  return false;
}

/** The whole password is a stretch of one run, forwards or backwards. */
function isSequence(value: string): boolean {
  const lower = value.toLowerCase();
  return RUNS.some((run) => {
    const doubled = run + run;
    const reversed = [...doubled].reverse().join("");
    return doubled.includes(lower) || reversed.includes(lower);
  });
}

function characterClasses(value: string): number {
  return [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((re) => re.test(value)).length;
}

/**
 * The fragments of an identifier worth refusing: the local part of an email and
 * the subscriber digits of a mobile. Shorter than four characters is noise.
 */
function identifierFragments(identifiers: readonly string[]): string[] {
  const fragments: string[] = [];
  for (const raw of identifiers) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (value.includes("@")) {
      const local = value.split("@")[0] ?? "";
      if (local.length >= 4) fragments.push(local);
    } else {
      const digits = value.replace(/\D/g, "");
      // The last seven digits are the subscriber number in every UAE mobile.
      if (digits.length >= 7) fragments.push(digits.slice(-7));
    }
  }
  return fragments;
}

export function assessPassword(
  password: string,
  context: { identifiers?: readonly string[] } = {},
): PasswordAssessment {
  const length = [...password].length;

  if (length === 0) return { length, strength: 0, problem: "empty" };
  if (byteLength(password) > MAX_PASSWORD_BYTES) return { length, strength: 0, problem: "too_long" };

  const lower = password.toLowerCase();
  const weak = (problem: PasswordProblem): PasswordAssessment => ({ length, strength: 1, problem });

  if (isRepeated(password)) return weak("repeated");
  if (length >= 6 && isSequence(password)) return weak("sequence");
  if (COMMON_FRAGMENTS.some((word) => lower.includes(word))) return weak("common");
  if (identifierFragments(context.identifiers ?? []).some((f) => lower.includes(f))) {
    return weak("contains_identifier");
  }

  if (length < 8) return { length, strength: 1, problem: "too_short" };
  if (length < MIN_PASSWORD_LENGTH) return { length, strength: 2, problem: "too_short" };

  // Twelve plain characters is the board's "Strong — 12 characters", three bars.
  // The fourth is for length that goes well past the floor, or a floor-length
  // password that is not one kind of character.
  const strength: PasswordStrength = length >= 20 || (length >= 16 && characterClasses(password) >= 2) ? 4 : 3;
  return { length, strength, problem: null };
}
