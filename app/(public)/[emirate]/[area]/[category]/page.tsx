import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  landingMetadata,
  landingState,
  resolveAreaScope,
  resolveEmirateScope,
  subcategoryChips,
} from "@/lib/seo/landing";
import { countResults } from "@/lib/db/queries";
import { LandingPage, RESULTS_PER_PAGE } from "@/app/(public)/_landing/LandingPage";
import { parseSearchQuery } from "@/lib/search/query";

/**
 * Board 6a — `/:emirate/:area/:category`, the workhorse template.
 *
 * The area class. Its twin two segments up is `/:emirate/:category`, the 84
 * pages board 6c's matrix links, and both render `LandingPage` from one scope
 * object — §1: *"one template, one controller, one scope object"*.
 *
 * ## A scope that never published has no URL
 *
 * §the-publish-gate, consequence 1:
 *
 *   *"An unpublished scope has no URL. It is not a thin page, not a `noindex`
 *    page, not a redirect. It 404s and it is absent from the sitemap and from
 *    every link block on every sibling page."*
 *
 * This route served a `noindex` page with a "held back, and here is the number"
 * panel until board 6a landed, on the reasoning that a buyer following a link
 * deserves to see the suppliers there are. The board overrules it, and the
 * argument is arithmetic rather than taste: this template addresses a few
 * hundred URLs, and a soft 404 on one of them teaches a crawler that guesses
 * render.
 *
 * ## A page that WAS live redirects to its parent
 *
 * Board 6f §6 amends the rule above, and only for the second case. Criterion 8:
 * *"An auto-unpublish 301s to the parent emirate page. No withdrawn area page
 * returns a 404."* These URLs have accumulated ranking; a 404 discards it and
 * teaches the crawler that the section is unstable.
 *
 * The two rules do not conflict once the two cases are separated. A scope that
 * never published has nothing to preserve and no relationship a crawler ever
 * saw, so it still 404s — `firstPublishedAt` is the discriminator, and it is
 * why that column is never cleared. A scope that was live redirects.
 *
 * 6a's counter-argument was that a redirect makes the canonical a coin toss.
 * That is true of *serving* one page at two addresses and untrue of a redirect,
 * which serves nothing at the old one. What 6a was right about is flapping —
 * a page oscillating between 200 and a redirect is worse than either — and 6f
 * answers that with the hysteresis band and the minimum-live window rather than
 * by refusing the redirect.
 *
 * **It is a 308, and the board says 301.** Next's `permanentRedirect` emits
 * 308, `next.config` redirects emit 307/308, and only middleware can write a
 * literal 301. 308 is the same instruction with the method preserved, it is
 * what this codebase already serves for a moved listing, and inventing a
 * middleware path to change the digit would be a second redirect mechanism for
 * no behavioural gain.
 *
 * ## An unresolvable segment 404s
 *
 * Criterion 6. Nothing here guesses: the emirate has to match the area's own,
 * or two URLs address one page and the canonical becomes a coin toss.
 */

export const revalidate = 300;

interface Props {
  params: Promise<{ emirate: string; area: string; category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Scope, state and the page count — everything both exports need, once. */
async function load(
  params: { emirate: string; area: string; category: string },
  searchParams: Record<string, string | string[] | undefined>,
) {
  const scope = await resolveAreaScope(params);
  if (!scope) return null;

  const state = await landingState(scope);
  if (!state.live) return null;

  const raw = Array.isArray(searchParams["sub"]) ? searchParams["sub"][0] : searchParams["sub"];
  const chips = raw ? await subcategoryChips(scope) : [];
  const chip = chips.find((entry) => entry.slug === raw) ?? null;
  /*
     A `?sub=` that names nothing is not a page. Left alone it would render the
     unfiltered page at a second address, which is a duplicate with a query
     string on the template that can least afford one.
  */
  if (raw && !chip) return null;

  const page = Math.max(1, Number(Array.isArray(searchParams["page"]) ? searchParams["page"][0] : searchParams["page"] ?? 1) || 1);
  const total = await countResults(
    {
      ...parseSearchQuery({}),
      area: scope.area?.slug,
      tab: "businesses",
    },
    chip ? [chip.id] : scope.categoryIds,
  );
  const pageCount = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
  // A page number past the end is not a page either.
  if (page > pageCount) return null;

  return { state, page, pageCount, filtered: chip !== null };
}

/**
 * Where a withdrawn page sends its readers, or null for a 404.
 *
 * Three conditions, all of them necessary. The scope has to resolve — a typo is
 * not a withdrawal. The page has to have been live once, or there is no ranking
 * to preserve. And the parent has to be live itself: an area page's parent is
 * gated by the same rule and can be held, and a redirect that lands on a 404 is
 * strictly worse than the 404 it replaced.
 */
async function withdrawnTarget(params: {
  emirate: string;
  area: string;
  category: string;
}): Promise<string | null> {
  const scope = await resolveAreaScope(params);
  if (!scope) return null;

  const state = await landingState(scope);
  if (state.live || state.firstPublishedAt === null) return null;

  const parent = await resolveEmirateScope({
    emirate: scope.emirate,
    category: scope.category.slug,
  });
  if (!parent) return null;
  const parentState = await landingState(parent);
  return parentState.live ? parent.path : null;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const loaded = await load(await params, await searchParams);
  if (!loaded) return {};
  return landingMetadata(loaded);
}

export default async function AreaLandingPage({ params, searchParams }: Props) {
  const sp = await searchParams;
  const p = await params;
  const loaded = await load(p, sp);
  if (!loaded) {
    const to = await withdrawnTarget(p);
    // `permanentRedirect` throws, so nothing below it runs.
    if (to) permanentRedirect(to);
    notFound();
  }
  return <LandingPage state={loaded.state} searchParams={sp} pageCount={loaded.pageCount} />;
}
