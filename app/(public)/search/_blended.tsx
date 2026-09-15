import { pairedCopies } from "@/lib/strings/store";
import { PublicShell } from "@/components/structure";
import { blendedSearch } from "@/lib/db/queries/blended-search";
import { recordSearch, recordZeroResult } from "@/lib/db/queries";
import { t } from "@/lib/i18n";
import type { SearchQuery } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { BlendedBody } from "./_blended-view";

/**
 * Board `1c-s` — blended search. One search box, one result set, three kinds
 * of thing in it.
 *
 * The page `/search` renders when the words find work sold by the job; goods
 * search, board `1c`, renders otherwise, and `compositionFor` holds the rule.
 * This composition deliberately does not resemble that one. It has no map —
 * a service has coverage, not a pin — and its rail has **no price filter and no
 * stock filter** (B6): neither field exists on a scope sheet, and their absence
 * is what makes this read as a different page rather than the goods page with
 * its labels swapped.
 *
 * Everything on it is one set: the header, the tabs, the rail's counts and the
 * rows are computed by `blendedSearch` from the same documents, and a tab
 * narrows that set rather than asking for another (B1–B3).
 */

const BASE = "/search";

export async function BlendedSearchPage({ query }: { query: SearchQuery }) {
  const [result, copy] = await Promise.all([blendedSearch(query), pairedCopies()]);

  /*
     The same two rows goods search writes. A blended search that found nothing
     at all is the cleanest demand signal the platform gets — a service query
     with no supply — and 10e's zero-result saved search and 12d's call list both
     read this table.
  */
  void recordSearch({ q: query.q, tab: query.kind ?? "all", emirate: query.emirate }, result.counts.all, null);
  if (result.counts.all === 0) await recordZeroResult(query, null, query.kind ?? "all");

  return (
    <PublicShell
      bleed
      nav={
        <DirectoryNav
          scope={{
            action: BASE,
            label: query.emirate ? t(`emirate.${query.emirate}` as never) : t("search.scope_uae"),
            placeholder: t("search.placeholder"),
          }}
        />
      }
      footer={<DirectoryFooter />}
    >
      <BlendedBody query={query} result={result} copy={copy} />
    </PublicShell>
  );
}

