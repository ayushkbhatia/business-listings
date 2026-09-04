import "server-only";
import { prisma } from "@/lib/db/client";
import {
  CATALOGUE_IMPORT_PRICING_KEY,
  FALLBACK_CATALOGUE_PRICING,
  type CatalogueImportPricing,
  type CatalogueImportTerms,
} from "./terms";

/**
 * What a concierge catalogue load costs, and what it promises.
 *
 * The fee is a platform setting rather than a constant, for the reason
 * CLAUDE.md gives twice: every number is a query, and content belongs in the
 * database. A catalogue load is priced work — the first price change is a
 * commercial decision somebody will make on a Tuesday, and it should cost a row
 * rather than a build, a deploy and a cold cache.
 *
 * ## The pattern is `lib/trade/ramadan-calendar.ts`
 *
 * A setting key, a parser that validates **per entry** so one mangled plan
 * costs that plan and not the other two, and a compiled fallback the reader
 * merges over. A missing row on a fresh environment, or a `value` somebody has
 * broken in an admin screen, must not take the seller's setup hub down — it
 * degrades to the prices below, which are the ones the panel was designed
 * around.
 *
 * ## Two files, like the Ramadan calendar
 *
 * The key, the shape and the compiled fallback live in `./terms.ts`, which is
 * pure, and are re-exported here so no caller has to know which half a name is
 * in. The seed writes this row and is a plain `tsx` script — importing anything
 * behind `server-only` throws at module load and takes the seed down before the
 * first row lands. `lib/trade/hours.ts` and `lib/trade/ramadan-calendar.ts` are
 * the same split for the same reason.
 *
 * Nothing here is cached. It is one indexed primary-key read on a page that
 * already issues several, and `unstable_cache` only runs inside a request —
 * which the integration tests that call this are not.
 */

/*
   Re-exported, not redefined. See ./terms.ts for why they live there.
*/
export {
  CATALOGUE_IMPORT_PRICING_KEY,
  FALLBACK_CATALOGUE_PRICING,
  type CatalogueImportPricing,
  type CatalogueImportTerms,
} from "./terms";

/**
 * How many products the panel promises to key in.
 *
 * A promise, so it is enforced where it is read: `conciergeOfferFor` takes the
 * lower of this and the seller's own effective product cap. Promising fifty to
 * a seller whose plan holds ten is the kind of padded number CLAUDE.md's
 * interface-honesty section exists to stop.
 */
export const CONCIERGE_PRODUCT_LIMIT = 50;

/** The service level, in working days. `concierge.sla` says "two". */
export const CONCIERGE_SLA_WORKING_DAYS = 2;

/**
 * Twenty megabytes.
 *
 * Above `MAX_DOCUMENT_BYTES`, deliberately: a licence is two pages and a
 * printed catalogue is two hundred, often scanned. The number is stated on the
 * seller's screen through `concierge.file_hint`, so it has to be the number the
 * server enforces or it is decoration.
 */
export const MAX_CATALOGUE_BYTES = 20 * 1024 * 1024;

/**
 * What we can actually read at the other end.
 *
 * The CSV pair is what `app/(dashboard)/dashboard/products/import/ImportWizard.tsx`
 * already accepts (`.csv,text/csv`); the spreadsheet pair is the rest of what
 * `concierge.file_hint` promises. PDF is the case this whole feature exists
 * for — the price list a supplier has had since 2019 and cannot export.
 */
export const CATALOGUE_MIME_TYPES = [
  "application/pdf",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

/** Extensions, for the browsers that send an empty or wrong `type`. See `checkCatalogueFile`. */
export const CATALOGUE_EXTENSIONS = [".pdf", ".csv", ".xls", ".xlsx"] as const;

/** The `accept` attribute for the file input. Extensions first, so the picker reads them. */
export const CATALOGUE_ACCEPT = [...CATALOGUE_EXTENSIONS, ...CATALOGUE_MIME_TYPES].join(",");

/**
 * A sanity bound, not a price policy.
 *
 * The setting is staff-writable and a fee is frozen onto a seller's row the
 * moment they ask. A stray zero belongs in the parser rather than on somebody's
 * invoice.
 */
const FEE_CEILING = 100_000;

/**
 * `{"basic":{"offered":true,"feeAed":250}}` → terms.
 *
 * Validated per entry rather than wholesale, for the same reason the Ramadan
 * parser is: one bad plan should cost that plan and leave the other two
 * answerable. A `feeAed` that is not a whole non-negative number is dropped
 * rather than coerced — `NaN` reaching `feeAed` would freeze a fee nobody can
 * read back, and a negative one would be a credit this platform does not have.
 */
export function parseCataloguePricing(value: unknown): CatalogueImportPricing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const out: CatalogueImportPricing = {};
  for (const [planId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,40}$/.test(planId)) continue;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;

    const { offered, feeAed } = entry as { offered?: unknown; feeAed?: unknown };
    if (typeof offered !== "boolean") continue;
    if (typeof feeAed !== "number") continue;
    if (!Number.isInteger(feeAed) || feeAed < 0 || feeAed > FEE_CEILING) continue;

    out[planId] = { offered, feeAed };
  }
  return out;
}

