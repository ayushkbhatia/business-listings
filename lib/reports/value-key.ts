import type { ReportSubjectField } from "./taxonomy";

/**
 * Board 13c `B2` — aggregation is by **value** where a value exists.
 *
 * The board's footer promises *three reports on the same field auto-flag the
 * listing*, and the export's first correction is that a field is the wrong unit
 * to count in. `4h`'s own queue shows what counting actually looks like:
 *
 * > `3 SEPARATE REPORTS · SAME NUMBER ON 4 LISTINGS`
 *
 * That is three people, one telephone number, four different businesses. Count
 * by field and it is three reports about "phone" on one listing and nothing
 * about the other three; count by value and it is one problem with four pages
 * on it. The second is the finding, and the first is bookkeeping.
 *
 * So a report captures the value it is objecting to, normalised, and the queue
 * groups on that. Where the field carries no value — a photograph, the opening
 * hours, the category — there is nothing to normalise and the aggregation falls
 * back to the listing, which is the *"and by listing otherwise"* half of `B2`.
 *
 * ## The value is read from the listing, never from the form
 *
 * `subjectValueKey` is computed server-side from what the listing publishes at
 * the moment the report is filed. A value posted by the reporter would let
 * anybody put a report into any group by typing the group's key, which on a
 * three-report threshold is a way of flagging a competitor from one browser.
 * What the reporter *may* type is the **correction** — what it should say —
 * and that is a separate column that groups nothing.
 *
 * ## Why this file is pure
 *
 * `lib/reports/detectors.ts` normalises a telephone number in SQL
 * (`PHONE_KEY_SQL`) so that its sweep can group in the database. This is the
 * same rule in TypeScript, and the unit test pins the two against each other:
 * a report and a detector finding that disagree about what "the same number"
 * means would sit in two rows saying one thing.
 */

/**
 * The fields whose value is worth counting across listings.
 *
 * Not every field has one. `hours` is a week of times, `photo` is a file,
 * `description` is prose and `category` is a reference to a tree node — none of
 * them is a value two listings can *share* in a way that means anything. A
 * telephone number, a licence number, a trading name and a street address are.
 */
export const VALUED_FIELDS = ["phone", "address", "website", "name", "licence"] as const;

export type ValuedField = (typeof VALUED_FIELDS)[number];

export function isValuedField(field: ReportSubjectField): field is ValuedField {
  return (VALUED_FIELDS as readonly string[]).includes(field);
}

/**
 * A UAE telephone number as its national significant number.
 *
 * `+971 4 227 8890`, `04-2278890` and `00971 4 227 8890` are one landline
 * written three ways, and a directory imported from several licence registers
 * holds all three. Digits only, then the `00` international prefix, the `971`
 * country code and the trunk `0` come off the front, leaving `42278890` — eight
 * digits for a landline, nine for a mobile.
 *
 * Not *the last nine digits*, which is what the shared-number detector used
 * until this board: a landline is eight digits after the trunk zero, so the
 * last nine of `04 227 8890` and of `+971 4 227 8890` differ by their first
 * digit and the two never met.
 *
 * Mirrors `PHONE_KEY_SQL` in `lib/reports/detectors.ts`. The pair is pinned by
 * a test, because the two are the same rule read by two callers.
 */
function phoneKey(value: string): string | null {
  const key = value.replace(/[^0-9]/g, "").replace(/^(00)?(971)?0?/, "");
  return key.length >= 8 ? key : null;
}

/**
 * A host, without the protocol, the `www.` or anything after it.
 *
 * `https://www.Example.ae/contact` and `example.ae` are one website. The path
 * is dropped because two listings pointing at two pages of one site are still
 * one site.
 */
function hostKey(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "") return null;
  const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  const host = withoutScheme.split(/[/?#]/)[0] ?? "";
  const bare = host.replace(/^www\./, "").replace(/:\d+$/, "");
  return bare.includes(".") ? bare : null;
}

/**
 * Letters and digits, lower case, everything else gone.
 *
 * `Deira Bearing House L.L.C.` and `deira bearing house llc` are one company,
 * and `Shop 4, Naif Road` and `shop 4 naif road` are one unit. Aggressive on
 * purpose: this key exists to bring two records together, and the cost of
 * bringing two that differ only in punctuation together is nothing, while the
 * cost of missing them is the whole point of the column.
 *
 * A key shorter than four characters is refused. `LLC` normalises to three
 * letters that half the directory shares, and a group everything joins is not
 * a finding.
 */
function textKey(value: string): string | null {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return key.length >= 4 ? key : null;
}

/**
 * A licence number as the register writes it, without the separators.
 *
 * `CN-1234567` and `CN1234567` are one licence. Upper case, because the
 * authorities print them that way and the key is read by a person on `4h`'s
 * detail screen as often as by a query.
 */
function licenceKey(value: string): string | null {
  const key = value.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return key.length >= 4 ? key : null;
}

/**
 * The key two reports share when they are about the same value, or null when
 * this field's value cannot be counted.
 *
 * Null rather than a throw for an unknown field: the column is nullable and a
 * report about a photograph is a perfectly good report that simply aggregates
 * by listing instead.
 */
export function subjectValueKey(
  field: ReportSubjectField,
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  switch (field) {
    case "phone":
      return phoneKey(value);
    case "website":
      return hostKey(value);
    case "name":
    case "address":
      return textKey(value);
    case "licence":
      return licenceKey(value);
    default:
      return null;
  }
}
