import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  landingMetadata,
  landingState,
  resolveAreaScope,
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
 * ## Unpublished means no URL
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
 * render. The recruiter-facing version of that information did not go anywhere
 * — `/admin/content/matrix` shows every held scope and the number holding it.
 *
 * ## An unresolvable segment 404s
 *
 * Criterion 6, and never a redirect to the emirate page. Nothing here guesses:
 * the emirate has to match the area's own, or two URLs address one page and the
 * canonical becomes a coin toss.
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

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const loaded = await load(await params, await searchParams);
  if (!loaded) return {};
  return landingMetadata(loaded);
}

export default async function AreaLandingPage({ params, searchParams }: Props) {
  const sp = await searchParams;
  const loaded = await load(await params, sp);
  if (!loaded) notFound();
  return <LandingPage state={loaded.state} searchParams={sp} pageCount={loaded.pageCount} />;
}