/** The platform's terms, over the compiled ones. Never throws. */
export async function readCataloguePricing(): Promise<CatalogueImportPricing> {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { key: CATALOGUE_IMPORT_PRICING_KEY },
      select: { value: true },
    });
    return { ...FALLBACK_CATALOGUE_PRICING, ...parseCataloguePricing(row?.value) };
  } catch (error) {
    /*
       A seller whose setup hub cannot read one settings row still gets a hub.
       Logged rather than swallowed, because a table that has stopped answering
       is worth somebody knowing about.
    */
    console.warn("[catalogue-import] could not read the pricing setting", error);
    return FALLBACK_CATALOGUE_PRICING;
  }
}

/**
 * The terms for one plan.
 *
 * A plan nobody has written terms for is **not offered**. Falling back to a
 * price would be inventing a number and charging somebody for it, which is the
 * one failure mode here that costs a seller money.
 */
export function termsFor(
  pricing: CatalogueImportPricing,
  planId: string | null | undefined,
): CatalogueImportTerms {
  if (!planId) return { offered: false, feeAed: 0 };
  return pricing[planId] ?? { offered: false, feeAed: 0 };
}

const ZONE = "Asia/Dubai";

/**
 * The days nobody is keying anything in.
 *
 * **Friday and Saturday, not Saturday and Sunday.** The federal public sector
 * moved to a Saturday–Sunday weekend in 2022 and the trade sector this
 * directory is built on largely did not: the counters in Deira, the yards in Al
 * Quoz and the industrial areas in Sharjah keep Friday and Saturday, which is
 * why the rest of `lib/trade` treats a week closed Fri–Sat as the ordinary
 * case — see `lib/trade/open-now.test.ts`, where a supplier shut Friday *and*
 * Saturday is the fixture rather than the exception.
 *
 * It matters here because the SLA is a promise the seller reads and then
 * measures us against. Counting Friday as a working day would put a due date on
 * a screen a day before anybody could meet it.
 *
 * If the operations team ever moves to Sat–Sun, this becomes a platform setting
 * beside the pricing above rather than an edit here.
 */
const WEEKEND = new Set(["Fri", "Sat"]);

/** The weekday in Dubai, whatever the host clock is set to. */
function dubaiWeekday(at: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, weekday: "short" }).format(at);
}

/**
 * `days` working days after `from`, skipping the UAE weekend.
 *
 * The time of day is carried through, so a request at four on a Sunday
 * afternoon is due at four on Tuesday rather than at midnight — a deadline that
 * silently moves to the start of the day is a deadline we would miss by a day
 * without anybody having been late.
 */
export function workingDaysFrom(from: Date, days: number): Date {
  const out = new Date(from.getTime());
  let left = Math.max(0, Math.trunc(days));

  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (!WEEKEND.has(dubaiWeekday(out))) left -= 1;
  }
  return out;
}

export type CatalogueFileRefusal = "wrong_type" | "too_big";

export type CatalogueFileCheck = { ok: true } | { ok: false; error: CatalogueFileRefusal };

/**
 * Refuse before the bytes move, not after.
 *
 * The filename is checked as well as the type because the type cannot be
 * trusted for exactly the formats this feature is about: Windows reports a
 * `.csv` as `application/vnd.ms-excel`, some browsers send an empty string for
 * an `.xlsx`, and a seller whose price list is refused for being a spreadsheet
 * has no way to tell what we objected to. Either the declared type or the
 * extension is enough; both being wrong is a file we genuinely cannot read.
 *
 * Size is judged against the ceiling alone. A file the browser reports as zero
 * bytes is a file that was never picked, which the caller answers with
 * `concierge.error.no_file` — telling that seller their catalogue is too large
 * would be the least useful sentence on the screen.
 */
export function checkCatalogueFile(
  type: string,
  bytes: number,
  filename = "",
): CatalogueFileCheck {
  const byType = (CATALOGUE_MIME_TYPES as readonly string[]).includes(type);
  const name = filename.toLowerCase();
  const byExtension = CATALOGUE_EXTENSIONS.some((extension) => name.endsWith(extension));
  if (!byType && !byExtension) return { ok: false, error: "wrong_type" };

  if (Number.isFinite(bytes) && bytes > MAX_CATALOGUE_BYTES) {
    return { ok: false, error: "too_big" };
  }
  return { ok: true };
}
