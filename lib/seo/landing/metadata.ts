import "server-only";
import type { Metadata } from "next";
import { formatCount } from "@/lib/format/count";
import { t } from "@/lib/i18n";
import { absoluteUrl } from "@/lib/site";
import type { LandingState } from "./scope";

/**
 * Board 6a §SEO — the head of a landing page.
 *
 * ## The count in the title is the point of the title
 *
 * *"`HVAC & refrigeration companies in Al Quoz, Dubai — 218 listed | Business
 * Listings`. The count is live and it is the reason the title beats a
 * competitor's. Truncate the category name, never the count."*
 *
 * So the count is appended after the truncation, not before it.
 *
 * ## Canonical
 *
 * *"Canonical is self, absolute, with no query string. `?page=2` is
 * self-canonical with `rel=prev`/`next`; a subcategory-filtered view
 * canonicalises to the unfiltered page."*
 *
 * Three rules, and the third is the one open question 5 settles: a subcategory
 * chip filters **in place** rather than opening a fourth page class, so the
 * filtered view is a view of this page and points back at it.
 *
 * ## There is no `noindex` state of this template
 *
 * *"Indexable only when published. There is no `noindex` state of this
 * template; unpublished means no URL."* This function is only ever called for a
 * page that is live, because the route 404s before it gets here — the one
 * exception being a paginated or filtered view, which is served and asked not
 * to be indexed on its own.
 *
 * `hreflang`: none at launch. Open question 4 defers Arabic and the URL shape is
 * unchanged, so there is nothing to retrofit later beyond the pairs themselves.
 */

/**
 * How long a **category name** may be before it is cut.
 *
 * §SEO: *"Truncate the category name, never the count."* Not the subject — the
 * board's own example runs to 79 characters and keeps ", Dubai", because the
 * place is what the reader searched for. What may be cut is a trade whose name
 * runs long, and only that.
 *
 * Titles longer than about 60 characters are shortened in a result, and this
 * one deliberately runs past that: the tail Google drops is the site name the
 * root layout appends, and losing that costs nothing.
 */
const CATEGORY_BUDGET = 34;

export interface LandingMetadataInput {
  state: LandingState;
  /** The page number from the query string, 1 where absent. */
  page: number;
  /** How many pages of results there are. */
  pageCount: number;
  /** A subcategory filter is applied. */
  filtered: boolean;
}

export function landingTitle(state: LandingState): string {
  const { scope } = state;

  /*
     The trade, shortened if it has to be, and nothing else is.

     A word is dropped rather than a character, so a long trade reads as a
     shorter name rather than as one that ran out of room mid-syllable. The
     place and the count survive whatever happens here — the place is what the
     reader typed and the count is why this title beats a competitor's.
  */
  let category = scope.category.name;
  if (category.length > CATEGORY_BUDGET) {
    const words = category.split(" ");
    while (words.length > 1 && words.join(" ").length > CATEGORY_BUDGET) words.pop();
    category = `${words.join(" ")}…`;
  }

  const subject =
    scope.kind === "area"
      ? t("landing.h1_area", {
          category,
          area: scope.area?.name ?? "",
          emirate: t(`emirate.${scope.emirate}` as never),
        })
      : t("landing.h1_emirate", {
          category,
          emirate: t(`emirate.${scope.emirate}` as never),
        });

  return t("landing.title", { subject, listings: formatCount(state.listings) });
}

/**
 * The written sentence, or a derived one.
 *
 * §SEO asks for one written sentence per scope, not a generated one, and the
 * `metaDescription` column is where that lives. The fallback is not a fifth
 * publish condition — a page that clears all four and has no description
 * written yet is a page that should be live with a serviceable sentence rather
 * than dark — but it is a fallback and the matrix says which pages are on it.
 */
export function landingDescription(state: LandingState): string {
  if (state.metaDescription) return state.metaDescription;
  const { scope } = state;
  return t("landing.meta_fallback", {
    listings: formatCount(state.listings),
    category: scope.category.name.toLowerCase(),
    place: scope.area?.name ?? t(`emirate.${scope.emirate}` as never),
    verified: formatCount(state.verified),
  });
}

export function landingMetadata(input: LandingMetadataInput): Metadata {
  const { state, page, pageCount, filtered } = input;
  const { scope } = state;

  const canonical = page > 1 ? `${scope.path}?page=${page}` : scope.path;

  return {
    title: landingTitle(state),
    description: landingDescription(state),
    alternates: {
      /*
         Self, absolute, no query string — except the page number, which names a
         different twenty suppliers and is the only internal path to them. A
         subcategory filter carries no `page` of its own into the canonical,
         because the filtered view canonicalises to the unfiltered page.
      */
      canonical: absoluteUrl(filtered ? scope.path : canonical),
    },
    /*
       A filtered view is a view, not a page: it says nothing the unfiltered
       page does not and it multiplies the URL space by the number of
       subcategories. `follow` stays on — every supplier it links to is worth
       indexing on their own account.
    */
    ...(filtered ? { robots: { index: false, follow: true } } : {}),
  };
}

/**
 * `?page=2`, or the bare path for page 1.
 *
 * Exported because the `rel=prev`/`next` tags are rendered by the page rather
 * than declared here. Next's Metadata API has no slot for a link **relation** —
 * an `other` entry emits `<meta name="link:next">`, which is not the tag §SEO
 * asks for and which no crawler reads. React hoists a `<link>` element rendered
 * anywhere in the tree into the head, so the page emits the real thing.
 *
 * Google stopped treating `rel=next`/`prev` as an indexing signal in 2019 and
 * says so. They stay because every other reader of a paginated set still uses
 * them, and because a page 2 that does not say what it is a page of reads as a
 * near-duplicate of page 1.
 */
export function landingPagePath(path: string, page: number): string {
  return page <= 1 ? path : `${path}?page=${page}`;
}
