/**
 * What a step's outcome becomes when it is written down.
 *
 * Pure, so the unit suite reaches it: `lib/jobs/record.ts` is `server-only` and
 * does the writing, and this decides what is written. Two rules, both about the
 * write never being the thing that loses a run:
 *
 *   - **Every value is storable.** A step returns whatever its module returns —
 *     dates, nested objects, now and then a list of slugs. A `bigint`, a cycle
 *     or a 400-item list must not turn into a failed insert, so each is made
 *     into JSON the column accepts, and a result too long to keep is kept as a
 *     summary that says it is one.
 *   - **An error message is safe to show staff.** It is whatever the step threw
 *     — a Prisma invocation, a carrier's reply — and some of those carry an
 *     address, a number or a token. The stored copy masks them; the stack and
 *     the full text stay in the function log, where they always were.
 */

/**
 * The longest error message stored, in characters. The column's CHECK holds
 * the same number, so the writer never makes a row the database refuses.
 */
export const ERROR_TEXT_LIMIT = 2_000;

/** The longest result stored as it came, measured as serialised JSON. */
export const RESULT_TEXT_LIMIT = 8_000;

/** Set on a result that was too long to keep as it came. */
export const SUMMARISED_KEY = "_summarised";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const ELLIPSIS = "…";

/*
   The masks, in order. Each replaces the whole match with a word in brackets,
   so a masked message still reads as a sentence and says what was there.

   Deliberately narrow. A mask that also ate ids and counts would make the
   message useless for the one thing it is kept for, which is telling somebody
   what went wrong without opening the function log.
*/
const MASKS: readonly [RegExp, string][] = [
  // Credentials inside a connection string: `postgres://user:secret@host`.
  [/(\/\/[^:/\s@]+):[^@\s]+@/g, "$1:[secret]@"],
  // A bearer token in a quoted header.
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [secret]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]"],
  // A telephone number in international form, the way every number here is
  // stored: a plus, then eight to fifteen digits, spaced or not.
  [/\+\d(?:[\s-]?\d){7,14}/g, "[phone]"],
];

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - ELLIPSIS.length)}${ELLIPSIS}`;
}

/** The message a failed step stores: masked, trimmed, and never longer than the column allows. */
export function errorText(message: string): string {
  let text = message;
  for (const [pattern, replacement] of MASKS) text = text.replace(pattern, replacement);
  text = text.trim();
  // A step that threw `new Error("")` still failed, and the row still needs a
  // non-empty reason — the column's CHECK asks for one, and so does the reader.
  return truncate(text === "" ? "(no message)" : text, ERROR_TEXT_LIMIT);
}

/** `error.message` where there is one, the value itself where there is not. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A plain JSON copy of `value`, or `undefined` when there is nothing to keep.
 *
 * `JSON.stringify` already turns a `Date` into its ISO string before the
 * replacer sees it. The replacer covers what it would otherwise throw on or
 * drop without a word: a `bigint`, a `Map`, a `Set`, an `Error`.
 */
function toJson(value: unknown): JsonValue | undefined {
  try {
    const text = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === "bigint") return item.toString();
      if (item instanceof Map) return Object.fromEntries(item);
      if (item instanceof Set) return [...item];
      if (item instanceof Error) return { name: item.name, message: item.message };
      return item;
    });
    return text === undefined ? undefined : (JSON.parse(text) as JsonValue);
  } catch {
    // A cycle. The step still succeeded; what it returned cannot be kept.
    return { unserialisable: true };
  }
}

const SUMMARY_DEPTH = 2;
const SUMMARY_STRING = 200;

/** Lists become their length, long strings are cut, and nesting stops two deep. */
function summarise(value: JsonValue, depth: number): JsonValue {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "string") return truncate(value, SUMMARY_STRING);
  if (value === null || typeof value !== "object") return value;
  if (depth >= SUMMARY_DEPTH) return Object.keys(value).length;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, summarise(item, depth + 1)]));
}

/**
 * What a step returned, bounded for the `result` column.
 *
 * Null when the step returned nothing. Kept as it came when it serialises
 * within `RESULT_TEXT_LIMIT`, which every step does today — the largest, the
 * nightly `reportDetectors`, is a few hundred characters. Past the limit it is
 * summarised, with `_summarised` set so the screen can say lists are shown as
 * their length; and past the limit even summarised, it is only that flag and
 * the size, rather than a row the database is asked to hold regardless.
 */
export function boundResult(value: unknown): JsonValue | null {
  const json = toJson(value);
  if (json === undefined || json === null) return null;

  const size = JSON.stringify(json).length;
  if (size <= RESULT_TEXT_LIMIT) return json;

  const summary = summarise(json, 0);
  const wrapped: { [key: string]: JsonValue } =
    summary !== null && typeof summary === "object" && !Array.isArray(summary)
      ? { ...summary, [SUMMARISED_KEY]: true }
      : { value: summary, [SUMMARISED_KEY]: true };
  if (JSON.stringify(wrapped).length <= RESULT_TEXT_LIMIT) return wrapped;

  return { [SUMMARISED_KEY]: true, characters: size };
}

/** True for a result `boundResult` had to summarise. */
export function isSummarised(result: JsonValue | null): boolean {
  return (
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    result[SUMMARISED_KEY] === true
  );
}

/**
 * The `x-vercel-cron-schedule` header, when it is a cron expression.
 *
 * Only Vercel's scheduler sends it, but on a refused call it is anybody's text,
 * so nothing that is not an expression is kept. The column's CHECK holds the
 * same pattern.
 */
export const SCHEDULE_PATTERN = /^[0-9*/, -]{1,64}$/;

export function scheduleHeader(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return SCHEDULE_PATTERN.test(trimmed) ? trimmed : null;
}
