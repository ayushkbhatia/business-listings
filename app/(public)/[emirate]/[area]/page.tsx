import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  landingMetadata,
  landingState,
  resolveEmirateScope,
  subcategoryChips,
} from "@/lib/seo/landing";
import { countResults } from "@/lib/db/queries";
import { LandingPage, RESULTS_PER_PAGE } from "@/app/(public)/_landing/LandingPage";
import { parseSearchQuery } from "@/lib/search/query";

/**
 * `/:emirate/:category` — one trade across one emirate, board 6a's second page
 * class and the 84 pages board 6c's matrix counts.
 *
 * ## Why the folder segment is called `area`
 *
 * Next refuses two different slug names at the same position: a sibling
 * `[emirate]/[category]` next to `[emirate]/[area]` throws *"You cannot use
 * different slug names for the same dynamic path"* on the first request. It
 * builds cleanly and fails at runtime, which is a trap worth naming twice.
 *
 * So the folder reuses the name established one level down and this route reads
 * the value as a category slug. The URL is unaffected.
 *
 * ## This is what open question 3 asked for
 *
 * *"Does the middle segment carry sector pages at all? A flatter
 * `/:emirate/:category` for the 84 would remove the ambiguity in §1 entirely.
 * Recommendation: flatten it."* It is flat, and it has been since board 6c: two
 * segments is the emirate class, three is the area class, and Next matches on
 * segment count, so no middle segment is ever ambiguous and no `type` column is
 * needed to disambiguate one. What survives of criterion 7 is the namespace
 * itself, in `lib/seo/landing/slug-namespace.ts`.
 *
 * Everything else — the publish gate, the 404, the template — is the area
 * route's, shared rather than mirrored.
 */

export const revalidate = 300;

interface Props {
  /** `area` is the router's name for this segment; the value is a sector slug. */
  params: Promise<{ emirate: string; area: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(
  params: { emirate: string; area: string },
  searchParams: Record<string, string | string[] | undefined>,
) {
  const scope = await resolveEmirateScope({ emirate: params.emirate, category: params.area });
  if (!scope) return null;

  const state = await landingState(scope);
  if (!state.live) return null;

  const raw = Array.isArray(searchParams["sub"]) ? searchParams["sub"][0] : searchParams["sub"];
  const chips = raw ? await subcategoryChips(scope) : [];
  const chip = chips.find((entry) => entry.slug === raw) ?? null;
  if (raw && !chip) return null;

  const page = Math.max(1, Number(Array.isArray(searchParams["page"]) ? searchParams["page"][0] : searchParams["page"] ?? 1) || 1);
  const total = await countResults(
    {
      ...parseSearchQuery({}),
      emirate: scope.emirate,
      tab: "businesses",
    },
    chip ? [chip.id] : scope.categoryIds,
  );
  const pageCount = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
  if (page > pageCount) return null;

  return { state, page, pageCount, filtered: chip !== null };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const loaded = await load(await params, await searchParams);
  if (!loaded) return {};
  return landingMetadata(loaded);
}

export default async function EmirateCategoryPage({ params, searchParams }: Props) {
  const sp = await searchParams;
  const loaded = await load(await params, sp);
  if (!loaded) notFound();
  return <LandingPage state={loaded.state} searchParams={sp} pageCount={loaded.pageCount} />;
}
