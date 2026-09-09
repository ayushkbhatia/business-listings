import { capFor, type PlanCaps } from "@/lib/plan/entitlements";
import { formatCount, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { formatStorage, keepsOf, type Usage } from "./plan-grid";
import type { KeepKind } from "./schedule";

/**
 * Board 11h — what changes, and on what date.
 *
 * Pure, for the same reason `plan-grid.ts` is: this is twelve rows of
 * arithmetic over the plan-limit config and seven account facts, and it is the
 * screen. Testing it needs no database, and the two acceptance criteria it
 * carries — every date from one period-end value, every `ON FREE` number from
 * the config — are checkable here rather than through a rendered page.
 *
 * ## Every consequence is dated, and nothing happens today
 *
 * The rule the flow runs on. Pro is paid to the last day of the period and runs
 * to it; Free starts the next morning. So the table's third column is headed
 * with a date and every cell in it is a statement about that date, never about
 * now.
 *
 * ## The marks are computed, not written down
 *
 * `unchanged` / `reduced` / `ends` is derived from the two plans and the
 * seller's usage, never from a list of which rows are "the bad ones". A seller
 * with four products is told their products are **unchanged**, because on Free
 * they are — the board's figures are one seller's and the sentence has to hold
 * for every seller. The same goes the other way: if Free ever carried analytics,
 * that row would stop saying `ends` without anybody editing this file.
 *
 * ## Colour is never the carrier
 *
 * Criterion 4, and the board's own correction: three colours with no legend made
 * colour the only cue for the table's meaning. `mark` is a value the screen
 * renders as a distinct shape with a stated key, and the mark is also in each
 * row's accessible text.
 */

/** What happens to one area on the day Free starts. */
export type ConsequenceMark =
  /** Carries over exactly. The licence badge, reviews, invoices. */
  | "unchanged"
  /** Fewer, and the rest is stored rather than deleted. */
  | "reduced"
  /** Stops. An entitlement Free does not carry. */
  | "ends";

export interface ConsequenceRow {
  key: string;
  /** The row header. A real `<th scope="row">` on the screen. */
  area: string;
  /** What it is on the current plan, today. */
  now: string;
  /**
   * The lead of the Free cell, emphasised: `10 stay live`, `0.5 GB`.
   *
   * Split from the rest so the screen can weight it without parsing a sentence
   * for a number, which is how a bold tag ends up around the wrong half of a
   * translated string.
   */
  freeLead: string | null;
  /** The rest of the Free cell. Always present; `freeLead` may not be. */
  free: string;
  mark: ConsequenceMark;
  /**
   * Set where the seller picks which items survive, and null everywhere else.
   *
   * Drives the picker links on the scheduled banner. It is null on a row that
   * is merely `reduced` without being choosable — storage, where there is no
   * list of things to pick between, and enquiries, which is a monthly allowance
   * rather than a set of rows.
   */
  choose: KeepKind | null;
}

/**
 * Everything the table reads. One object, so the page's query and the test's
 * fixture are the same shape.
 */
export interface CancelFacts {
  /** The caps this subscription actually has — snapshot first, then the plan. */
  plan: PlanCaps;
  /** The Free plan's caps, read from the same config. Criterion 3. */
  free: PlanCaps;
  usage: Usage;
  /** The day Free starts. Every date on both screens derives from it. */
  freeStartsOn: Date;
  /** Enquiries the seller received last calendar month. Their own number. */
  enquiriesLastMonth: number;
  /** Whether the licence-verified badge is on the listing today. */
  verified: boolean;
  reviewCount: number;
  /** The verified custom domain, where there is one. */
  domain: string | null;
  /** Where the storefront stays reachable. Never left unstated — a domain that
   *  stops resolving with no replacement named breaks every printed link. */
  storefrontUrl: string;
  /** When the importer was last used, so the row can say it is in use. */
  csvImportLastUsedAt: Date | null;
  /** The running or booked placement, with its own end date. Q1. */
  placement: { label: string; endsOn: Date | null } | null;
}

/**
 * The twelve rows, in the board's order.
 *
 * Order is the board's and it is not alphabetical or grouped by mark: the
 * listing and the badge come first because that is the fear this screen exists
 * to answer, and the two `Unchanged` rows at the bottom are the reassurance the
 * seller reads last.
 */
export function consequenceTable(facts: CancelFacts): ConsequenceRow[] {
  return [
    listingRow(facts),
    ...meterRows(facts),
    enquiriesRow(facts),
    csvImportRow(facts),
    domainRow(facts),
    placementRow(facts),
    analyticsRow(facts),
    reviewsRow(facts),
    invoicesRow(),
  ];
}

/**
 * The listing and the badge, and the answer to the question sellers actually
 * ask.
 *
 * The badge follows the licence, not the plan — board `3e` owns it and
 * `applyEndedCancellations` deliberately does not touch `verificationTier`: it
 * records what we checked, and cancelling a subscription does not un-check it.
 * That is why this is the first row rather than a footnote.
 */
function listingRow(facts: CancelFacts): ConsequenceRow {
  return {
    key: "listing",
    area: t("cancel.row.listing"),
    now: facts.verified ? t("cancel.now.listing_verified") : t("cancel.now.listing"),
    freeLead: null,
    free: facts.verified ? t("cancel.free.listing_verified") : t("cancel.free.listing"),
    mark: "unchanged",
    choose: null,
  };
}

/** Which cap each choosable row is bounded by, and which usage it counts. */
const METERS = [
  { key: "products", metered: "products", choose: "products" },
  { key: "branches", metered: "locations", choose: "locations" },
  { key: "seats", metered: "seats", choose: "seats" },
  { key: "storage", metered: "storage", choose: null },
] as const;

const USED: Record<string, (usage: Usage) => number> = {
  products: (u) => u.products,
  branches: (u) => u.locations,
  seats: (u) => u.seats,
  storage: (u) => u.storageMb,
};

/**
 * Products, branches, seats and storage.
 *
 * `keepsOf` is `plan-grid`'s, unchanged: how many of what the seller has this
 * plan would keep, never the cap on its own. A Free cap of ten against four live
 * products keeps four, and the row then says so rather than telling somebody
 * with four products that ten of them stay.
 */
function meterRows(facts: CancelFacts): ConsequenceRow[] {
  return METERS.map((row) => {
    const used = USED[row.key]?.(facts.usage) ?? 0;
    const keeps = keepsOf(facts.free, row.metered, used);
    const storage = row.key === "storage";
    const shortfall = keeps < used;

    /*
       Nothing stored reads as nothing stored, not as `0 MB used`.

       The general case produces a sentence that is not one for a seller who has
       uploaded nothing, and the row still has to render — an unfilled meter
       stays visible rather than being hidden, so it says what it is.
    */
    const nowLabel = storage
      ? used === 0
        ? t("cancel.now.storage_none")
        : t("cancel.now.storage", { used: formatStorage(used) })
      : t(`cancel.now.${row.key}` as "cancel.now.products", { used: formatCount(used) });

    if (!shortfall) {
      return {
        key: row.key,
        area: t(`cancel.row.${row.key}` as "cancel.row.products"),
        now: nowLabel,
        freeLead: null,
        free: t("cancel.free.holds_all"),
        mark: "unchanged" as const,
        // Nothing to choose between when nothing is dropped, so no picker link
        // — a `Choose` that opens a list where every row is already kept is a
        // control with no decision behind it.
        choose: null,
      };
    }

    /*
       Storage is reduced and is not a choice.

       The other three resolve to rows the seller ticks; a gigabyte does not.
       What actually happens above the cap is `3m` Q4 and is not decided, so the
       cell states the shortfall and says nothing is deleted, which is the part
       that is true either way. See `shortfallsOf` in plan-grid for the same
       argument on the downgrade path.
    */
    if (storage) {
      return {
        key: row.key,
        area: t("cancel.row.storage"),
        now: nowLabel,
        freeLead: formatStorage(keeps),
        free: t("cancel.free.storage", { over: formatStorage(used - keeps) }),
        mark: "reduced" as const,
        choose: null,
      };
    }

    return {
      key: row.key,
      area: t(`cancel.row.${row.key}` as "cancel.row.products"),
      now: nowLabel,
      freeLead: t(`cancel.free.${row.key}_lead` as "cancel.free.products_lead", {
        keeps: formatCount(keeps),
      }),
      free: t(`cancel.free.${row.key}` as "cancel.free.products", {
        rest: formatCount(used - keeps),
      }),
      mark: "reduced" as const,
      choose: row.choose,
    };
  });
}

/**
 * The monthly allowance, and what a buyer sees on the one after it.
 *
 * `86 last month` is the seller's own count from their own account. The Free
 * figure is `capFor`, so the two sides of the row are a measurement and a
 * config value rather than two numbers somebody wrote next to each other.
 *
 * The second half of the Free cell — the buyer-side form closing — is build
 * note `B4`: assumed behaviour rather than specified. It says the honest thing
 * the platform already does, which is that the cap is enforced where the enquiry
 * is created; whether it should instead accept and hold is the open question.
 */
function enquiriesRow(facts: CancelFacts): ConsequenceRow {
  const cap = capFor(facts.free, "enquiries");
  const now =
    capFor(facts.plan, "enquiries") === null
      ? t("cancel.now.enquiries_unlimited", { last: formatCount(facts.enquiriesLastMonth) })
      : t("cancel.now.enquiries", {
          cap: formatCount(capFor(facts.plan, "enquiries") ?? 0),
          last: formatCount(facts.enquiriesLastMonth),
        });

  if (cap === null) {
    return {
      key: "enquiries",
      area: t("cancel.row.enquiries"),
      now,
      freeLead: null,
      free: t("cancel.free.holds_all"),
      mark: "unchanged",
      choose: null,
    };
  }

  return {
    key: "enquiries",
    area: t("cancel.row.enquiries"),
    now,
    freeLead: t("cancel.free.enquiries_lead", { cap: formatCount(cap) }),
    free: t("cancel.free.enquiries"),
    mark: "reduced",
    choose: null,
  };
}

/**
 * One on/off entitlement, stated the same way every time.
 *
 * `absent` on Free is `ends`; carried on Free is `unchanged`. Nothing here knows
 * which entitlements Free "usually" has, so a plan edit moves the table without
 * anybody remembering to.
 */
function entitlementRow(
  key: string,
  carried: boolean,
  now: string,
  free: string,
): ConsequenceRow {
  return {
    key,
    area: t(`cancel.row.${key}` as "cancel.row.analytics"),
    now,
    freeLead: null,
    free: carried ? t("cancel.free.holds_all") : free,
    mark: carried ? "unchanged" : "ends",
    choose: null,
  };
}

/** How the 1,204 products got there, which is why the row cannot be omitted. */
function csvImportRow(facts: CancelFacts): ConsequenceRow {
  return entitlementRow(
    "csv_import",
    facts.free.csvImport,
    facts.csvImportLastUsedAt
      ? t("cancel.now.csv_import_used", { when: formatDate(facts.csvImportLastUsedAt) })
      : t("cancel.now.csv_import"),
    t("cancel.free.csv_import"),
  );
}

/**
 * The domain, and the address it reverts to.
 *
 * Never the first half alone. A domain that stops resolving with no replacement
 * named breaks every printed card and every earned backlink silently, and the
 * seller cannot redirect what they have not been told about.
 */
function domainRow(facts: CancelFacts): ConsequenceRow {
  if (!facts.domain) {
    return {
      key: "custom_domain",
      area: t("cancel.row.custom_domain"),
      now: t("cancel.now.custom_domain_none"),
      freeLead: null,
      free: t("cancel.free.holds_all"),
      // Nothing resolves today, so nothing stops resolving. A row claiming a
      // consequence a seller will not experience is the padding rule again.
      mark: "unchanged",
      choose: null,
    };
  }

  return entitlementRow(
    "custom_domain",
    facts.free.customDomain,
    facts.domain,
    t("cancel.free.custom_domain", { url: facts.storefrontUrl }),
  );
}

/**
 * The placement, which outlasts the subscription under its own term.
 *
 * Q1, four boards deep and still open: the booking has its own dates, its own
 * invoice and its own end, and this row states the booking's date rather than
 * the subscription's. It does not say what happens if the two disagree, because
 * that is exactly the question. `11e` owns the booking and is blocked on `12c`.
 */
function placementRow(facts: CancelFacts): ConsequenceRow {
  if (!facts.placement) {
    return {
      key: "sponsored",
      area: t("cancel.row.sponsored"),
      now: t("cancel.now.sponsored_none"),
      freeLead: null,
      free: t("cancel.free.holds_all"),
      mark: "unchanged",
      choose: null,
    };
  }

  /*
     D2, and the row that used to state both answers at once.

     It said the placement "runs to {when} under its own term" in the Free
     column and stamped the row `ends` — rendered as a red cross with the word
     "Ends" carried in its accessible text. Free is not `sponsoredEligible`, so
     the mark was always `ends`, and the sentence beside it always disagreed.
     A unit test asserted the sentence and asserted the mark for the *absent*
     placement, which is how it shipped.

     The date is `freeStartsOn`, not the slot's own `endsOn`: the subscription's
     end is what ends the slot now, and this file already declares that every
     date on both screens derives from that one.
  */
  return {
    key: "sponsored",
    area: t("cancel.row.sponsored"),
    now: facts.placement.label,
    freeLead: null,
    free: t("cancel.free.sponsored_term", { when: formatDate(facts.freeStartsOn) }),
    mark: facts.free.sponsoredEligible ? "unchanged" : "ends",
    choose: null,
  };
}

/** No access, and the data is kept. The distinction is the whole row. */
function analyticsRow(facts: CancelFacts): ConsequenceRow {
  return entitlementRow(
    "analytics",
    facts.free.analytics,
    t("cancel.now.analytics"),
    t("cancel.free.analytics"),
  );
}

function reviewsRow(facts: CancelFacts): ConsequenceRow {
  return {
    key: "reviews",
    area: t("cancel.row.reviews"),
    // `0 reviews, full history` is the same shape one row up: true, and not a
    // sentence. A seller with none is told so.
    now:
      facts.reviewCount === 0
        ? t("cancel.now.reviews_none")
        : t("cancel.now.reviews", { count: formatCount(facts.reviewCount) }),
    freeLead: null,
    free: t("cancel.free.holds_all"),
    mark: "unchanged",
    choose: null,
  };
}

function invoicesRow(): ConsequenceRow {
  return {
    key: "invoices",
    area: t("cancel.row.invoices"),
    now: t("cancel.now.invoices"),
    freeLead: null,
    free: t("cancel.free.holds_all"),
    mark: "unchanged",
    choose: null,
  };
}

/**
 * The four lines step 2's rail restates, taken from the table rather than
 * written again.
 *
 * The board headed them `WHAT YOU CONFIRMED` above four things the seller had
 * only read. They are now headed with the date, and they are literally the same
 * rows — a rail that derived its own version of the products figure is two
 * surfaces computing one number twice, which is the defect the joint handoff
 * exists to stop.
 */
export function whatChanges(rows: readonly ConsequenceRow[], limit = 4): ConsequenceRow[] {
  return rows.filter((row) => row.mark !== "unchanged").slice(0, limit);
}

/**
 * The last day of the period the seller has paid for.
 *
 * `freeStartsOn` is the renewal moment: the day the next invoice would fall due
 * and the day Free begins. The paid period runs to the day before it, and both
 * screens state that pair — *"paid to 13 September and runs to 13 September.
 * Free starts 14 September."* Deriving one from the other is criterion 1: there
 * is no second date to keep in step.
 */
export function lastPaidDay(freeStartsOn: Date): Date {
  return new Date(freeStartsOn.getTime() - 24 * 60 * 60 * 1000);
}
