import { pairedCopies } from "@/lib/strings/store";
import { PublicShell } from "@/components/structure";
import { blendedSearch } from "@/lib/db/queries/blended-search";
import { recordSearch, recordZeroResult } from "@/lib/db/queries";
import { t } from "@/lib/i18n";
import type { SearchQuery } from "@/lib/search/query";
import { DirectoryFooter, DirectoryNav } from "@/app/(public)/_chrome";
import { BlendedBody } from "./_blended-view";

/**
 * Boards `10c` + `10c-s` — search results, both kinds. One search box, one
 * result set, everything the words found in it.
 *
 * `/search` renders this for every query with words (`compositionFor`), and the
 * map composition beside it only for a viewport or a browse with no words at
 * all. **D1 is why:** a query does not say which kind it wants — someone
 * searching *chiller* may want to buy one, fix one or have one inspected — and
 * a tab row that partitions the index decides for the buyer before they have
 * seen what exists.
 *
 * The composition deliberately does not resemble the map one. It has no map — a
 * service has coverage, not a pin — and its rail is in three declared parts,
 * which is what lets one screen carry a stock filter and a scope-sheet filter
 * without either pretending to apply to the other.
 *
 * Everything on it is one set: the header, the tabs, the rail's counts and the
 * rows are computed by `blendedSearch` from the same documents, and a tab
 * narrows that set rather than asking for another (`B1`–`B3`).
 */

const BASE = "/search";

export async function BlendedSearchPage({
  query,
  tray = [],
}: {
  query: SearchQuery;
  /** `B8` — supplier slugs in the comparison tray, straight off `?compare=`. */
  tray?: readonly string[];
}) {
  const [result, copy] = await Promise.all([blendedSearch(query), pairedCopies()]);

  /*
     `B11` — every search is logged, whatever it returned, and every zero-result
     one lands in the admin gap report with its filter set. That row is what
     turns a failed search into a recruitment target: `10e`'s zero-result saved
     search and `12d`'s call list both read this table.

     Not awaited and never allowed to throw — a log that fails must not take a
     results page with it.
  */
  void recordSearch({ q: query.q, tab: result.active, emirate: query.emirate }, result.counts.all, null);
  if (result.counts.all === 0) await recordZeroResult(query, null, result.active);

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
      <BlendedBody query={query} result={result} copy={copy} tray={tray} />
    </PublicShell>
  );
}
